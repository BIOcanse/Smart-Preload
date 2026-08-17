use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::api::pairing::{
    confirm_extension_pairing, confirm_stop_asking, decide_pairing_prompt_gate,
    pairing_prompt_in_flight, PairingPromptGate, PairingPromptOutcome,
};
use crate::api::state::ExtensionRegistrationDecision;
use crate::api::{extension_locale_from_headers, extension_origin_from_headers, ApiState};
use crate::runtime_debug::record_app_runtime_event;

/// 「确认框已经弹出来了，正在等用户」的响应体。
///
/// 配 `409 CONFLICT` 一起用，与 `403 FORBIDDEN`（被拒绝 / 形状不匹配 / 还在冷却期）
/// 明确区分：调用方看到 409 应当短间隔重试（用户可能马上就点了），
/// 看到 403 才进长退避。两者混在一起的话，用户点完「连接」得等一整个退避周期才能连上。
pub(crate) const PAIRING_CONFIRMATION_PENDING: &str = "extension pairing confirmation pending";

/// 连续拒绝到阈值之后，多问一句「要不要以后都不再提示」。
///
/// **必须在 blocking 线程里调用** —— 它会阻塞到用户操作为止。
///
/// 这里**不做任何不可逆的事**：只是把提示关掉。用户随时可以从托盘菜单手动发起配对，
/// 那条路径会把开关清回去（弹窗页脚已经写明）。
fn offer_stop_asking(state: &ApiState, decline_count: u32, locale: &str) {
    record_app_runtime_event(
        "api",
        "extension-register-stop-asking-offered",
        Some(format!("declines={decline_count}")),
    );

    if !confirm_stop_asking(decline_count, locale) {
        record_app_runtime_event("api", "extension-register-stop-asking-declined", None);
        return;
    }

    state.set_pairing_prompts_suppressed(true);
    record_app_runtime_event("api", "extension-register-prompts-suppressed", None);
}

/// 弹窗里展示扩展 ID 而不是完整 origin —— 用户在 chrome://extensions 上看到的就是 ID。
fn extension_id_for_display(normalized_origin: &str) -> String {
    normalized_origin
        .strip_prefix("chrome-extension://")
        .unwrap_or(normalized_origin)
        .trim_end_matches('/')
        .to_string()
}

pub(crate) async fn register_extension(
    State(state): State<ApiState>,
    headers: HeaderMap,
) -> Result<Json<RegisterExtensionResponse>, (StatusCode, String)> {
    let origin = extension_origin_from_headers(&headers).ok_or_else(|| {
        record_app_runtime_event("api", "extension-register-missing-origin", None);
        (
            StatusCode::BAD_REQUEST,
            "missing extension origin".to_string(),
        )
    })?;
    let decision = state
        .decide_extension_registration(&origin)
        .map_err(|error| (StatusCode::BAD_REQUEST, error.to_string()))?;

    // 托盘菜单在 host 启动时构建，那时没有请求上下文 —— 这里把语言记下来，
    // 让托盘菜单和托盘触发的弹窗与扩展界面同语言。
    //
    // **必须在判定之后，且只认过了形状预筛的 origin。** 放在判定之前的话，
    // 任何被拒绝的注册尝试都能改掉托盘语言 —— 那是完全由调用方控制、却没有任何门槛的写入。
    if !matches!(decision, ExtensionRegistrationDecision::Rejected) {
        state.remember_ui_locale(&extension_locale_from_headers(&headers));
    }

    match decision {
        ExtensionRegistrationDecision::AlreadyPaired => {}
        ExtensionRegistrationDecision::Rejected => {
            record_app_runtime_event("api", "extension-register-rejected", Some(origin.clone()));
            return Err((
                StatusCode::FORBIDDEN,
                "extension origin does not match registered extension".to_string(),
            ));
        }
        ExtensionRegistrationDecision::NeedsConfirmation { normalized_origin } => {
            // 用户选过「不再提示」就不再弹。托盘菜单里的手动配对会把它清掉 —— 出路可逆。
            //
            // 这与「拒绝不落盘」的口径不冲突：拒绝一次只是这一次不同意，
            // 而这条是用户**明确说过**以后别问了。
            if state.pairing_prompts_suppressed() {
                record_app_runtime_event(
                    "api",
                    "extension-register-prompt-suppressed-by-user",
                    Some(normalized_origin),
                );
                return Err((
                    StatusCode::FORBIDDEN,
                    "extension pairing prompts are turned off".to_string(),
                ));
            }

            // 两道闸：并发闸（同一时刻只允许一个弹窗）与冷却闸（同一扩展的最短打扰间隔）。
            // 顺序由 decide_pairing_prompt_gate 保证 —— 并发闸命中时绝不能消耗冷却额度。
            //
            // 冷却闸的由来：扩展的心跳与唤醒重试各是 30 秒一次，而拒绝**按产品口径不落盘**，
            // 没有它时用户会被同一个弹窗每半分钟砸一次（实测 94 秒弹了 7 次）。
            // 这不是「持久化拒绝」——过了冷却期照样会再问，只是不会连珠炮。
            let gate = decide_pairing_prompt_gate(pairing_prompt_in_flight(), || {
                state.begin_pairing_prompt_cooldown(&normalized_origin)
            });

            match gate {
                PairingPromptGate::Show => {}
                PairingPromptGate::SkipInFlight => {
                    // 弹窗正开着等人 —— 这不是拒绝。用 CONFLICT 而不是 FORBIDDEN，
                    // 调用方据此走「短间隔重试」而不是长退避（见下面 spawn 处的说明）。
                    record_app_runtime_event(
                        "api",
                        "extension-register-prompt-skipped-in-flight",
                        Some(normalized_origin),
                    );
                    return Err((
                        StatusCode::CONFLICT,
                        PAIRING_CONFIRMATION_PENDING.to_string(),
                    ));
                }
                PairingPromptGate::SkipCooldown => {
                    record_app_runtime_event(
                        "api",
                        "extension-register-prompt-suppressed-cooldown",
                        Some(normalized_origin),
                    );
                    return Err((
                        StatusCode::FORBIDDEN,
                        "extension pairing was not confirmed".to_string(),
                    ));
                }
            }

            record_app_runtime_event(
                "api",
                "extension-register-awaiting-confirmation",
                Some(normalized_origin.clone()),
            );

            // ⚠️ 弹窗**不能挂在这次 HTTP 请求上**（实测 2026-08-09）。
            //
            // 扩展的 fetch 超时是 1.5 秒（`NATIVE_APP_REQUEST_TIMEOUT_MS`），而弹窗要等人。
            // 客户端断开后 axum 会取消 handler future，`spawn_blocking` 里的弹窗不可取消、
            // 继续留在屏幕上，但它的返回值无处可去 —— 于是**用户点「连接」也不会被保存**，
            // 连日志都不会写一行。故障现场就是这样：弹窗弹了、用户点了、日志里什么都没有。
            //
            // 所以把弹窗整个分离出去，请求立刻返回 CONFLICT（等待确认中，不是拒绝）。
            // 用户确认后配对直接落盘；扩展下一次短间隔重试就会命中 AlreadyPaired。
            let dialog_state = state.clone();
            let dialog_origin = normalized_origin.clone();
            let dialog_locale = extension_locale_from_headers(&headers);

            // 故意丢弃 JoinHandle：blocking 任务不会因为句柄被丢就取消，
            // 这正是我们要的 —— 弹窗的寿命必须独立于请求。
            drop(tokio::task::spawn_blocking(move || {
                let outcome = confirm_extension_pairing(
                    &extension_id_for_display(&dialog_origin),
                    &dialog_locale,
                );

                match outcome {
                    PairingPromptOutcome::Approved => {
                        // 用户显然是要这个功能的，之前攒的拒绝计数清零。
                        dialog_state.reset_pairing_decline_count();

                        match dialog_state.confirm_extension_origin(&dialog_origin) {
                            Ok(()) => record_app_runtime_event(
                                "api",
                                "extension-register-confirmed",
                                Some(dialog_origin),
                            ),
                            Err(error) => record_app_runtime_event(
                                "api",
                                "extension-register-confirm-persist-failed",
                                Some(format!("{dialog_origin}: {error}")),
                            ),
                        }
                    }
                    PairingPromptOutcome::Declined => {
                        // **不持久化拒绝**：过了冷却期会再问一遍。用户可能只是当时没看清。
                        record_app_runtime_event(
                            "api",
                            "extension-register-declined",
                            Some(dialog_origin),
                        );

                        // 连续拒绝多次 = 这个人多半不知道这是什么、也不知道怎么让它停。
                        // 紧接着给一条明确出路，而不是让他继续每隔一阵被问一次。
                        if let Some(decline_count) = dialog_state.record_pairing_decline() {
                            offer_stop_asking(&dialog_state, decline_count, &dialog_locale);
                        }
                    }
                    PairingPromptOutcome::NotPrompted => {
                        // 预检与这里之间的竞态兜底：两个请求同时通过预检，其中一个会撞上
                        // 并发闸。额度必须还回去 —— 否则用户点完手上那个弹窗，
                        // 还得再等一整个冷却周期才可能看到下一个。
                        dialog_state.release_pairing_prompt_cooldown(&dialog_origin);
                        record_app_runtime_event(
                            "api",
                            "extension-register-prompt-skipped-in-flight",
                            Some(dialog_origin),
                        );
                    }
                }
            }));

            return Err((
                StatusCode::CONFLICT,
                PAIRING_CONFIRMATION_PENDING.to_string(),
            ));
        }
    }

    record_app_runtime_event("api", "extension-register-succeeded", Some(origin.clone()));

    Ok(Json(RegisterExtensionResponse {
        ok: true,
        allowed_origin: state.get_allowed_extension_origin().unwrap_or(origin),
        allowed_origins: state.get_allowed_extension_origins(),
    }))
}

pub(crate) async fn extension_heartbeat(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(payload): Json<ExtensionHeartbeatRequest>,
) -> Result<Json<ExtensionHeartbeatResponse>, (StatusCode, String)> {
    let origin = extension_origin_from_headers(&headers).ok_or_else(|| {
        record_app_runtime_event("api", "extension-heartbeat-missing-origin", None);
        (
            StatusCode::BAD_REQUEST,
            "missing extension origin".to_string(),
        )
    })?;

    state
        .record_extension_heartbeat(
            &origin,
            payload.client_id.as_deref(),
            payload.normal_window_count,
            &payload.preload_window_hwnds,
        )
        .map_err(|error| (StatusCode::FORBIDDEN, error.to_string()))?;
    let active_lease_count =
        state.active_extension_heartbeat_count(crate::api::EXTENSION_HEARTBEAT_TTL);
    let active_normal_window_count =
        state.active_extension_normal_window_count(crate::api::EXTENSION_HEARTBEAT_TTL);
    record_app_runtime_event(
        "api",
        "extension-heartbeat",
        Some(format!(
            "{origin}::active={active_lease_count}::normalWindows={active_normal_window_count}"
        )),
    );

    Ok(Json(ExtensionHeartbeatResponse {
        ok: true,
        active_lease_count,
        active_normal_window_count,
    }))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RegisterExtensionResponse {
    ok: bool,
    allowed_origin: String,
    allowed_origins: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExtensionHeartbeatRequest {
    #[serde(default)]
    client_id: Option<String>,
    #[serde(default)]
    normal_window_count: Option<usize>,
    #[serde(default)]
    preload_window_hwnds: Vec<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExtensionHeartbeatResponse {
    ok: bool,
    active_lease_count: usize,
    active_normal_window_count: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 弹窗里要展示的是**扩展 ID**，因为那正是用户能在 chrome://extensions 上核对的东西。
    /// 展示完整 origin（带 scheme 和尾斜杠）会让人对不上号。
    #[test]
    fn pairing_dialog_shows_the_bare_extension_id() {
        assert_eq!(
            extension_id_for_display("chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef/"),
            "abcdefghijklmnopqrstuvwxyzabcdef"
        );
        assert_eq!(
            extension_id_for_display("chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef"),
            "abcdefghijklmnopqrstuvwxyzabcdef"
        );
        // 形状不认识时原样展示，好过展示空字符串让用户无从判断。
        assert_eq!(extension_id_for_display("something-else"), "something-else");
    }
}
