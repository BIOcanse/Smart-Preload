mod origin;
mod registry;
mod status;

use crate::runtime_debug::record_app_runtime_event;

use super::{
    disable_watcher_registration, native_messaging, registered_extension_ids, target_extension_ids,
};
use anyhow::Result;
pub(crate) use status::{
    portable_install_status, write_portable_install_status_snapshot, PortableInstallStatus,
};

pub(crate) fn install_portable_app() -> Result<PortableInstallStatus> {
    disable_watcher_registration()?;
    registry::write_app_registration()?;

    let extension_ids = install_extension_ids();

    if !extension_ids.is_empty() {
        origin::persist_allowed_extension_origins(&extension_ids)?;
        let manifest_path = native_messaging::ensure_native_messaging_registration(&extension_ids)?;
        registry::write_native_messaging_app_registration(&extension_ids, &manifest_path)?;
        record_app_runtime_event(
            "installer",
            "native-messaging-registered",
            Some(format!(
                "{}::{}",
                extension_ids.join(","),
                manifest_path.display()
            )),
        );
    } else {
        record_app_runtime_event(
            "installer",
            "native-messaging-preserved-extension-missing",
            None,
        );
    }

    let status = portable_install_status()?;
    write_portable_install_status_snapshot(&status)?;
    record_app_runtime_event("installer", "install-completed", None);
    Ok(status)
}

pub(crate) fn uninstall_portable_app() -> Result<PortableInstallStatus> {
    disable_watcher_registration()?;
    native_messaging::remove_native_messaging_registration()?;
    registry::remove_app_registration()?;

    let status = portable_install_status()?;
    write_portable_install_status_snapshot(&status)?;
    record_app_runtime_event("installer", "uninstall-completed", None);
    Ok(status)
}

/// 安装/更新时要写进 allowed-origins 与 native messaging manifest 的扩展 ID。
///
/// **已确认的配对优先于全新扫描**（2026-08-02 调换顺序）。`persist_allowed_extension_origins`
/// 是整体覆盖写，而 `target_extension_ids()` 是「扫 Chrome 配置目录里所有 manifest 形状匹配
/// 的扩展」——形状指纹是公开可复制的。原来的顺序意味着：用户装了个照抄形状的扩展之后，
/// 只要本地 app 走一次安装/更新流程，那个扩展就会被**自动**写进授权集合与 native messaging
/// manifest，绕过 `/extension/register` 的配对弹窗。
///
/// 调换后：
///   - 首次安装（还没有任何确认过的配对）：回落到扫描，行为与之前一致，用户此刻正在跑安装程序。
///   - 之后的每次更新：只沿用**用户确认过**的那批，新出现的形状匹配扩展必须走弹窗。
fn install_extension_ids() -> Vec<String> {
    let mut extension_ids = registered_extension_ids();

    if extension_ids.is_empty() {
        extension_ids = target_extension_ids();
    }

    if extension_ids.is_empty() {
        if let Some(extension_id) = registry::read_app_registration()
            .ok()
            .and_then(|registration| registration.extension_id)
        {
            extension_ids.push(extension_id);
        }
    }

    extension_ids.sort();
    extension_ids.dedup();
    extension_ids
}
