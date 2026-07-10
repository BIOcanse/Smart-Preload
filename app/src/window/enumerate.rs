use super::*;
use std::collections::HashMap;
use std::fmt;

use crate::telemetry::{
    supported_browser_process_info, SupportedBrowserProcessInfo, SystemProcessSampler,
    PROCESS_SAMPLE_MAX_AGE,
};

const WINDOW_BOUNDS_TOLERANCE_PX: i32 = 10;

struct EnumContext {
    windows: Vec<ChromeWindowInfo>,
    browser_processes_by_id: HashMap<u32, SupportedBrowserProcessInfo>,
}

pub(crate) fn enumerate_chrome_windows(
    process_sampler: &SystemProcessSampler,
) -> Vec<ChromeWindowInfo> {
    let browser_processes_by_id = collect_supported_browser_processes(process_sampler);
    let context = Mutex::new(EnumContext {
        windows: Vec::new(),
        browser_processes_by_id,
    });

    unsafe {
        let _ = EnumWindows(
            Some(enum_windows_callback),
            LPARAM(&context as *const _ as isize),
        );
    }

    context
        .into_inner()
        .unwrap_or_else(|e| e.into_inner())
        .windows
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WindowMatchError {
    Ambiguous,
    EvidenceMismatch,
    InsufficientEvidence,
    NotFound,
}

impl fmt::Display for WindowMatchError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Ambiguous => "multiple Chrome windows matched; ownership is ambiguous",
            Self::EvidenceMismatch => {
                "the supplied Chrome window did not match the title or complete bounds evidence"
            }
            Self::InsufficientEvidence => {
                "window ownership requires a sentinel title or complete bounds"
            }
            Self::NotFound => "no matching Chrome window found",
        })
    }
}

pub(crate) fn find_chrome_window(
    process_sampler: &SystemProcessSampler,
    request: &HideWindowRequest,
) -> Result<ChromeWindowInfo, WindowMatchError> {
    let windows = enumerate_chrome_windows(process_sampler);

    if let Some(target_hwnd) = request.hwnd {
        let window = windows
            .into_iter()
            .find(|window| window.hwnd == target_hwnd)
            .ok_or(WindowMatchError::NotFound)?;

        validate_window_request_evidence(&window, request)?;
        return Ok(window);
    }

    if !request_has_strong_evidence(request) {
        return Err(WindowMatchError::InsufficientEvidence);
    }

    let mut candidates = windows
        .into_iter()
        .filter(|window| validate_window_request_evidence(window, request).is_ok())
        .collect::<Vec<_>>();

    candidates.sort_by_key(|w| std::cmp::Reverse(w.visible as u8));

    match candidates.len() {
        0 => Err(WindowMatchError::NotFound),
        1 => Ok(candidates.remove(0)),
        _ => Err(WindowMatchError::Ambiguous),
    }
}

fn validate_window_request_evidence(
    window: &ChromeWindowInfo,
    request: &HideWindowRequest,
) -> Result<(), WindowMatchError> {
    if window.process_id == 0
        || window.class_name != CHROME_WINDOW_CLASS
        || window
            .browser_kind
            .as_deref()
            .is_none_or(|browser_kind| browser_kind.trim().is_empty())
    {
        return Err(WindowMatchError::EvidenceMismatch);
    }

    if !request_browser_family_matches(window, request) {
        return Err(WindowMatchError::EvidenceMismatch);
    }

    if !request_has_strong_evidence(request) {
        return Err(WindowMatchError::InsufficientEvidence);
    }

    let title_matches = request
        .title_contains
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some_and(|title_contains| window.title.contains(title_contains));

    let bounds_match = request.left.is_some()
        && request.top.is_some()
        && request.width.is_some()
        && request.height.is_some()
        && [
            (request.left, window.left),
            (request.top, window.top),
            (request.width, window.width),
            (request.height, window.height),
        ]
        .into_iter()
        .all(|(expected, actual)| {
            expected.is_some_and(|expected| {
                actual.abs_diff(expected) <= WINDOW_BOUNDS_TOLERANCE_PX as u32
            })
        });

    (title_matches || bounds_match)
        .then_some(())
        .ok_or(WindowMatchError::EvidenceMismatch)
}

fn request_browser_family_matches(window: &ChromeWindowInfo, request: &HideWindowRequest) -> bool {
    let Some(requested_family) = request
        .browser_family
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return true;
    };
    let browser_kind = window
        .browser_kind
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();

    match requested_family.to_ascii_lowercase().as_str() {
        "edge" => browser_kind == "edge",
        "chromium" => !browser_kind.is_empty() && browser_kind != "edge",
        _ => false,
    }
}

fn request_has_strong_evidence(request: &HideWindowRequest) -> bool {
    let has_title = request
        .title_contains
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());
    let has_complete_bounds = request.left.is_some()
        && request.top.is_some()
        && request.width.is_some()
        && request.height.is_some();

    has_title || has_complete_bounds
}

unsafe extern "system" fn enum_windows_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let context = unsafe { &*(lparam.0 as *const Mutex<EnumContext>) };

    let class_name = unsafe { get_window_class_name(hwnd) };
    if class_name != CHROME_WINDOW_CLASS {
        return TRUE;
    }

    let mut process_id = 0_u32;
    unsafe {
        GetWindowThreadProcessId(hwnd, Some(&mut process_id));
    }

    let process_info = match context
        .lock()
        .ok()
        .and_then(|ctx| ctx.browser_processes_by_id.get(&process_id).cloned())
    {
        Some(info) => info,
        None => return TRUE,
    };

    let mut rect = RECT::default();
    let _ = unsafe { GetWindowRect(hwnd, &mut rect) };

    let info = ChromeWindowInfo {
        hwnd: hwnd.0 as u64,
        process_id,
        process_name: Some(process_info.process_name),
        executable_path: process_info.executable_path,
        browser_kind: Some(process_info.browser_kind),
        title: unsafe { get_window_title(hwnd) },
        class_name,
        left: rect.left,
        top: rect.top,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top,
        visible: unsafe { IsWindowVisible(hwnd).as_bool() },
        minimized: (unsafe { GetWindowLongW(hwnd, GWL_STYLE) } & WS_MINIMIZE.0 as i32) != 0,
        tool_window: (unsafe { GetWindowLongW(hwnd, GWL_EXSTYLE) } & WS_EX_TOOLWINDOW.0 as i32)
            != 0,
    };

    if let Ok(mut ctx) = context.lock() {
        ctx.windows.push(info);
    }

    TRUE
}

fn collect_supported_browser_processes(
    process_sampler: &SystemProcessSampler,
) -> HashMap<u32, SupportedBrowserProcessInfo> {
    process_sampler
        .with_system(PROCESS_SAMPLE_MAX_AGE, |system| {
            system
                .processes()
                .values()
                .filter_map(supported_browser_process_info)
                .filter(|info| {
                    system
                        .processes()
                        .values()
                        .find(|process| process.pid().as_u32() == info.pid)
                        .is_some_and(|process| {
                            let command_line = process
                                .cmd()
                                .iter()
                                .map(|value| value.to_string_lossy())
                                .collect::<Vec<_>>()
                                .join(" ")
                                .to_ascii_lowercase();
                            !command_line.contains("--type=")
                        })
                })
                .map(|info| (info.pid, info))
                .collect()
        })
        .unwrap_or_default()
}

pub(super) fn window_owner_matches(hwnd: u64, expected_process_id: u32) -> bool {
    let handle = HWND(hwnd as *mut _);

    if !unsafe { IsWindow(handle).as_bool() }
        || unsafe { get_window_class_name(handle) } != CHROME_WINDOW_CLASS
    {
        return false;
    }

    let mut process_id = 0_u32;
    unsafe {
        GetWindowThreadProcessId(handle, Some(&mut process_id));
    }

    process_id != 0 && process_id == expected_process_id
}

unsafe fn get_window_class_name(hwnd: HWND) -> String {
    let mut buffer = [0u16; 256];
    let length = unsafe { GetClassNameW(hwnd, &mut buffer) };
    if length == 0 {
        return String::new();
    }
    OsString::from_wide(&buffer[..length as usize])
        .to_string_lossy()
        .to_string()
}

unsafe fn get_window_title(hwnd: HWND) -> String {
    let length = unsafe { GetWindowTextLengthW(hwnd) };
    if length == 0 {
        return String::new();
    }
    let mut buffer = vec![0u16; (length + 1) as usize];
    let copied = unsafe { GetWindowTextW(hwnd, &mut buffer) };
    if copied == 0 {
        return String::new();
    }
    OsString::from_wide(&buffer[..copied as usize])
        .to_string_lossy()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_window() -> ChromeWindowInfo {
        ChromeWindowInfo {
            hwnd: 42,
            process_id: 100,
            process_name: Some("chrome.exe".to_string()),
            executable_path: Some("C:\\Program Files\\Google\\Chrome\\chrome.exe".to_string()),
            browser_kind: Some("chrome".to_string()),
            title: "about:blank#zero-latency-preload-window - Google Chrome".to_string(),
            class_name: CHROME_WINDOW_CLASS.to_string(),
            left: -20_000,
            top: -20_000,
            width: 800,
            height: 600,
            visible: true,
            minimized: false,
            tool_window: false,
        }
    }

    fn verified_request() -> HideWindowRequest {
        HideWindowRequest {
            left: Some(-20_000),
            top: Some(-20_000),
            width: Some(800),
            height: Some(600),
            title_contains: Some("zero-latency-preload-window".to_string()),
            browser_family: Some("chromium".to_string()),
            hwnd: Some(42),
        }
    }

    #[test]
    fn supplied_hwnd_requires_title_or_complete_bounds_evidence() {
        let request = HideWindowRequest {
            left: None,
            top: None,
            width: None,
            height: None,
            title_contains: None,
            browser_family: Some("chromium".to_string()),
            hwnd: Some(42),
        };

        assert_eq!(
            validate_window_request_evidence(&test_window(), &request),
            Err(WindowMatchError::InsufficientEvidence)
        );
    }

    #[test]
    fn supplied_hwnd_accepts_matching_title_when_bounds_change() {
        let mut request = verified_request();
        request.left = Some(10);

        assert_eq!(
            validate_window_request_evidence(&test_window(), &request),
            Ok(())
        );
    }

    #[test]
    fn supplied_hwnd_accepts_matching_bounds_when_title_changes() {
        let mut request = verified_request();
        request.title_contains = Some("ordinary-user-window".to_string());

        assert_eq!(
            validate_window_request_evidence(&test_window(), &request),
            Ok(())
        );
    }

    #[test]
    fn supplied_hwnd_rejects_when_title_and_bounds_both_mismatch() {
        let mut request = verified_request();
        request.title_contains = Some("ordinary-user-window".to_string());
        request.left = Some(10);

        assert_eq!(
            validate_window_request_evidence(&test_window(), &request),
            Err(WindowMatchError::EvidenceMismatch)
        );
    }

    #[test]
    fn verified_browser_window_accepts_matching_title_and_bounds() {
        assert_eq!(
            validate_window_request_evidence(&test_window(), &verified_request()),
            Ok(())
        );
    }

    #[test]
    fn browser_family_rejects_cross_browser_window() {
        let mut request = verified_request();
        request.browser_family = Some("edge".to_string());

        assert_eq!(
            validate_window_request_evidence(&test_window(), &request),
            Err(WindowMatchError::EvidenceMismatch)
        );
    }

    #[test]
    fn non_browser_window_is_rejected_before_hide() {
        let mut window = test_window();
        window.browser_kind = None;

        assert_eq!(
            validate_window_request_evidence(&window, &verified_request()),
            Err(WindowMatchError::EvidenceMismatch)
        );
    }
}
