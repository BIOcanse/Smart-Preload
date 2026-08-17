use std::collections::BTreeSet;
use std::env;
use std::fs;
use std::path::PathBuf;

use anyhow::Result;

use super::origin::normalize_extension_origin;

pub(super) fn load_allowed_extension_origins() -> BTreeSet<String> {
    let mut origins = BTreeSet::new();

    for path in [
        allowed_extension_origins_path().ok(),
        allowed_extension_origin_path().ok(),
    ]
    .into_iter()
    .flatten()
    {
        let Ok(raw_value) = fs::read_to_string(path) else {
            continue;
        };

        for line in raw_value.lines() {
            if let Some(origin) = normalize_extension_origin(line) {
                origins.insert(origin);
            }
        }
    }

    origins
}

/// 读连续拒绝次数。
///
/// **必须落盘**：本地 app 由浏览器通过 native messaging 唤醒，一天可能起停很多次。
/// 只放内存的话计数每次都从零开始，「多次拒绝后给出路」这个阈值可能永远到不了。
///
/// 这不是「持久化拒绝」——它不影响是否再次弹配对框，只决定什么时候多问一句
/// 「要不要干脆卸载」。读失败一律当 0：宁可晚一点给出路，也不要凭坏数据弹卸载框。
pub(super) fn load_pairing_decline_count() -> u32 {
    pairing_decline_count_path()
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|raw_value| raw_value.trim().parse::<u32>().ok())
        .unwrap_or(0)
}

pub(super) fn persist_pairing_decline_count(count: u32) -> Result<()> {
    let path = pairing_decline_count_path()?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::write(path, count.to_string())?;
    Ok(())
}

/// 用户是否选择了「不再提示」。
///
/// 这是**用户显式做出的选择**，与「拒绝不落盘」的口径不冲突：拒绝一次只是这一次不同意，
/// 而这条是用户明确说「以后别问了」。托盘菜单的手动配对会把它清掉，出路是可逆的。
pub(super) fn load_pairing_prompts_suppressed() -> bool {
    pairing_prompts_suppressed_path()
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .map(|raw_value| raw_value.trim() == "1")
        .unwrap_or(false)
}

pub(super) fn persist_pairing_prompts_suppressed(suppressed: bool) -> Result<()> {
    let path = pairing_prompts_suppressed_path()?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::write(path, if suppressed { "1" } else { "0" })?;
    Ok(())
}

/// 上一次注册请求带来的界面语言。
///
/// 托盘菜单在 host 启动时构建，那时没有任何请求上下文 —— 没有这份记录的话菜单只能用英文，
/// 而弹窗是跟着扩展语言走的，同一个程序会出现两种语言。
pub(super) fn load_last_ui_locale() -> Option<String> {
    last_ui_locale_path()
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .map(|raw_value| raw_value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub(super) fn persist_last_ui_locale(locale: &str) -> Result<()> {
    let path = last_ui_locale_path()?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::write(path, locale)?;
    Ok(())
}

fn pairing_prompts_suppressed_path() -> Result<PathBuf> {
    portable_file_path("pairing-prompts-suppressed.txt")
}

fn last_ui_locale_path() -> Result<PathBuf> {
    portable_file_path("ui-locale.txt")
}

fn portable_file_path(file_name: &str) -> Result<PathBuf> {
    let executable_path = env::current_exe()?;
    let executable_dir = executable_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("local app executable directory is not available"))?;
    Ok(executable_dir.join("portable").join(file_name))
}

fn pairing_decline_count_path() -> Result<PathBuf> {
    let executable_path = env::current_exe()?;
    let executable_dir = executable_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("local app executable directory is not available"))?;
    Ok(executable_dir
        .join("portable")
        .join("pairing-decline-count.txt"))
}

pub(super) fn persist_allowed_extension_origins(origins: &BTreeSet<String>) -> Result<()> {
    let origins_path = allowed_extension_origins_path()?;

    if let Some(parent) = origins_path.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::write(
        origins_path,
        origins.iter().cloned().collect::<Vec<_>>().join("\n"),
    )?;

    if let Some(first_origin) = origins.iter().next() {
        let legacy_origin_path = allowed_extension_origin_path()?;

        if let Some(parent) = legacy_origin_path.parent() {
            fs::create_dir_all(parent)?;
        }

        fs::write(legacy_origin_path, first_origin)?;
    }

    Ok(())
}

pub(super) fn load_debug_api_token() -> Option<String> {
    let token_path = debug_api_token_path().ok()?;
    let token = fs::read_to_string(token_path).ok()?;
    let trimmed = token.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn allowed_extension_origin_path() -> Result<PathBuf> {
    let executable_path = env::current_exe()?;
    let executable_dir = executable_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("local app executable directory is not available"))?;
    Ok(executable_dir
        .join("portable")
        .join("allowed-extension-origin.txt"))
}

fn allowed_extension_origins_path() -> Result<PathBuf> {
    let executable_path = env::current_exe()?;
    let executable_dir = executable_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("local app executable directory is not available"))?;
    Ok(executable_dir
        .join("portable")
        .join("allowed-extension-origins.txt"))
}

fn debug_api_token_path() -> Result<PathBuf> {
    let executable_path = env::current_exe()?;
    let executable_dir = executable_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("local app executable directory is not available"))?;
    Ok(executable_dir.join("portable").join("debug-api-token.txt"))
}
