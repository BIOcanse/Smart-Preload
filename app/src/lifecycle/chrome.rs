use super::*;

pub(crate) fn chrome_is_running(process_sampler: &SystemProcessSampler) -> bool {
    current_runtime_process_state(process_sampler)
}

pub(crate) fn spawn_chrome_shutdown_monitor(
    shutdown_tx: watch::Sender<bool>,
    process_sampler: SystemProcessSampler,
) {
    thread::spawn(move || {
        let shutdown_rx = shutdown_tx.subscribe();
        let mut ticks_without_chrome = 0_u8;

        loop {
            if *shutdown_rx.borrow() {
                break;
            }

            if chrome_is_running(&process_sampler) {
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

pub(crate) fn current_runtime_process_state(process_sampler: &SystemProcessSampler) -> bool {
    process_sampler
        .with_system(PROCESS_SAMPLE_MAX_AGE, |system| {
            system
                .processes()
                .values()
                .any(is_google_chrome_browser_process)
        })
        .unwrap_or(true)
}
