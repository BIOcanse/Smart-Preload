//! 扩展配对确认弹窗。
//!
//! 此前 `/extension/register` 的唯一门槛是「manifest 形状匹配」——`manifest_version: 3` +
//! `service_worker: "service-worker.js"` + `options_page: "settings/index.html"` + 两个权限
//! 字段。这个指纹是**公开且可复制的**：任何用户装的扩展只要照抄这个形状就能注册成功，
//! 拿到本地 app 的全部只读接口，而且注册结果还会被写进 native messaging manifest 的
//! `allowed_origins`（`lifecycle/install/mod.rs:59-78`），连第二条通道一起给出去。
//!
//! 正解本来是钉住生产扩展 ID（Chrome 从开发者公钥派生，伪造不了），但仓库里没有记录该 ID、
//! `manifest.json` 也没有 `key` 字段，而 README 明确支持侧载——硬编码会直接破坏侧载与开发安装。
//!
//! 维护者裁定（2026-08-02）：**形状检查保留为预筛，真正的门是用户确认**。
//!   - 形状不匹配：连弹窗都不弹，直接拒绝。
//!   - 形状匹配但未配对：弹一次模态确认框。
//!   - 用户拒绝：**不持久化拒绝**，下次注册再问（用户口径：「未配对则每次都会尝试」）。
//!   - 已配对：直接放行，不再打扰。
//!   - 一个 app 可以配对多个扩展——`allowed_extension_origins` 本来就是集合。
//!
//! 用 `TaskDialogIndirect` 而不是 `MessageBoxW`（维护者裁定，2026-08-09）：`MessageBoxW` 的
//! 按钮文字来自**系统语言**，我们控制不了，所以中文系统上会出现「英文正文 + 中文是/否」，
//! 而英文系统上的中文用户则整个看不懂。TaskDialog 的每一段文字都由我们提供，
//! 多语言才真正可控；顺带拿到 Win10/11 的现代版式（大号主指令 + 说明段 + 页脚）。
//!
//! **文案必须由 app 自己带**，只有语言代号来自请求方——见 `text.rs` 顶部。

mod text;

use std::sync::atomic::{AtomicBool, Ordering};

use self::text::{dialog_text, normalize_locale, stop_asking_dialog_text, tray_menu_text};

/// 同一时刻只允许一个配对弹窗。
///
/// 扩展在注册失败后会重试，没有这道闸的话用户会被弹窗刷屏，而且每个弹窗都占一个
/// `spawn_blocking` 线程。弹窗进行中的其它注册请求直接判为「未确认」返回，
/// 由调用方重试即可——这与「未配对则每次都会尝试」的口径一致。
///
/// 注意这条只挡**并发**。挡不住「扩展每 30 秒重试一次」造成的连续弹窗，
/// 那由 `super::state` 的按 origin 冷却窗口负责。
static PAIRING_PROMPT_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

/// 一次配对尝试的结局。
///
/// `Declined` 与 `NotPrompted` 都不放行，但**必须分开**：
///   - 调用方要在没弹窗时把冷却额度还回去，否则一个开着的弹窗会让后续每个冷却周期
///     都空烧一次额度，用户点完还得再等一个周期才可能看到下一个弹窗；
///   - 诊断日志里两者混成 `declined` 会读成「用户拒绝了十次」，而用户一次都没看见。
///     实测就是这么误导人的（2026-08-09）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PairingPromptOutcome {
    /// 用户按下了确认按钮。
    Approved,
    /// 用户拒绝了，或者关掉/Esc 了弹窗。
    Declined,
    /// 压根没弹 —— 已有弹窗在进行中。不是用户的意思。
    NotPrompted,
}

/// 当前是否已有弹窗在等用户操作。
///
/// 调用方**必须先问这个再去领冷却额度**。反过来的话，一个开着的弹窗会让后续每次注册尝试
/// 都走一遍「领额度 → 撞并发闸 → 还额度」，冷却因此永远不生效，日志里每 30 秒多一条
/// 声称弹了窗的记录，而实际上一个都没弹（实测 2026-08-09）。
///
/// 这是个瞬时快照，和随后的 `confirm_extension_pairing` 之间存在竞态。竞态是良性的：
/// 真撞上了会返回 `NotPrompted`，调用方照常把额度还回去。这里只负责让**常见情况**
/// （弹窗已经开着好一会儿了）不产生任何副作用。
pub(crate) fn pairing_prompt_in_flight() -> bool {
    PAIRING_PROMPT_IN_FLIGHT.load(Ordering::SeqCst)
}

/// 弹之前要过的两道闸的结论。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PairingPromptGate {
    /// 两道闸都过了，可以弹。
    Show,
    /// 已有弹窗在等用户，这次不弹，**且没有消耗冷却额度**。
    SkipInFlight,
    /// 同一个扩展还在冷却期内。
    SkipCooldown,
}

/// 按正确顺序过闸。
///
/// 顺序是这个函数存在的全部理由：`in_flight` 命中时**绝不能**去调 `claim_cooldown_slot`。
/// 反过来的话，一个开着的弹窗会让后续每次注册尝试都走一遍「领额度 → 撞并发闸 → 还额度」，
/// 冷却因此永远不生效，日志里每 30 秒多一条声称弹了窗的记录（实测 2026-08-09）。
pub(crate) fn decide_pairing_prompt_gate(
    in_flight: bool,
    claim_cooldown_slot: impl FnOnce() -> bool,
) -> PairingPromptGate {
    if in_flight {
        return PairingPromptGate::SkipInFlight;
    }

    if !claim_cooldown_slot() {
        return PairingPromptGate::SkipCooldown;
    }

    PairingPromptGate::Show
}

/// 阻塞式弹出确认框。**必须在 `spawn_blocking` 里调用** —— 它会阻塞当前线程直到用户操作。
///
/// `requested_locale` 是请求方声明的界面语言，认不出来就回落英文。它不参与任何安全判定，
/// 最坏结果只是弹窗显示了错误的语言。
pub(crate) fn confirm_extension_pairing(
    extension_id: &str,
    requested_locale: &str,
) -> PairingPromptOutcome {
    if PAIRING_PROMPT_IN_FLIGHT
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return PairingPromptOutcome::NotPrompted;
    }

    let approved = show_pairing_dialog(extension_id, normalize_locale(requested_locale));
    PAIRING_PROMPT_IN_FLIGHT.store(false, Ordering::SeqCst);

    if approved {
        PairingPromptOutcome::Approved
    } else {
        PairingPromptOutcome::Declined
    }
}

/// 确认按钮的命令 ID。避开 `IDOK`/`IDYES` 等系统值，免得和 `TaskDialogIndirect`
/// 在异常路径上返回的通用按钮混淆。
#[cfg(windows)]
const CONFIRM_BUTTON_ID: i32 = 1001;
#[cfg(windows)]
const DECLINE_BUTTON_ID: i32 = 1002;

/// 连续拒绝到达阈值后弹的「不再提示」确认。**必须在 blocking 线程里调用**。
///
/// 存在的理由是「有人看到一个不认识的东西反复要权限，却不知道怎么让它停」。
/// 返回 `true` 表示用户选择不再提示。
///
/// 不走 `PAIRING_PROMPT_IN_FLIGHT`：它紧跟在刚刚关闭的配对弹窗之后，
/// 由同一个 blocking 任务串行弹出，本来就不会与别的弹窗并发。
pub(crate) fn confirm_stop_asking(decline_count: u32, requested_locale: &str) -> bool {
    show_stop_asking_dialog(decline_count, normalize_locale(requested_locale))
}

/// 托盘手动配对时，没有找到可配对扩展的提示框。**必须在 blocking 线程里调用**。
///
/// 用户刚点了菜单，什么反馈都没有的话他不知道是点没生效还是本来就没东西可配。
pub(crate) fn show_nothing_to_pair_notice(locale: &str) {
    show_nothing_to_pair_dialog(normalize_locale(locale));
}

/// 把任意语言代号归一成受支持的那一个。给 `state` 记住托盘语言时用。
pub(crate) fn normalized_ui_locale(requested_locale: &str) -> &'static str {
    normalize_locale(requested_locale)
}

/// 系统的界面语言，归一成受支持的那一个。
///
/// 托盘菜单在 host 启动时构建，那时如果**还没有任何扩展注册过**（首次运行），
/// 就没有可用的记录。没有这条回落的话，中文系统的用户第一次看到的托盘菜单一定是英文
/// —— 而弹窗又是跟着扩展语言走的中文，同一个程序两种语言。
///
/// 只作为**兜底**：扩展一旦报过语言，记录优先，因为用户可能在设置页显式选了别的语言。
pub(crate) fn system_ui_locale() -> Option<&'static str> {
    read_system_locale_name().map(|name| normalize_locale(&name))
}

#[cfg(windows)]
fn read_system_locale_name() -> Option<String> {
    use windows::Win32::Globalization::GetUserDefaultLocaleName;

    // LOCALE_NAME_MAX_LENGTH = 85。
    let mut buffer = [0_u16; 85];
    let length = unsafe { GetUserDefaultLocaleName(&mut buffer) };

    if length <= 1 {
        return None;
    }

    // 返回值含结尾的 NUL，切掉。
    Some(String::from_utf16_lossy(&buffer[..(length as usize - 1)]))
}

#[cfg(not(windows))]
fn read_system_locale_name() -> Option<String> {
    None
}

/// 托盘菜单的两段文字：手动配对、退出。
pub(crate) fn tray_labels(locale: &str) -> (&'static str, &'static str) {
    let text = tray_menu_text(normalize_locale(locale));
    (text.pair, text.exit)
}

#[cfg(windows)]
fn show_pairing_dialog(extension_id: &str, locale: &'static str) -> bool {
    let text = dialog_text(locale);
    let content = text.content.replace("{id}", extension_id);

    show_dialog_with_fallback(text, &content)
}

#[cfg(windows)]
fn show_stop_asking_dialog(decline_count: u32, locale: &'static str) -> bool {
    let text = stop_asking_dialog_text(locale);
    let content = text.content.replace("{count}", &decline_count.to_string());

    show_dialog_with_fallback(text, &content)
}

/// 托盘应用没有主窗口。不主动抢前台的话弹窗会被压在别的窗口后面，
/// 用户看不到却被挂住 —— 这正是 MessageBoxW 时代用 MB_SYSTEMMODAL 解决的问题。
///
/// 三个弹窗（配对、不再提示、没东西可配）共用同一个回调。
#[cfg(windows)]
unsafe extern "system" fn bring_dialog_to_front(
    window: windows::Win32::Foundation::HWND,
    notification: windows::Win32::UI::Controls::TASKDIALOG_NOTIFICATIONS,
    _wparam: windows::Win32::Foundation::WPARAM,
    _lparam: windows::Win32::Foundation::LPARAM,
    _reference_data: isize,
) -> windows::core::HRESULT {
    use windows::Win32::UI::Controls::TDN_CREATED;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetForegroundWindow, SetWindowPos, HWND_TOPMOST, SWP_NOMOVE, SWP_NOSIZE,
    };

    if notification == TDN_CREATED {
        unsafe {
            let _ = SetWindowPos(window, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
            let _ = SetForegroundWindow(window);
        }
    }

    windows::core::HRESULT(0)
}

/// 纯提示框：只有一个「知道了」，没有可选项。
#[cfg(windows)]
fn show_nothing_to_pair_dialog(locale: &'static str) {
    use std::iter::once;

    use windows::core::PCWSTR;
    use windows::Win32::UI::Controls::{
        TaskDialogIndirect, TASKDIALOGCONFIG, TDCBF_OK_BUTTON, TDF_ALLOW_DIALOG_CANCELLATION,
    };

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(once(0)).collect()
    }

    let menu = tray_menu_text(locale);
    let title = wide(dialog_text(locale).window_title);
    let instruction = wide(menu.nothing_to_pair_title);
    let body = wide(menu.nothing_to_pair_body);

    let config = TASKDIALOGCONFIG {
        cbSize: std::mem::size_of::<TASKDIALOGCONFIG>() as u32,
        dwFlags: TDF_ALLOW_DIALOG_CANCELLATION,
        dwCommonButtons: TDCBF_OK_BUTTON,
        pszWindowTitle: PCWSTR(title.as_ptr()),
        pszMainInstruction: PCWSTR(instruction.as_ptr()),
        pszContent: PCWSTR(body.as_ptr()),
        pfCallback: Some(bring_dialog_to_front),
        ..Default::default()
    };

    let _ = unsafe { TaskDialogIndirect(&config, None, None, None) };
}

#[cfg(not(windows))]
fn show_nothing_to_pair_dialog(_locale: &'static str) {}

#[cfg(windows)]
fn show_dialog_with_fallback(text: &text::PairingDialogText, content: &str) -> bool {
    match show_task_dialog(text, content) {
        Some(approved) => approved,
        // TaskDialog 需要 ComCtl32 v6 的激活上下文（见 build.rs）。万一某天清单没链进去，
        // 不能让确认框整个变成不可能——退回旧弹窗。按钮文字会退化成系统语言，
        // 但「能确认」比「文案好看」重要。
        None => show_message_box_fallback(text, content),
    }
}

/// 返回 `None` 表示 TaskDialog 本身调用失败（而不是用户拒绝）。
#[cfg(windows)]
fn show_task_dialog(text: &text::PairingDialogText, content: &str) -> Option<bool> {
    use std::iter::once;

    use windows::core::PCWSTR;
    use windows::Win32::UI::Controls::{
        TaskDialogIndirect, TASKDIALOGCONFIG, TASKDIALOG_BUTTON, TDF_ALLOW_DIALOG_CANCELLATION,
        TDF_USE_COMMAND_LINKS,
    };

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(once(0)).collect()
    }

    // 这些缓冲区必须活到 TaskDialogIndirect 返回为止 —— 配置里存的是裸指针。
    let window_title = wide(text.window_title);
    let main_instruction = wide(text.main_instruction);
    let content_wide = wide(content);
    let footer = wide(text.footer);
    let confirm_label = wide(text.confirm_button);
    let decline_label = wide(text.decline_button);

    let buttons = [
        TASKDIALOG_BUTTON {
            nButtonID: CONFIRM_BUTTON_ID,
            pszButtonText: PCWSTR(confirm_label.as_ptr()),
        },
        TASKDIALOG_BUTTON {
            nButtonID: DECLINE_BUTTON_ID,
            pszButtonText: PCWSTR(decline_label.as_ptr()),
        },
    ];

    let config = TASKDIALOGCONFIG {
        cbSize: std::mem::size_of::<TASKDIALOGCONFIG>() as u32,
        // TDF_USE_COMMAND_LINKS：两个按钮变成大号命令链接，用户扫一眼就知道各自会发生什么，
        // 比并排的「是/否」难点错得多。
        // TDF_ALLOW_DIALOG_CANCELLATION：允许 Esc / 关闭按钮，二者都判为拒绝——
        // 安全默认必须是「不连接」。
        dwFlags: TDF_USE_COMMAND_LINKS | TDF_ALLOW_DIALOG_CANCELLATION,
        pszWindowTitle: PCWSTR(window_title.as_ptr()),
        pszMainInstruction: PCWSTR(main_instruction.as_ptr()),
        pszContent: PCWSTR(content_wide.as_ptr()),
        pszFooter: PCWSTR(footer.as_ptr()),
        cButtons: buttons.len() as u32,
        pButtons: buttons.as_ptr(),
        // 默认落在「不连接」上：误按回车不能等于授权。
        nDefaultButton: DECLINE_BUTTON_ID,
        pfCallback: Some(bring_dialog_to_front),
        ..Default::default()
    };

    let mut pressed_button = 0_i32;
    let result = unsafe { TaskDialogIndirect(&config, Some(&mut pressed_button), None, None) };

    if result.is_err() {
        return None;
    }

    // 只有明确按下确认按钮才算通过。Esc、关闭按钮、以及任何异常返回值都是拒绝。
    Some(pressed_button == CONFIRM_BUTTON_ID)
}

#[cfg(windows)]
fn show_message_box_fallback(text: &text::PairingDialogText, content: &str) -> bool {
    use windows::core::HSTRING;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        MessageBoxW, IDYES, MB_ICONWARNING, MB_SETFOREGROUND, MB_SYSTEMMODAL, MB_YESNO,
    };

    let title = HSTRING::from(text.window_title);
    let body = HSTRING::from(format!(
        "{}\n\n{}\n\n{}",
        text.main_instruction, content, text.footer
    ));

    let result = unsafe {
        MessageBoxW(
            HWND::default(),
            &body,
            &title,
            MB_YESNO | MB_ICONWARNING | MB_SYSTEMMODAL | MB_SETFOREGROUND,
        )
    };

    result == IDYES
}

#[cfg(not(windows))]
fn show_pairing_dialog(_extension_id: &str, _locale: &'static str) -> bool {
    // 非 Windows 平台没有本地 app（隐藏窗口运行时是 Windows 专有的），
    // 这条分支只为让 crate 在其它平台上也能编译通过。不确认即不放行。
    false
}

#[cfg(not(windows))]
fn show_stop_asking_dialog(_decline_count: u32, _locale: &'static str) -> bool {
    // 同上。没弹窗就不改变现状。
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 并发闸：弹窗进行中时，第二个请求必须立刻返回 false 而不是再弹一个。
    #[test]
    fn concurrent_prompts_are_rejected_without_a_second_dialog() {
        assert!(!PAIRING_PROMPT_IN_FLIGHT.load(Ordering::SeqCst));

        PAIRING_PROMPT_IN_FLIGHT.store(true, Ordering::SeqCst);

        // 调用方靠这个预检避开「领额度 → 撞闸 → 还额度」的空转，它必须如实反映状态。
        assert!(
            pairing_prompt_in_flight(),
            "有弹窗在进行中时预检必须返回 true —— 否则冷却窗口在弹窗开着期间完全失效"
        );

        assert_eq!(
            confirm_extension_pairing("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "en"),
            PairingPromptOutcome::NotPrompted,
            "已有弹窗在进行中时不得再弹一个，而且必须与「用户拒绝」区分开 —— \
             混成 Declined 会让调用方白烧一次冷却额度，日志也会读成用户拒绝过"
        );

        PAIRING_PROMPT_IN_FLIGHT.store(false, Ordering::SeqCst);
    }

    /// 闸的顺序：并发闸命中时**绝不能**去碰冷却额度。
    ///
    /// 这条正是 2026-08-09 实测踩到的：顺序反了的话，一个开着的弹窗会让后续每次尝试都走
    /// 「领额度 → 撞并发闸 → 还额度」，冷却窗口在弹窗开着期间完全失效，日志里每 30 秒
    /// 多一条声称弹了窗的记录，而一个弹窗都没弹。
    #[test]
    fn an_in_flight_prompt_does_not_touch_the_cooldown_budget() {
        let claim_attempts = std::cell::Cell::new(0);

        let gate = decide_pairing_prompt_gate(true, || {
            claim_attempts.set(claim_attempts.get() + 1);
            true
        });

        assert_eq!(gate, PairingPromptGate::SkipInFlight);
        assert_eq!(
            claim_attempts.get(),
            0,
            "并发闸命中时仍然去领了冷却额度 —— 那份额度会被空烧，\
             用户点完手上的弹窗后还得再等一整个冷却周期"
        );
    }

    #[test]
    fn the_gate_reports_each_reason_distinctly() {
        assert_eq!(
            decide_pairing_prompt_gate(false, || true),
            PairingPromptGate::Show
        );
        assert_eq!(
            decide_pairing_prompt_gate(false, || false),
            PairingPromptGate::SkipCooldown
        );
        assert_eq!(
            decide_pairing_prompt_gate(true, || true),
            PairingPromptGate::SkipInFlight,
            "并发闸必须优先于冷却闸 —— 两者混在一起就没法从日志区分「用户还没点」和「太频繁」"
        );
    }

    /// 扩展 ID 必须真的进到正文里 —— 用户核对的就是这一串。
    #[test]
    fn the_extension_id_is_substituted_into_the_content() {
        let extension_id = "poikolgeopfpaoainnakkbjlbmloploc";

        for locale in text::SUPPORTED_LOCALES {
            let content = dialog_text(locale).content.replace("{id}", extension_id);
            assert!(
                content.contains(extension_id),
                "{locale} 的正文里没有扩展 ID"
            );
            assert!(
                !content.contains("{id}"),
                "{locale} 的正文里还留着未替换的占位符"
            );
        }
    }
}

#[cfg(test)]
mod system_locale_tests {
    use super::*;

    /// 首次运行（还没有任何扩展报过语言）时托盘菜单的语言来源。
    ///
    /// 没有这条回落的话，中文系统的用户第一次看到的托盘菜单一定是英文，
    /// 而弹窗又是跟着扩展语言走的中文 —— 同一个程序两种语言。
    #[test]
    fn the_system_locale_is_readable_and_supported() {
        let locale = system_ui_locale();

        if cfg!(windows) {
            let locale = locale.expect("Windows 上应当读得到系统界面语言");
            assert!(
                text::SUPPORTED_LOCALES.contains(&locale),
                "系统语言归一化后不在受支持列表里：{locale}"
            );
        } else {
            assert_eq!(locale, None, "非 Windows 平台没有这个概念，应当返回 None");
        }
    }
}
