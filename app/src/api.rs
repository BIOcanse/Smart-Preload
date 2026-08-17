use std::time::Duration;

mod auth;
mod cors;
mod origin;
pub(crate) mod pairing;
mod persistence;
mod routes;
mod server;
mod state;

pub(crate) use origin::{extension_locale_from_headers, extension_origin_from_headers};
pub use server::spawn_server;
pub use state::ApiState;

pub(crate) const EXTENSION_ORIGIN_HEADER: &str = "x-zlw-extension-origin";

/// 请求方声明的界面语言，只用来挑配对弹窗的文案语言。
///
/// **不参与任何安全判定**：值是请求方给的，认不出来就回落英文，最坏结果是弹窗显示了
/// 错误的语言。弹窗的**文字本身**由 app 自带（`api/pairing/text.rs`），请求方给不了。
pub(crate) const EXTENSION_LOCALE_HEADER: &str = "x-zlw-extension-locale";
pub(crate) const EXTENSION_HEARTBEAT_TTL: Duration = Duration::from_secs(180);
