use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use axum::middleware;
use axum::routing::{get, post};
use axum::Router;
use tokio::net::TcpListener;
use tokio::sync::watch;

use crate::api::auth::require_registered_extension_origin;
use crate::api::cors::apply_extension_cors;
use crate::api::{routes, ApiState};
use crate::runtime_debug::record_app_runtime_event;

fn api_address() -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], 45831))
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ServerStartup {
    Ready(SocketAddr),
    Failed(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ServerExit {
    ShutdownRequested,
    Unexpected,
}

pub struct ServerHandle {
    join_handle: Option<JoinHandle<()>>,
    startup_rx: Receiver<ServerStartup>,
}

impl ServerHandle {
    pub fn wait_until_ready(&self, timeout: Duration) -> Result<SocketAddr> {
        match self.startup_rx.recv_timeout(timeout) {
            Ok(ServerStartup::Ready(address)) => Ok(address),
            Ok(ServerStartup::Failed(error)) => Err(anyhow!(error)),
            Err(RecvTimeoutError::Timeout) => {
                Err(anyhow!("hardware API startup timed out after {timeout:?}"))
            }
            Err(RecvTimeoutError::Disconnected) => Err(anyhow!(
                "hardware API thread exited before reporting readiness"
            )),
        }
    }

    pub fn join(mut self) -> thread::Result<()> {
        self.join_handle
            .take()
            .map(JoinHandle::join)
            .unwrap_or(Ok(()))
    }
}

pub fn spawn_server(
    state: ApiState,
    shutdown_rx: watch::Receiver<bool>,
    host_shutdown_tx: watch::Sender<bool>,
) -> ServerHandle {
    let (startup_tx, startup_rx) = mpsc::channel();
    let ready_announced = Arc::new(AtomicBool::new(false));
    let thread_ready_announced = Arc::clone(&ready_announced);
    let join_handle = thread::spawn(move || {
        let runtime = match tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .thread_name("zlw-api")
            .build()
        {
            Ok(runtime) => runtime,
            Err(error) => {
                report_server_failure(
                    &startup_tx,
                    &thread_ready_announced,
                    &host_shutdown_tx,
                    format!("failed to build API runtime: {error}"),
                );
                return;
            }
        };

        match runtime.block_on(run_server(
            state,
            shutdown_rx,
            startup_tx.clone(),
            Arc::clone(&thread_ready_announced),
        )) {
            Ok(ServerExit::ShutdownRequested) => {}
            Ok(ServerExit::Unexpected) => {
                report_server_failure(
                    &startup_tx,
                    &thread_ready_announced,
                    &host_shutdown_tx,
                    "hardware API server exited without a shutdown request".to_string(),
                );
            }
            Err(error) => {
                report_server_failure(
                    &startup_tx,
                    &thread_ready_announced,
                    &host_shutdown_tx,
                    format!("hardware API server failed: {error:#}"),
                );
            }
        }
    });

    ServerHandle {
        join_handle: Some(join_handle),
        startup_rx,
    }
}

fn report_server_failure(
    startup_tx: &Sender<ServerStartup>,
    ready_announced: &AtomicBool,
    host_shutdown_tx: &watch::Sender<bool>,
    error: String,
) {
    tracing::error!("{error}");
    record_app_runtime_event("api", "server-failed", Some(error.clone()));

    if !ready_announced.load(Ordering::Acquire) {
        let _ = startup_tx.send(ServerStartup::Failed(error));
    }

    let _ = host_shutdown_tx.send(true);
}

async fn run_server(
    state: ApiState,
    shutdown_rx: watch::Receiver<bool>,
    startup_tx: Sender<ServerStartup>,
    ready_announced: Arc<AtomicBool>,
) -> Result<ServerExit> {
    let protected_routes = Router::new()
        .route("/health", get(routes::health))
        .route(
            "/api/v1/extension/heartbeat",
            post(routes::extension_heartbeat),
        )
        .route("/api/v1/app/update/status", get(routes::app_update_status))
        .route("/api/v1/app/update", post(routes::request_app_update))
        .route("/api/v1/system/activity", get(routes::system_activity))
        .route("/api/v1/system/hardware", get(routes::system_hardware))
        .route(
            "/api/v1/system/performance",
            get(routes::system_performance),
        )
        .route("/api/v1/system/snapshot", get(routes::system_snapshot))
        .route("/api/v1/windows/chrome", get(routes::list_chrome_windows))
        .route(
            "/api/v1/windows/hidden-monitor",
            get(routes::hidden_window_monitor),
        )
        .route(
            "/api/v1/windows/monitor-snapshot",
            get(routes::hidden_window_monitor),
        )
        .route(
            "/api/v1/windows/monitor-snapshot-read",
            post(routes::hidden_window_monitor_post),
        )
        .route("/api/v1/windows/hide", post(routes::hide_chrome_window))
        .route("/api/v1/windows/show", post(routes::show_chrome_window))
        .route(
            "/api/v1/diagnostics/logs",
            post(routes::append_diagnostics_log),
        )
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            require_registered_extension_origin,
        ));
    let shared_state = state.clone();
    let app = Router::new()
        .route(
            "/api/v1/extension/register",
            post(routes::register_extension),
        )
        .merge(protected_routes)
        .with_state(shared_state)
        .layer(middleware::from_fn_with_state(
            state.clone(),
            apply_extension_cors,
        ));

    let address = api_address();
    let listener = TcpListener::bind(address)
        .await
        .with_context(|| format!("failed to bind hardware API at {address}"))?;

    ready_announced.store(true, Ordering::Release);
    startup_tx
        .send(ServerStartup::Ready(address))
        .map_err(|_| anyhow!("host stopped waiting for hardware API readiness"))?;
    record_app_runtime_event("api", "server-listening", Some(format!("http://{address}")));
    tracing::info!("hardware API listening on http://{address}");

    let mut graceful_shutdown_rx = shutdown_rx.clone();
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            let _ = graceful_shutdown_rx.changed().await;
        })
        .await?;

    record_app_runtime_event("api", "server-stopped", None);

    Ok(if *shutdown_rx.borrow() {
        ServerExit::ShutdownRequested
    } else {
        ServerExit::Unexpected
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_failure_is_reported_and_requests_host_shutdown() {
        let (startup_tx, startup_rx) = mpsc::channel();
        let ready_announced = AtomicBool::new(false);
        let (shutdown_tx, shutdown_rx) = watch::channel(false);

        report_server_failure(
            &startup_tx,
            &ready_announced,
            &shutdown_tx,
            "bind failed".to_string(),
        );

        assert_eq!(
            startup_rx.recv().expect("startup failure should be sent"),
            ServerStartup::Failed("bind failed".to_string())
        );
        assert!(*shutdown_rx.borrow());
    }

    #[test]
    fn failure_after_readiness_only_requests_shutdown() {
        let (startup_tx, startup_rx) = mpsc::channel();
        let ready_announced = AtomicBool::new(true);
        let (shutdown_tx, shutdown_rx) = watch::channel(false);

        report_server_failure(
            &startup_tx,
            &ready_announced,
            &shutdown_tx,
            "serve exited".to_string(),
        );

        assert!(startup_rx.try_recv().is_err());
        assert!(*shutdown_rx.borrow());
    }
}
