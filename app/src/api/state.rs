use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::Result;

use crate::lifecycle::{target_extension_ids, target_extension_origin_is_installed};
use crate::telemetry::{ActivitySnapshot, SystemProcessSampler, SystemSnapshot, SystemSnapshotter};
use tokio::sync::watch;

use super::origin::normalize_extension_origin;
use super::pairing::{normalized_ui_locale, system_ui_locale};
use super::persistence::{
    load_allowed_extension_origins, load_debug_api_token, load_last_ui_locale,
    load_pairing_decline_count, load_pairing_prompts_suppressed, persist_allowed_extension_origins,
    persist_last_ui_locale, persist_pairing_decline_count, persist_pairing_prompts_suppressed,
};

#[derive(Clone)]
pub struct ApiState {
    snapshotter: SystemSnapshotter,
    allowed_extension_origins: Arc<Mutex<BTreeSet<String>>>,
    extension_heartbeats: Arc<Mutex<BTreeMap<String, ExtensionHeartbeatLease>>>,
    debug_api_token: Arc<Mutex<Option<String>>>,
    pairing_prompt_cooldowns: Arc<Mutex<BTreeMap<String, Instant>>>,
    pairing_decline_count: Arc<Mutex<u32>>,
    pairing_prompts_suppressed: Arc<Mutex<bool>>,
    /// 扩展**报过**的界面语言。`None` = 从来没人报过。
    ///
    /// 刻意不在这里塞系统语言兜底：那样「记住的值」与「兜底值」就分不开了，
    /// 扩展第一次报的语言会因为「和兜底值相同」而永远不落盘。
    remembered_ui_locale: Arc<Mutex<Option<String>>>,
    host_shutdown_tx: watch::Sender<bool>,
}

/// 连续拒绝多少次之后，多问一句「要不要以后都不再提示」。
///
/// 场景：有人看到一个不认识的东西反复要权限，拒绝了几次，却不知道它是什么、怎么让它停。
/// 取 3：少于这个数还谈不上「反复」，多了则把人晾太久。
///
/// 计数是**全局的**而不是按 origin 分的 —— 用户要处置的是这个 app 本身，
/// 不是某一个扩展。
const PAIRING_DECLINES_BEFORE_STOP_ASKING_OFFER: u32 = 3;

/// 同一个 origin 两次配对弹窗之间的最短间隔。
///
/// 扩展的心跳与唤醒重试都是 30 秒一次（`NATIVE_APP_HEARTBEAT_INTERVAL_SECONDS`、
/// `NATIVE_APP_WAKE_RETRY_INTERVAL_SECONDS`），两个定时器错开触发时用户会在半分钟内
/// 被弹两次。取 5 分钟：足够盖住自动重试的节奏，又短到用户主动去点「连接本地 App」
/// 时不会觉得功能坏了。
///
/// **这不是持久化拒绝**：冷却只在内存里，过期后照样会再问，重启 app 也会清零。
/// 产品口径「未配对则每次都会尝试」保持不变，被压掉的只是自动重试的连珠炮。
const PAIRING_PROMPT_COOLDOWN: Duration = Duration::from_secs(300);

/// `/extension/register` 的三种结局。弹窗是阻塞操作，所以判定与弹窗必须分开：
/// 判定在 async 处理器里同步做，弹窗交给 `spawn_blocking`。
pub(crate) enum ExtensionRegistrationDecision {
    /// 已经配对过，直接放行。
    AlreadyPaired,
    /// manifest 形状都不匹配，连弹窗都不弹。
    Rejected,
    /// 形状匹配但未配对，需要用户确认。
    NeedsConfirmation { normalized_origin: String },
}

#[derive(Clone)]
struct ExtensionHeartbeatLease {
    last_seen_at: Instant,
    normal_window_count: Option<usize>,
    preload_window_hwnds: BTreeSet<u64>,
}

impl ApiState {
    pub fn new(snapshotter: SystemSnapshotter, host_shutdown_tx: watch::Sender<bool>) -> Self {
        Self {
            snapshotter,
            allowed_extension_origins: Arc::new(Mutex::new(load_allowed_extension_origins())),
            extension_heartbeats: Arc::new(Mutex::new(BTreeMap::new())),
            debug_api_token: Arc::new(Mutex::new(load_debug_api_token())),
            pairing_prompt_cooldowns: Arc::new(Mutex::new(BTreeMap::new())),
            pairing_decline_count: Arc::new(Mutex::new(load_pairing_decline_count())),
            pairing_prompts_suppressed: Arc::new(Mutex::new(load_pairing_prompts_suppressed())),
            remembered_ui_locale: Arc::new(Mutex::new(load_last_ui_locale())),
            host_shutdown_tx,
        }
    }

    pub(crate) fn snapshot(&self) -> Result<SystemSnapshot> {
        self.snapshotter.collect_snapshot()
    }

    pub(crate) fn activity_snapshot(&self) -> Result<ActivitySnapshot> {
        self.snapshotter.collect_activity_snapshot()
    }

    pub(crate) fn process_sampler(&self) -> SystemProcessSampler {
        self.snapshotter.process_sampler()
    }

    pub(crate) fn get_allowed_extension_origin(&self) -> Option<String> {
        self.allowed_extension_origins
            .lock()
            .ok()
            .and_then(|value| value.iter().next().cloned())
    }

    pub(crate) fn get_allowed_extension_origins(&self) -> Vec<String> {
        self.allowed_extension_origins
            .lock()
            .map(|value| value.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// 注册决策。弹窗必须在 `spawn_blocking` 里做，所以这里只判定、不阻塞。
    pub(crate) fn decide_extension_registration(
        &self,
        origin: &str,
    ) -> Result<ExtensionRegistrationDecision> {
        let normalized_origin = normalize_extension_origin(origin)
            .ok_or_else(|| anyhow::anyhow!("invalid extension origin"))?;
        let guard = self
            .allowed_extension_origins
            .lock()
            .map_err(|_| anyhow::anyhow!("extension origin lock poisoned"))?;

        // 已配对：直接放行，不再打扰用户。
        if guard.contains(&normalized_origin) {
            return Ok(ExtensionRegistrationDecision::AlreadyPaired);
        }

        drop(guard);

        // 形状预筛。连形状都不匹配的，连弹窗都不弹 —— 否则任何网页可达的注册尝试
        // 都能把弹窗砸到用户脸上。
        if !target_extension_origin_is_installed(&normalized_origin) {
            return Ok(ExtensionRegistrationDecision::Rejected);
        }

        Ok(ExtensionRegistrationDecision::NeedsConfirmation { normalized_origin })
    }

    /// 领取一次弹窗额度。返回 `true` 表示可以弹；`false` 表示同一个 origin 还在冷却期内。
    ///
    /// 冷却从**弹窗弹出**时开始计时，而不是从用户点完开始 —— 用户可能盯着弹窗看几分钟，
    /// 那段时间里堆积的重试不该在他点完之后立刻再弹一个。
    pub(crate) fn begin_pairing_prompt_cooldown(&self, normalized_origin: &str) -> bool {
        let Ok(mut guard) = self.pairing_prompt_cooldowns.lock() else {
            // 锁中毒时宁可不弹：弹窗是打扰用户的操作，失败方向应当是「安静」。
            // 拒绝不影响安全（未确认 = 不放行），用户下次仍可重试。
            return false;
        };

        claim_pairing_prompt_slot(&mut guard, normalized_origin, Instant::now())
    }

    /// 把没用上的弹窗额度还回去。
    ///
    /// 领了额度却没真的弹（已有弹窗在进行中）时必须调用。不还的话，一个开着的弹窗会让
    /// **后续每个冷却周期都空烧一次额度**——用户点完手上这个，还得再等一整个周期才可能
    /// 看到下一个弹窗。实测：一个弹窗开了 50 分钟，期间十个周期全被烧光（2026-08-09）。
    pub(crate) fn release_pairing_prompt_cooldown(&self, normalized_origin: &str) {
        if let Ok(mut guard) = self.pairing_prompt_cooldowns.lock() {
            guard.remove(normalized_origin);
        }
    }

    /// 记一次拒绝，返回是否该顺势问一句「要不要以后都不再提示」。
    ///
    /// 到达阈值时**当场清零**：这是给一条出路，不是每拒绝一次就追问一次。
    /// 清零之后要再攒满一轮才会再问。
    pub(crate) fn record_pairing_decline(&self) -> Option<u32> {
        let Ok(mut guard) = self.pairing_decline_count.lock() else {
            return None;
        };

        let (next_count, offer) = advance_pairing_decline_count(*guard);
        *guard = next_count;
        let _ = persist_pairing_decline_count(next_count);
        offer
    }

    /// 用户接受了配对 —— 他显然是要这个功能的，之前的拒绝计数清零。
    pub(crate) fn reset_pairing_decline_count(&self) {
        if let Ok(mut guard) = self.pairing_decline_count.lock() {
            if *guard == 0 {
                return;
            }
            *guard = 0;
            let _ = persist_pairing_decline_count(0);
        }
    }

    /// 本机装着、形状匹配、但还没配对的扩展 origin。托盘手动配对用它列出候选。
    ///
    /// **走的是和自动路径完全相同的形状预筛**（`target_extension_ids()` 扫浏览器配置目录，
    /// 逐个核对 manifest 指纹）——手动入口不是绕过安全检查的后门，
    /// 它只是让用户能自己发起那次确认，确认框本身一点没少。
    pub(crate) fn unpaired_target_extension_origins(&self) -> Vec<String> {
        let paired = self
            .allowed_extension_origins
            .lock()
            .map(|value| value.clone())
            .unwrap_or_default();

        target_extension_ids()
            .into_iter()
            .filter_map(|extension_id| {
                normalize_extension_origin(&format!("chrome-extension://{extension_id}"))
            })
            .filter(|origin| !paired.contains(origin))
            .collect()
    }

    /// 用户是否选择了「不再提示」。
    ///
    /// 读失败当作「没关」：宁可多问一次，也不要因为一次读盘抖动就让功能永久静音、
    /// 而用户完全不知道发生了什么。
    pub(crate) fn pairing_prompts_suppressed(&self) -> bool {
        self.pairing_prompts_suppressed
            .lock()
            .map(|value| *value)
            .unwrap_or(false)
    }

    /// 设置「不再提示」。托盘菜单里的手动配对会用 `false` 把它清掉 —— 出路必须可逆。
    pub(crate) fn set_pairing_prompts_suppressed(&self, suppressed: bool) {
        if let Ok(mut guard) = self.pairing_prompts_suppressed.lock() {
            if *guard == suppressed {
                return;
            }
            *guard = suppressed;
            let _ = persist_pairing_prompts_suppressed(suppressed);
        }
    }

    /// 记下请求方声明的界面语言，供托盘菜单使用。
    ///
    /// 托盘菜单在 host 启动时构建，那时没有请求上下文；没有这份记录，
    /// 菜单只能用英文，而弹窗跟着扩展语言走 —— 同一个程序两种语言。
    ///
    /// **没带这个头 = 没有意见，不是「英文」。** 旧版扩展压根不发它；
    /// 把缺失当成英文的话，一个旧版扩展每 30 秒重试一次就会把语言反复刷回英文
    /// （实测 2026-08-11：托盘菜单是中文、配对弹窗却是英文，就是这么来的）。
    pub(crate) fn remember_ui_locale(&self, requested_locale: &str) {
        if requested_locale.trim().is_empty() {
            return;
        }

        let normalized = normalized_ui_locale(requested_locale);

        if let Ok(mut guard) = self.remembered_ui_locale.lock() {
            if guard.as_deref() == Some(normalized) {
                return;
            }
            *guard = Some(normalized.to_string());
            let _ = persist_last_ui_locale(normalized);
        }
    }

    /// 托盘菜单与托盘触发的弹窗使用的语言。
    ///
    /// 优先用扩展报过的（可能是用户在设置页显式选的），首次运行还没人报过时回落系统语言，
    /// 最后才是英文。没有系统语言这一层的话，中文系统的用户第一次看到的托盘菜单一定是英文，
    /// 而弹窗又是跟着扩展语言走的中文 —— 同一个程序两种语言。
    pub(crate) fn ui_locale(&self) -> String {
        let remembered = self
            .remembered_ui_locale
            .lock()
            .ok()
            .and_then(|value| value.clone());

        remembered
            .or_else(|| system_ui_locale().map(str::to_string))
            .unwrap_or_else(|| "en".to_string())
    }

    /// 用户已在弹窗里确认，落盘配对。
    ///
    /// 集合语义天然支持一个 app 配对多个扩展。**拒绝不落盘** —— 下次注册会再问一遍，
    /// 这是刻意的：用户可能只是当时没看清。
    pub(crate) fn confirm_extension_origin(&self, normalized_origin: &str) -> Result<()> {
        let mut guard = self
            .allowed_extension_origins
            .lock()
            .map_err(|_| anyhow::anyhow!("extension origin lock poisoned"))?;
        guard.insert(normalized_origin.to_string());
        persist_allowed_extension_origins(&guard)
    }

    pub(crate) fn record_extension_heartbeat(
        &self,
        origin: &str,
        client_id: Option<&str>,
        normal_window_count: Option<usize>,
        preload_window_hwnds: &[u64],
    ) -> Result<()> {
        let normalized_origin = normalize_extension_origin(origin)
            .ok_or_else(|| anyhow::anyhow!("invalid extension origin"))?;

        if !self.is_authorized_extension_origin(&normalized_origin) {
            return Err(anyhow::anyhow!("extension origin is not authorized"));
        }

        let mut guard = self
            .extension_heartbeats
            .lock()
            .map_err(|_| anyhow::anyhow!("extension heartbeat lock poisoned"))?;
        guard.insert(
            build_extension_heartbeat_key(&normalized_origin, client_id),
            ExtensionHeartbeatLease {
                last_seen_at: Instant::now(),
                normal_window_count,
                preload_window_hwnds: normalize_preload_window_hwnds(preload_window_hwnds),
            },
        );
        Ok(())
    }

    pub(crate) fn active_extension_heartbeat_count(&self, ttl: Duration) -> usize {
        self.prune_and_count_extension_heartbeats(ttl)
            .map(|(active_count, _normal_window_count, _window_report_count)| active_count)
            .unwrap_or(0)
    }

    pub(crate) fn active_extension_normal_window_count(&self, ttl: Duration) -> usize {
        self.prune_and_count_extension_heartbeats(ttl)
            .map(|(_active_count, normal_window_count, _window_report_count)| normal_window_count)
            .unwrap_or(0)
    }

    pub(crate) fn active_extension_window_report_count(&self, ttl: Duration) -> usize {
        self.prune_and_count_extension_heartbeats(ttl)
            .map(|(_active_count, _normal_window_count, window_report_count)| window_report_count)
            .unwrap_or(0)
    }

    fn prune_and_count_extension_heartbeats(&self, ttl: Duration) -> Option<(usize, usize, usize)> {
        let Ok(mut guard) = self.extension_heartbeats.lock() else {
            return None;
        };
        let now = Instant::now();

        let stale_keys: Vec<String> = guard
            .iter()
            .filter(|(_key, lease)| now.duration_since(lease.last_seen_at) > ttl)
            .map(|(key, _lease)| key.clone())
            .collect();
        let stale_hwnds: BTreeSet<u64> = stale_keys
            .iter()
            .filter_map(|key| guard.get(key))
            .flat_map(|lease| lease.preload_window_hwnds.iter().copied())
            .collect();

        for key in stale_keys {
            guard.remove(&key);
        }

        let active_count = guard.len();
        let window_report_count = guard
            .values()
            .filter(|lease| lease.normal_window_count.is_some())
            .count();
        let normal_window_count = guard
            .values()
            .map(|lease| lease.normal_window_count.unwrap_or(0))
            .sum();

        drop(guard);

        if !stale_hwnds.is_empty() {
            crate::window::close_tracked_hidden_windows_by_hwnds(
                &stale_hwnds.into_iter().collect::<Vec<_>>(),
                "extension-heartbeat-expired",
            );
        }

        Some((active_count, normal_window_count, window_report_count))
    }

    pub(super) fn is_authorized_extension_origin(&self, origin: &str) -> bool {
        let Some(normalized_origin) = normalize_extension_origin(origin) else {
            return false;
        };

        self.allowed_extension_origins
            .lock()
            .map(|allowed_origins| allowed_origins.contains(&normalized_origin))
            .unwrap_or(false)
    }

    pub(super) fn is_authorized_debug_token(&self, token: &str) -> bool {
        let provided = token.trim();
        if provided.is_empty() {
            return false;
        }

        self.debug_api_token
            .lock()
            .ok()
            .and_then(|value| value.clone())
            .map(|expected| constant_time_token_equal(&expected, provided))
            .unwrap_or(false)
    }

    pub(crate) fn request_host_shutdown(&self) {
        let _ = self.host_shutdown_tx.send(true);
    }
}

/// 常数时间比较 debug token。
///
/// 此前用的是 `expected == provided`，String 的 `==` 会在第一个不同字节处提前返回，
/// 泄漏「前缀对了多少」——足以按字节逐位试探出整个 token。
/// `update/verification.rs:180-187` 早就有一个 `constant_time_equal`，但它是
/// `[u8; 32]` 专用且私有于那个模块，所以这里写一份变长版本。
///
/// 长度本身不隐藏（长度不是秘密），但长度相同时的比较不因内容提前退出。
fn constant_time_token_equal(expected: &str, provided: &str) -> bool {
    let expected_bytes = expected.as_bytes();
    let provided_bytes = provided.as_bytes();

    if expected_bytes.len() != provided_bytes.len() {
        return false;
    }

    expected_bytes
        .iter()
        .zip(provided_bytes)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

fn build_extension_heartbeat_key(origin: &str, client_id: Option<&str>) -> String {
    format!(
        "{origin}::{}",
        normalize_heartbeat_client_id(client_id).unwrap_or_else(|| "default".to_string())
    )
}

fn normalize_heartbeat_client_id(client_id: Option<&str>) -> Option<String> {
    let value = client_id?.trim();

    if value.len() < 8 || value.len() > 128 {
        return None;
    }

    if !value.chars().all(|character| {
        character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-' | ':')
    }) {
        return None;
    }

    Some(value.to_string())
}

fn normalize_preload_window_hwnds(values: &[u64]) -> BTreeSet<u64> {
    values
        .iter()
        .copied()
        .filter(|value| *value > 0)
        .take(128)
        .collect()
}

/// 拒绝计数的推进规则。抽成纯函数是为了能直接测 —— 否则测它就得真的往磁盘写计数文件。
///
/// 返回 `(新计数, 是否该弹卸载确认)`。到阈值时**当场清零**：卸载确认是给一条出路，
/// 不是每拒绝一次就追问一次；清零后要再攒满一轮才会再问。
fn advance_pairing_decline_count(current: u32) -> (u32, Option<u32>) {
    let count = current.saturating_add(1);

    if count < PAIRING_DECLINES_BEFORE_STOP_ASKING_OFFER {
        return (count, None);
    }

    (0, Some(count))
}

/// 冷却窗口的全部逻辑。抽成自由函数是为了能注入时间 —— 否则测「5 分钟后能再弹」
/// 就得真的睡 5 分钟。
fn claim_pairing_prompt_slot(
    cooldowns: &mut BTreeMap<String, Instant>,
    normalized_origin: &str,
    now: Instant,
) -> bool {
    // 顺手清掉过期条目。origin 数量本就是个位数，不需要更复杂的淘汰策略。
    cooldowns.retain(|_, prompted_at| {
        now.checked_duration_since(*prompted_at)
            .is_some_and(|elapsed| elapsed < PAIRING_PROMPT_COOLDOWN)
    });

    if cooldowns.contains_key(normalized_origin) {
        return false;
    }

    cooldowns.insert(normalized_origin.to_string(), now);
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    const ORIGIN: &str = "chrome-extension://poikolgeopfpaoainnakkbjlbmloploc";
    const OTHER_ORIGIN: &str = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    /// 实测的故障场景：扩展的心跳与唤醒重试都是 30 秒一次，两个定时器错开触发时，
    /// 用户在 94 秒里被同一个弹窗砸了 7 次。冷却窗口必须把重复的那些全部压掉。
    #[test]
    fn repeated_attempts_within_the_cooldown_do_not_prompt_again() {
        let mut cooldowns = BTreeMap::new();
        let start = Instant::now();

        assert!(
            claim_pairing_prompt_slot(&mut cooldowns, ORIGIN, start),
            "第一次必须能弹"
        );

        // 冷却窗口内按 30 秒一次重试，一次都不该再弹。
        // 边界（正好 PAIRING_PROMPT_COOLDOWN）属于「已过期」，由下一条测试负责。
        let attempts_inside_window = PAIRING_PROMPT_COOLDOWN.as_secs() / 30;

        for step in 1..attempts_inside_window {
            let later = start + Duration::from_secs(30 * step);
            assert!(
                !claim_pairing_prompt_slot(&mut cooldowns, ORIGIN, later),
                "冷却期内第 {step} 次重试又弹了弹窗"
            );
        }

        assert!(
            attempts_inside_window >= 7,
            "冷却窗口短于实测的故障时长（94 秒 7 次），压不住自动重试"
        );
    }

    /// 冷却不是「持久化拒绝」：过期后照样会再问，产品口径「未配对则每次都会尝试」不变。
    #[test]
    fn the_prompt_comes_back_after_the_cooldown_expires() {
        let mut cooldowns = BTreeMap::new();
        let start = Instant::now();

        assert!(claim_pairing_prompt_slot(&mut cooldowns, ORIGIN, start));
        assert!(
            claim_pairing_prompt_slot(&mut cooldowns, ORIGIN, start + PAIRING_PROMPT_COOLDOWN),
            "冷却到期后必须能再问 —— 否则就等于把拒绝持久化了"
        );
    }

    /// 一个 app 可以配对多个扩展，冷却必须按 origin 分别计。
    #[test]
    fn the_cooldown_is_per_origin() {
        let mut cooldowns = BTreeMap::new();
        let start = Instant::now();

        assert!(claim_pairing_prompt_slot(&mut cooldowns, ORIGIN, start));
        assert!(
            claim_pairing_prompt_slot(&mut cooldowns, OTHER_ORIGIN, start),
            "另一个扩展的配对请求被前一个的冷却挡住了"
        );
    }

    /// 领了额度但没弹窗时必须把额度还回去。
    ///
    /// 实测的故障（2026-08-09）：一个弹窗开着的 50 分钟里，后续每个冷却周期都被
    /// 「领额度 → 撞上并发闸 → 直接返回」空烧一次，一共烧掉十次。用户点完手上那个之后，
    /// 还得再等一整个周期才可能看到下一个弹窗。
    #[test]
    fn an_unused_prompt_slot_can_be_released_immediately() {
        let mut cooldowns = BTreeMap::new();
        let start = Instant::now();

        assert!(claim_pairing_prompt_slot(&mut cooldowns, ORIGIN, start));

        // 先证明「不还」确实会挡住 —— 否则下面的断言证明不了任何东西。
        assert!(
            !claim_pairing_prompt_slot(&mut cooldowns, ORIGIN, start),
            "夹具无效：额度没被占住，那么「还回去」也就无从证明"
        );

        cooldowns.remove(ORIGIN);

        assert!(
            claim_pairing_prompt_slot(&mut cooldowns, ORIGIN, start),
            "额度还回去之后必须能立刻再领 —— 那次尝试根本没弹窗，不该消耗配额"
        );
    }

    /// 攒够阈值才给出路，之前每一次拒绝都只是安静地记一笔。
    #[test]
    fn the_stop_asking_offer_only_appears_after_repeated_declines() {
        let mut count = 0;

        for step in 1..PAIRING_DECLINES_BEFORE_STOP_ASKING_OFFER {
            let (next, offer) = advance_pairing_decline_count(count);
            assert_eq!(
                offer, None,
                "第 {step} 次拒绝就弹了「不再提示」确认 —— 太急了"
            );
            assert_eq!(next, step, "计数没有累加");
            count = next;
        }

        let (next, offer) = advance_pairing_decline_count(count);
        assert_eq!(
            offer,
            Some(PAIRING_DECLINES_BEFORE_STOP_ASKING_OFFER),
            "连续拒绝到阈值了还不给出路 —— 不知情的用户会一直被问下去"
        );
        assert_eq!(
            next, 0,
            "弹过一次之后计数必须清零，否则之后每拒绝一次都要追问一次"
        );
    }

    /// 弹过之后要再攒满一轮才会再问 —— 不能变成骚扰。
    #[test]
    fn the_offer_does_not_repeat_on_every_later_decline() {
        let (mut count, offer) =
            advance_pairing_decline_count(PAIRING_DECLINES_BEFORE_STOP_ASKING_OFFER - 1);
        assert!(offer.is_some(), "夹具没走到弹出那一步");

        for step in 1..PAIRING_DECLINES_BEFORE_STOP_ASKING_OFFER {
            let (next, offer) = advance_pairing_decline_count(count);
            assert_eq!(offer, None, "刚弹过又在第 {step} 次拒绝时追问了一遍");
            count = next;
        }
    }

    /// 计数溢出不能 panic，也不能因为回绕而漏掉出路。
    #[test]
    fn a_saturated_counter_still_offers_the_way_out() {
        let (next, offer) = advance_pairing_decline_count(u32::MAX);
        assert_eq!(offer, Some(u32::MAX), "计数饱和后不再给出路");
        assert_eq!(next, 0);
    }

    /// 过期条目要被清掉，否则这张表会随着注册尝试无限长大。
    #[test]
    fn expired_entries_are_evicted() {
        let mut cooldowns = BTreeMap::new();
        let start = Instant::now();

        for index in 0..50 {
            let origin = format!("chrome-extension://{}", "a".repeat(31) + &index.to_string());
            claim_pairing_prompt_slot(&mut cooldowns, &origin, start);
        }
        assert_eq!(cooldowns.len(), 50);

        claim_pairing_prompt_slot(&mut cooldowns, ORIGIN, start + PAIRING_PROMPT_COOLDOWN);
        assert_eq!(cooldowns.len(), 1, "过期条目没有被清掉，表会无限长大");
    }
}
