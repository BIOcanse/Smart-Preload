use std::time::Duration;

mod auth;
mod cors;
mod origin;
mod persistence;
mod routes;
mod server;
mod state;

pub(crate) use origin::extension_origin_from_headers;
pub use server::spawn_server;
pub use state::ApiState;

pub(crate) const EXTENSION_ORIGIN_HEADER: &str = "x-zlw-extension-origin";
pub(crate) const EXTENSION_HEARTBEAT_TTL: Duration = Duration::from_secs(180);
