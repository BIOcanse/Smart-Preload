use std::time::{Duration, Instant};

use anyhow::Result;
use tokio::sync::watch;
use tray_icon::menu::{Menu, MenuEvent, MenuId, MenuItem};
use tray_icon::{Icon, TrayIcon, TrayIconBuilder};
use winit::application::ApplicationHandler;
use winit::event::WindowEvent;
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::window::WindowId;

use crate::api::pairing::{
    confirm_extension_pairing, pairing_prompt_in_flight, show_nothing_to_pair_notice, tray_labels,
    PairingPromptOutcome,
};
use crate::api::ApiState;
use crate::lifecycle;
use crate::runtime_debug::record_app_runtime_event;

const TRAY_TICK_INTERVAL: Duration = Duration::from_millis(250);

// Keep tray logic thin. It may trigger lifecycle signals, but lifecycle policy
// itself should stay in the lifecycle subsystem rather than growing here.

pub fn run_tray(
    state: ApiState,
    shutdown_tx: watch::Sender<bool>,
    shutdown_rx: watch::Receiver<bool>,
) -> Result<()> {
    let event_loop = EventLoop::new()?;
    let mut app = TrayApp::new(state, shutdown_tx, shutdown_rx);
    event_loop.run_app(&mut app)?;
    Ok(())
}

struct TrayApp {
    state: ApiState,
    shutdown_tx: watch::Sender<bool>,
    shutdown_rx: watch::Receiver<bool>,
    tray_icon: Option<TrayIcon>,
    pair_menu_id: MenuId,
    exit_menu_id: MenuId,
}

impl TrayApp {
    fn new(
        state: ApiState,
        shutdown_tx: watch::Sender<bool>,
        shutdown_rx: watch::Receiver<bool>,
    ) -> Self {
        Self {
            state,
            shutdown_tx,
            shutdown_rx,
            tray_icon: None,
            pair_menu_id: MenuId::new("pair-extension"),
            exit_menu_id: MenuId::new("exit"),
        }
    }

    fn ensure_tray(&mut self) -> Result<()> {
        if self.tray_icon.is_some() {
            return Ok(());
        }

        // 菜单文字跟着扩展的界面语言走（上一次注册请求记下的，见 ApiState::ui_locale）。
        // 菜单只在这里构建一次，之后语言变了也不会重建 —— 下次启动才生效。
        let (pair_label, exit_label) = tray_labels(&self.state.ui_locale());

        let menu = Menu::new();
        let pair_item = MenuItem::with_id(self.pair_menu_id.clone(), pair_label, true, None);
        let exit_item = MenuItem::with_id(self.exit_menu_id.clone(), exit_label, true, None);
        menu.append(&pair_item)?;
        menu.append(&exit_item)?;

        let icon = build_icon()?;
        let tray_icon = TrayIconBuilder::new()
            .with_tooltip("Zero-Latency Web")
            .with_menu(Box::new(menu))
            .with_icon(icon)
            .build()?;

        self.tray_icon = Some(tray_icon);
        Ok(())
    }

    fn handle_menu_events(&mut self, event_loop: &ActiveEventLoop) {
        if *self.shutdown_rx.borrow() {
            event_loop.exit();
            return;
        }

        while let Ok(event) = MenuEvent::receiver().try_recv() {
            if event.id == self.pair_menu_id {
                spawn_manual_pairing(self.state.clone());
                continue;
            }

            if event.id == self.exit_menu_id {
                lifecycle::request_manual_host_exit(&self.shutdown_tx);
                event_loop.exit();
            }
        }
    }
}

/// 手动发起配对。**必须另起线程** —— 弹窗会阻塞到用户操作为止，
/// 在事件循环线程里弹就等于把托盘冻住。
fn spawn_manual_pairing(state: ApiState) {
    if pairing_prompt_in_flight() {
        record_app_runtime_event("tray", "manual-pairing-skipped-in-flight", None);
        return;
    }

    std::thread::spawn(move || run_manual_pairing(state));
}

fn run_manual_pairing(state: ApiState) {
    let locale = state.ui_locale();

    // 这是用户主动要求配对，所以先把「不再提示」关掉 —— 出路必须可逆，
    // 否则关过一次之后这个菜单项自己也会失效。
    state.set_pairing_prompts_suppressed(false);

    let candidates = state.unpaired_target_extension_origins();
    record_app_runtime_event(
        "tray",
        "manual-pairing-started",
        Some(format!("candidates={}", candidates.len())),
    );

    if candidates.is_empty() {
        show_nothing_to_pair_notice(&locale);
        return;
    }

    for origin in candidates {
        let extension_id = origin
            .strip_prefix("chrome-extension://")
            .unwrap_or(&origin)
            .to_string();

        match confirm_extension_pairing(&extension_id, &locale) {
            PairingPromptOutcome::Approved => {
                state.reset_pairing_decline_count();

                match state.confirm_extension_origin(&origin) {
                    Ok(()) => {
                        record_app_runtime_event("tray", "manual-pairing-confirmed", Some(origin))
                    }
                    Err(error) => record_app_runtime_event(
                        "tray",
                        "manual-pairing-persist-failed",
                        Some(format!("{origin}: {error}")),
                    ),
                }
            }
            PairingPromptOutcome::Declined => {
                // 手动配对里的拒绝**不计入**自动提示的拒绝计数：用户是自己来点的，
                // 把它算成「又被打扰了一次」没有道理。
                record_app_runtime_event("tray", "manual-pairing-declined", Some(origin));
            }
            PairingPromptOutcome::NotPrompted => {
                record_app_runtime_event("tray", "manual-pairing-skipped-in-flight", Some(origin));
                break;
            }
        }
    }
}

impl ApplicationHandler for TrayApp {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        event_loop.set_control_flow(ControlFlow::WaitUntil(Instant::now() + TRAY_TICK_INTERVAL));

        if let Err(error) = self.ensure_tray() {
            tracing::error!("failed to create tray icon: {error:?}");
            let _ = self.shutdown_tx.send(true);
            event_loop.exit();
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        event_loop.set_control_flow(ControlFlow::WaitUntil(Instant::now() + TRAY_TICK_INTERVAL));
        self.handle_menu_events(event_loop);
    }

    fn window_event(
        &mut self,
        _event_loop: &ActiveEventLoop,
        _window_id: WindowId,
        _event: WindowEvent,
    ) {
    }
}

fn build_icon() -> Result<Icon> {
    let width = 32;
    let height = 32;
    let mut rgba = vec![0_u8; width * height * 4];

    for y in 0..height {
        for x in 0..width {
            let index = (y * width + x) * 4;
            let dx = x as i32 - 16;
            let dy = y as i32 - 16;
            let distance_squared = dx * dx + dy * dy;

            if distance_squared <= 140 {
                rgba[index] = 66;
                rgba[index + 1] = 122;
                rgba[index + 2] = 94;
                rgba[index + 3] = 255;
            }
        }
    }

    Ok(Icon::from_rgba(rgba, width as u32, height as u32)?)
}
