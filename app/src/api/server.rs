use std::net::SocketAddr;
use std::thread::{self, JoinHandle};

use anyhow::Result;
use axum::middleware;
use axum::routing::{get, post};
use axum::Router;
use tokio::net::TcpListener;
use tokio::sync::watch;

use crate::api::auth::require_registered_extension_origin;
use crate::api::cors::apply_extension_cors;
use crate::api::{routes, ApiState};
use crate::runtime_debug::record_app_runtime_event;

pub fn spawn_server(state: ApiState, shutdown_rx: watch::Receiver<bool>) -> JoinHandle<()> {
    thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .thread_name("zlw-api")
            .build()
            .expect("failed to build tokio runtime");

        runtime.block_on(async move {
            if let Err(error) = run_server(state, shutdown_rx).await {
                tracing::error!("hardware API server failed: {error:?}");
            }
        });
    })
}

async fn run_server(state: ApiState, mut shutdown_rx: watch::Receiver<bool>) -> Result<()> {
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

    let address = SocketAddr::from(([127, 0, 0, 1], 45831));
    let listener = TcpListener::bind(address).await?;

    record_app_runtime_event("api", "server-listening", Some(format!("http://{address}")));
    tracing::info!("hardware API listening on http://{address}");

    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            let _ = shutdown_rx.changed().await;
        })
        .await?;

    record_app_runtime_event("api", "server-stopped", None);

    Ok(())
}
