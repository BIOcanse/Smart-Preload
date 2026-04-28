use std::time::{Duration, Instant};

use anyhow::Result;
use tokio::sync::watch;
use tray_icon::menu::{Menu, MenuEvent, MenuId, MenuItem};
use tray_icon::{Icon, TrayIcon, TrayIconBuilder};
use winit::application::ApplicationHandler;
use winit::event::WindowEvent;
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::window::WindowId;

use crate::lifecycle;

const TRAY_TICK_INTERVAL: Duration = Duration::from_millis(250);

// Keep tray logic thin. It may trigger lifecycle signals, but lifecycle policy
// itself should stay in the lifecycle subsystem rather than growing here.

pub fn run_tray(
    shutdown_tx: watch::Sender<bool>,
    shutdown_rx: watch::Receiver<bool>,
) -> Result<()> {
    let event_loop = EventLoop::new()?;
    let mut app = TrayApp::new(shutdown_tx, shutdown_rx);
    event_loop.run_app(&mut app)?;
    Ok(())
}

struct TrayApp {
    shutdown_tx: watch::Sender<bool>,
    shutdown_rx: watch::Receiver<bool>,
    tray_icon: Option<TrayIcon>,
    exit_menu_id: MenuId,
}

impl TrayApp {
    fn new(shutdown_tx: watch::Sender<bool>, shutdown_rx: watch::Receiver<bool>) -> Self {
        Self {
            shutdown_tx,
            shutdown_rx,
            tray_icon: None,
            exit_menu_id: MenuId::new("exit"),
        }
    }

    fn ensure_tray(&mut self) -> Result<()> {
        if self.tray_icon.is_some() {
            return Ok(());
        }

        let menu = Menu::new();
        let exit_item = MenuItem::with_id(self.exit_menu_id.clone(), "Exit", true, None);
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
            if event.id == self.exit_menu_id {
                lifecycle::request_manual_host_exit(&self.shutdown_tx);
                event_loop.exit();
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
