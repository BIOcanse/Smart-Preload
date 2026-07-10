use anyhow::Result;
use serde::Serialize;
use sysinfo::{Process, System};

#[cfg(windows)]
use windows::Win32::Foundation::{HWND, RECT};
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetSystemMetrics, GetWindowRect, GetWindowTextLengthW, GetWindowTextW,
    GetWindowThreadProcessId, IsWindowVisible, SYSTEM_METRICS_INDEX,
};

use super::{
    chrono_like_now, is_google_chrome_browser_process, SystemProcessSampler, PROCESS_SAMPLE_MAX_AGE,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySnapshot {
    pub generated_at: String,
    pub chrome_running: bool,
    pub foreground: Option<ForegroundWindowSnapshot>,
    pub non_chrome_fullscreen: bool,
    pub game_process_running: bool,
    pub game_process: Option<GameProcessSnapshot>,
    pub professional_process_running: bool,
    pub professional_process: Option<ProfessionalProcessSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForegroundWindowSnapshot {
    pub hwnd: u64,
    pub process_id: u32,
    pub process_name: Option<String>,
    pub title: String,
    pub is_chrome: bool,
    pub fullscreen_like: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameProcessSnapshot {
    pub process_id: u32,
    pub process_name: String,
    pub executable_path: Option<String>,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfessionalProcessSnapshot {
    pub process_id: u32,
    pub process_name: String,
    pub executable_path: Option<String>,
    pub reason: String,
}

pub(super) fn collect_activity_snapshot(
    process_sampler: &SystemProcessSampler,
) -> Result<ActivitySnapshot> {
    process_sampler.with_system(
        PROCESS_SAMPLE_MAX_AGE,
        collect_activity_snapshot_from_system,
    )
}

fn collect_activity_snapshot_from_system(system: &System) -> ActivitySnapshot {
    let chrome_running = system
        .processes()
        .values()
        .any(is_google_chrome_browser_process);
    let foreground = collect_foreground_window_snapshot(system);
    let non_chrome_fullscreen = foreground
        .as_ref()
        .map(|window| window.fullscreen_like && !window.is_chrome)
        .unwrap_or(false);
    let game_process = collect_game_process_snapshot(system);
    let game_process_running = game_process.is_some();
    let professional_process = collect_professional_process_snapshot(system);
    let professional_process_running = professional_process.is_some();

    ActivitySnapshot {
        generated_at: chrono_like_now(),
        chrome_running,
        foreground,
        non_chrome_fullscreen,
        game_process_running,
        game_process,
        professional_process_running,
        professional_process,
    }
}

fn collect_game_process_snapshot(system: &System) -> Option<GameProcessSnapshot> {
    system.processes().values().find_map(|process| {
        let reason = detect_probable_game_process_reason(process)?;
        Some(GameProcessSnapshot {
            process_id: process.pid().as_u32(),
            process_name: process.name().to_string_lossy().to_string(),
            executable_path: process.exe().map(|path| path.to_string_lossy().to_string()),
            reason: reason.to_owned(),
        })
    })
}

fn collect_professional_process_snapshot(system: &System) -> Option<ProfessionalProcessSnapshot> {
    system.processes().values().find_map(|process| {
        let reason = detect_professional_process_reason(process)?;
        Some(ProfessionalProcessSnapshot {
            process_id: process.pid().as_u32(),
            process_name: process.name().to_string_lossy().to_string(),
            executable_path: process.exe().map(|path| path.to_string_lossy().to_string()),
            reason: reason.to_owned(),
        })
    })
}

fn detect_probable_game_process_reason(process: &Process) -> Option<&'static str> {
    if is_google_chrome_browser_process(process) {
        return None;
    }

    let process_name = process.name().to_string_lossy().to_ascii_lowercase();

    if is_known_non_game_process_name(&process_name) {
        return None;
    }

    let executable_path = process
        .exe()
        .map(|path| path.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();

    if executable_path.is_empty() {
        return detect_game_process_name_reason(&process_name);
    }

    detect_game_library_path_reason(&executable_path)
        .or_else(|| detect_game_process_name_reason(&process_name))
}

fn detect_game_library_path_reason(executable_path: &str) -> Option<&'static str> {
    const GAME_LIBRARY_PATH_MARKERS: &[&str] = &[
        "\\steamapps\\common\\",
        "/steamapps/common/",
        "\\epic games\\",
        "/epic games/",
        "\\gog galaxy\\games\\",
        "/gog galaxy/games/",
        "\\gog games\\",
        "/gog games/",
        "\\xboxgames\\",
        "/xboxgames/",
        "\\riot games\\",
        "/riot games/",
        "\\ubisoft game launcher\\games\\",
        "/ubisoft game launcher/games/",
        "\\ea games\\",
        "/ea games/",
    ];

    GAME_LIBRARY_PATH_MARKERS
        .iter()
        .any(|marker| executable_path.contains(marker))
        .then_some("game-library-path")
}

fn detect_game_process_name_reason(process_name: &str) -> Option<&'static str> {
    if process_name.ends_with("-win64-shipping.exe")
        || process_name.ends_with("-win64-shipping")
        || process_name.ends_with("-win32-shipping.exe")
        || process_name.ends_with("-win32-shipping")
    {
        return Some("game-engine-shipping-executable");
    }

    None
}

fn is_known_non_game_process_name(process_name: &str) -> bool {
    matches!(
        process_name,
        "zero-latency-web-app.exe"
            | "zero-latency-web-app"
            | "steam.exe"
            | "steamwebhelper.exe"
            | "epicgameslauncher.exe"
            | "battle.net.exe"
            | "riotclientservices.exe"
            | "riotclientux.exe"
            | "riotclientuxrender.exe"
            | "eadesktop.exe"
            | "eabackgroundservice.exe"
            | "goggalaxy.exe"
            | "ubisoftconnect.exe"
            | "upc.exe"
    )
}

fn detect_professional_process_reason(process: &Process) -> Option<&'static str> {
    if is_google_chrome_browser_process(process) {
        return None;
    }

    let process_name = process.name().to_string_lossy().to_ascii_lowercase();

    if is_known_non_professional_process_name(&process_name) {
        return None;
    }

    let executable_path = process
        .exe()
        .map(|path| path.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();

    detect_professional_process_name_reason(&process_name).or_else(|| {
        (!executable_path.is_empty())
            .then(|| detect_professional_software_path_reason(&executable_path))
            .flatten()
    })
}

fn detect_professional_process_name_reason(process_name: &str) -> Option<&'static str> {
    const PROFESSIONAL_PROCESS_NAMES: &[&str] = &[
        "3dsmax.exe",
        "acad.exe",
        "adobe premiere pro.exe",
        "afterfx.exe",
        "blender.exe",
        "blender",
        "davinci resolve.exe",
        "fusion.exe",
        "houdini.exe",
        "houdinifx.exe",
        "illustrator.exe",
        "inventor.exe",
        "matlab.exe",
        "maya.bin",
        "maya.exe",
        "nuke.exe",
        "photoshop.exe",
        "premiere.exe",
        "resolve.exe",
        "revit.exe",
        "solidworks.exe",
        "sldworks.exe",
        "unity.exe",
        "unrealeditor.exe",
        "zbrush.exe",
    ];

    PROFESSIONAL_PROCESS_NAMES
        .contains(&process_name)
        .then_some("professional-process-name")
}

fn detect_professional_software_path_reason(executable_path: &str) -> Option<&'static str> {
    const PROFESSIONAL_PATH_MARKERS: &[&str] = &[
        "\\adobe\\adobe after effects",
        "/adobe/adobe after effects",
        "\\adobe\\adobe illustrator",
        "/adobe/adobe illustrator",
        "\\adobe\\adobe photoshop",
        "/adobe/adobe photoshop",
        "\\adobe\\adobe premiere pro",
        "/adobe/adobe premiere pro",
        "\\autodesk\\",
        "/autodesk/",
        "\\blackmagic design\\davinci resolve",
        "/blackmagic design/davinci resolve",
        "\\blender foundation\\",
        "/blender foundation/",
        "\\epic games\\ue_",
        "/epic games/ue_",
        "\\foundry\\",
        "/foundry/",
        "\\side effects software\\",
        "/side effects software/",
        "\\solidworks\\",
        "/solidworks/",
        "\\unity\\hub\\editor\\",
        "/unity/hub/editor/",
    ];

    PROFESSIONAL_PATH_MARKERS
        .iter()
        .any(|marker| executable_path.contains(marker))
        .then_some("professional-software-path")
}

fn is_known_non_professional_process_name(process_name: &str) -> bool {
    matches!(
        process_name,
        "zero-latency-web-app.exe"
            | "zero-latency-web-app"
            | "adobecollabsync.exe"
            | "adobecrdaemon.exe"
            | "adobe desktop service.exe"
            | "adobegcclient.exe"
            | "adobeipcbroker.exe"
            | "adobe_licutil.exe"
            | "adobeupdateservice.exe"
            | "adskaccessservice.exe"
            | "adskidentitymanager.exe"
            | "adsklicensingagent.exe"
            | "adsklicensingservice.exe"
            | "autodeskaccessuihost.exe"
            | "armsvc.exe"
            | "creative cloud.exe"
            | "creative cloud helper.exe"
            | "ccxprocess.exe"
            | "fusion360service.exe"
            | "unitycrashhandler64.exe"
            | "unityhub.exe"
            | "node.exe"
            | "node"
            | "msedge.exe"
            | "msedge"
            | "chrome.exe"
            | "chrome"
    )
}

#[cfg(windows)]
fn collect_foreground_window_snapshot(system: &System) -> Option<ForegroundWindowSnapshot> {
    let hwnd = unsafe { GetForegroundWindow() };

    if hwnd.0.is_null() || !unsafe { IsWindowVisible(hwnd) }.as_bool() {
        return None;
    }

    let process_id = unsafe {
        let mut process_id = 0_u32;
        GetWindowThreadProcessId(hwnd, Some(&mut process_id));
        process_id
    };
    let process = system
        .processes()
        .values()
        .find(|process| process.pid().as_u32() == process_id);
    let process_name = process.map(|process| process.name().to_string_lossy().to_string());
    let is_chrome = process
        .map(is_google_chrome_browser_process)
        .unwrap_or(false);
    let title = unsafe { get_window_title(hwnd) };
    let fullscreen_like = unsafe { is_fullscreen_like(hwnd) };

    Some(ForegroundWindowSnapshot {
        hwnd: hwnd.0 as usize as u64,
        process_id,
        process_name,
        title,
        is_chrome,
        fullscreen_like,
    })
}

#[cfg(not(windows))]
fn collect_foreground_window_snapshot(_system: &System) -> Option<ForegroundWindowSnapshot> {
    None
}

#[cfg(windows)]
unsafe fn is_fullscreen_like(hwnd: HWND) -> bool {
    let mut rect = RECT::default();

    if unsafe { GetWindowRect(hwnd, &mut rect) }.is_err() {
        return false;
    }

    let screen_width = unsafe { GetSystemMetrics(SYSTEM_METRICS_INDEX(0)) };
    let screen_height = unsafe { GetSystemMetrics(SYSTEM_METRICS_INDEX(1)) };

    rect.left <= 0 && rect.top <= 0 && rect.right >= screen_width && rect.bottom >= screen_height
}

#[cfg(windows)]
unsafe fn get_window_title(hwnd: HWND) -> String {
    let length = unsafe { GetWindowTextLengthW(hwnd) };

    if length <= 0 {
        return String::new();
    }

    let mut buffer = vec![0_u16; length as usize + 1];
    let copied = unsafe { GetWindowTextW(hwnd, &mut buffer) };

    String::from_utf16_lossy(&buffer[..copied as usize])
}
