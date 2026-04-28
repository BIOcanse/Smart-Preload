use super::*;

pub(crate) fn chrome_is_running() -> bool {
    current_runtime_process_state()
}

pub(crate) fn spawn_chrome_shutdown_monitor(shutdown_tx: watch::Sender<bool>) {
    thread::spawn(move || {
        let shutdown_rx = shutdown_tx.subscribe();
        let mut ticks_without_chrome = 0_u8;

        loop {
            if *shutdown_rx.borrow() {
                break;
            }

            if chrome_is_running() {
                ticks_without_chrome = 0;
            } else {
                ticks_without_chrome = ticks_without_chrome.saturating_add(1);

                if ticks_without_chrome >= CHROME_EXIT_GRACE_TICKS {
                    info!("all Chrome processes are gone; shutting down tray host");
                    let _ = shutdown_tx.send(true);
                    break;
                }
            }

            for _ in 0..10 {
                if *shutdown_rx.borrow() {
                    return;
                }

                thread::sleep(Duration::from_millis(100));
            }
        }
    });
}

pub(crate) fn current_runtime_process_state() -> bool {
    let mut system = System::new_all();
    system.refresh_all();

    let mut chrome_running = false;

    for process in system.processes().values() {
        if is_google_chrome_browser_process(process) {
            chrome_running = true;
            break;
        }
    }

    chrome_running
}
