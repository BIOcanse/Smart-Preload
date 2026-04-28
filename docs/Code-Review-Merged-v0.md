# 代码整体审查合并清单 v0

这份文档用于合并整理两份独立审查结果：

- Claude：`docs/Code-Review-Issues-v0-Claude.md`
- Codex：`docs/Codex-Review-Findings-2026-04-18.md`

原则：

- 只合并、去重、归类，不覆盖原始文档
- 仍然只列问题，不给修复方案
- 同一问题若两边都提到，合并成一条，并标记来源
- 以“先系统性风险，再局部实现，再文档与开放问题”的顺序整理

> 状态说明（2026-04-18，第二轮修复后）
>
> 以下问题已修复或明显缓解，不再视为当前阻塞项：
>
> - `1.1` 本地 app API 授权边界仍然过宽
> - `1.2` Hidden-tab 激活顺序与冻结设计相反
> - `1.3` Source-lock 生命周期不完整
> - `1.4` 全局 mutation queue 会被长任务堵住
> - `1.5` 候选扫描与页面摘要上报绑定
> - `2.1` `A -> A` 自环没有显式守卫
> - `2.5` AI 是否启用依赖设置缓存
> - `2.6` 候选池按 URL 只保留第一次出现的链接
> - `2.7` Wasm 引擎首次加载失败后不会重试
> - `2.9` 频数乘区实现与文档语义绑定过松
> - `2.10` AI interest keyword 推理未显式压制思考链
> - `2.13` hidden-tab loading 点击回退后后台 tab 继续消耗资源
> - `3.1` `createdAt` 仍像预留字段
>
> 以下问题已部分缓解，但仍可能继续优化：
>
> - `2.3` 预加载窗口隐藏链
> - `2.4` 预加载窗口创建与复用竞态
> - `2.8` 当前窗口标签页进入 AI 上下文时文本仍偏弱

---

## 1. P1 严重问题

### 1.1 本地 app API 授权边界仍然过宽

- 来源：Claude + Codex
- 位置：`app/src/api.rs:88-100`
- 现状：本地 HTTP API 已不再对普通网页开放，但仍允许任意 `chrome-extension://...` 源访问。
- 影响：用户机器上的任意 Chrome 扩展都可以直接调用：
  - `/api/v1/ai/infer`
  - `/api/v1/ai/models/install`
  - `/api/v1/windows/hide`
  - `/api/v1/windows/show`
- 结论：本地工具层仍然暴露给“所有扩展”，而不是“本扩展”，这会把模型管理、窗口隐藏和系统信息接口变成跨扩展控制面。

### 1.2 Hidden-tab 激活顺序与冻结设计相反，存在丢边窗口

- 来源：Claude
- 位置：`extansion/background/preload/runtime/activation/flow.js:45-67`
- 设计要求：先锁定 source 当前页并写真实跳转消息，再把预加载 tab 移入正常窗口。
- 实际顺序：
  1. `chrome.tabs.move(...)`
  2. `chrome.tabs.update(..., { active: true })`
  3. `recordActivatedPreloadedTransition(...)`
- 影响：
  - move 后、record 前若崩溃或 worker 重启，用户已完成切页，但图里没有这条边。
  - move 会提前触发激活/导航相关事件，其他 listener 可能在 `pendingSources` 尚未写入前读到空 source。

### 1.3 Source-lock 生命周期不完整：没有 TTL，且在部分 commit 后不会释放

- 来源：Claude
- 位置：
  - 写入：`extansion/background/preload/runtime/activation/tracking.js:17-22`
  - 写入：`extansion/background/tracking/graph/events/tabs.js:8-12`
  - 读取：`extansion/background/tracking/graph/events/transitions.js:5-40`
- 现状：
  - `pendingSources[tabId].createdAt` 被写入，但仓库内没有任何 TTL/过期检查。
  - `pendingSources` 只在“真正记录了一条 transition”时清掉；若 commit 发生但被判定为不记录，lock 会残留。
- 影响：
  - 取消跳转、失败跳转、未真正打开的新标签等场景会留下永不过期的 source lock。
  - 后续真实跳转可能错误继承旧 source，写出错误的 `A -> C` 边。

### 1.4 全局 mutation queue 会被 AI 推理和模型管理长任务堵住

- 来源：Codex
- 位置：
  - `extansion/background/core/state/container.js:14`
  - `extansion/service-worker.js:152`
  - `extansion/background/actions/messages.js:21`
  - `extansion/background/learning/foreground-pages.js:69`
  - `extansion/background/core/messages/ai-models.js:50`
- 现状：所有浏览器事件、runtime message、alarm 都串行进入同一个 `mutationQueue`。
- 风险任务：
  - 页面关键词推理
  - AI interest keyword 推理
  - 模型安装/卸载
- 影响：一旦这些长任务在队列前面，tracking、preload watchdog、tab/window 生命周期处理等都会整体阻塞。

### 1.5 候选扫描与页面摘要上报绑定，动态页面上会放大 tracking/AI 写入压力

- 来源：Codex
- 位置：
  - `extansion/scripts/navigation-interceptor.js:64,84`
  - `extansion/background/learning/foreground-pages.js:23,61`
- 现状：每次候选重扫都会同时：
  - `sendCandidateLinks()`
  - `reportPageDigest()`
- 且页面摘要处理链会先写 `record-foreground-page`，再检查关键词是否过期。
- 影响：
  - 动态页面会产生大量无意义 tracking state 写入。
  - 若 `contentFingerprint` 抖动，还可能重复触发页面关键词生成。
  - 与全局串行队列叠加后，容易放大成系统卡顿。

---

## 2. P2 中等问题

### 2.1 `A -> A` 自环没有显式守卫

- 来源：Claude
- 位置：`extansion/background/tracking/graph/indexes/transitions/messages.js`（`createTransitionMessageRecord` 附近）
- 现状：当前更多依赖“节点或页面变化才记录”的组合条件间接阻挡自环，没有显式 `from == to` 的硬守卫。
- 影响：页级 `A(pageX) -> A(pageY)` 或边界状态错位时，仍有机会形成脏自环记录。

### 2.2 FFI 输入/输出缓冲使用两套释放路径，契约脆弱

- 来源：Claude
- 位置：`extansion/wasm/visit-graph-engine/src/ffi.rs`
- 现状：
  - 输入缓冲：`alloc/dealloc`
  - 输出缓冲：`store_result/free_result`
- 影响：
  - 两套路径各自成立，但 JS 端必须严格区分，否则就是 UB。
  - 这不是立即可见的崩溃点，但属于易错边界。

### 2.3 预加载窗口隐藏链仍然依赖“Chrome 会照单全收”的假设

- 来源：Claude
- 位置：
  - `extansion/background/preload/runtime/window-manager/creation.js:40-80`
  - `app/src/window/enumerate.rs:41-60`
  - `app/src/window/actions.rs`
- 现状：
  - 扩展侧仍按固定屏外坐标创建窗口并传给本地 app 做 HWND 匹配。
  - Chrome 真实 bounds 未在创建后重新读取校验。
  - 本地 app 只有一次性 `ShowWindow(hwnd, SW_HIDE)`，没有 `WS_EX_TOOLWINDOW` / `SetWinEventHook(EVENT_OBJECT_SHOW)` 这类长期维持机制。
- 影响：
  - 多显示器、DPI 缩放、Chrome 自动 re-show 时，匹配和隐藏都可能失败。
  - 失败后窗口可能一闪、留在窗口列表，或被错误重用。

### 2.4 预加载窗口创建和复用路径仍存在竞态与残留窗口扩大问题

- 来源：Claude
- 位置：
  - `extansion/background/preload/runtime/window-manager/creation.js:11-22,40-118`
- 现状：
  - `ensurePreloadWindow` 是 async check-then-act 流程，中间有多次 `await`。
  - `findReusablePreloadWindowId` 只有在“候选窗口恰好只有 1 个”时才复用。
- 影响：
  - 并发请求时可能短时间产生两个 preload 窗口。
  - 如果历史上已经遗留多个候选窗口，当前逻辑会直接放弃复用并继续新建，扩大残留。

### 2.5 AI 是否启用依赖设置缓存，不依赖启动时同步的本地真实模型状态

- 来源：Codex
- 位置：
  - `extansion/background/preload/scoring.js:104`
  - `extansion/background/actions/runtime.js:32`
  - `extansion/background/core/messages/ai-models.js:50`
- 现状：预加载打分层看的是 `settings.preloading.effectiveAiPredictionModelDownloaded`。
- 影响：如果模型实际已在本地 app 中存在，但扩展启动后没有主动同步状态，AI 预测会被错误地视为不可用。

### 2.6 候选池按 URL 只保留第一次出现的链接，后续更强语义被丢掉

- 来源：Codex
- 位置：`extansion/background/preload/prediction/candidate-pool.js:21`
- 现状：同一目标 URL 在页面中出现多次时，只保留第一次。
- 影响：
  - 更好的 `anchorText / nearbyText / ariaLabel / visibility / targetHint` 会丢失。
  - AI 匹配和 `_self/_blank` 判断可能被较弱样本污染。

### 2.7 Wasm 引擎首次加载失败后不会重试

- 来源：Codex
- 位置：`extansion/background/tracking/engine/wasm/load.js:1`
- 现状：首次失败后 `visitGraphEnginePromise` 会被缓存成解析为 `null` 的 Promise。
- 影响：整个 worker 生命周期会长期停留在 JS fallback，直到 service worker 重启。

### 2.8 当前窗口标签页进入 AI 上下文时，文本信息仍然偏弱

- 来源：Claude + Codex
- 位置：
  - `extansion/background/preload/scoring.js:215-256`
  - `extansion/background/ai/keywords.js:50`
- 现状：AI 上下文里的“当前窗口已有标签页”通常只有：
  - `pageUrl`
  - `title`
  - 少量从 5 条历史页面池里回填的 `textDigest`
- 影响：AI interest keyword 推理比文档想象的更依赖标题，容易被标题噪声和无关标签页污染。

### 2.9 频数乘区实现与文档语义的绑定仍然过松

- 来源：Claude
- 位置：`extansion/background/preload/scoring.js:2-3`
- 现状：频数映射所依赖的统计常量是硬编码数值，样本集 `L` 只存在于文档说明中。
- 影响：未来若调整样本集或频数映射参考分布，需要人工同步更新多个位置，缺少防呆。

### 2.10 AI interest keyword 推理未显式压制思考链

- 来源：Claude
- 位置：`extansion/background/preload/scoring.js:191-205`
- 现状：发给本地模型的 prompt 没有显式 `/no_think` 或等效关闭思考链的设置。
- 影响：对 Qwen3 这类模型，推理耗时和 token 开销可能显著放大，不利于“异步尽快挂乘区”的目标。

### 2.11 频数乘区与 AI 关键词乘区的数值关系仍需实测验证

- 来源：Claude
- 位置：`extansion/background/preload/scoring.js`、`docs/Algorithm-Design-Workflow-v0.md`
- 现状：当前设定是“关键词命中要明显强于频数”，但总分还会经过 `1 / (0.7n)` 次方归一化。
- 影响：在某些组合下，高频但弱语义的候选与低频但强语义的候选之间，实际顺序是否符合预期仍需实测，不是代码错误，但属于系统合理性风险。

### 2.12 `preloadStateV1.version` 等运行时文档与代码版本信息需要再对齐

- 来源：Claude
- 位置：`Runtime-Window-Model.md` 与 `extansion/background/preload/state/*`
- 现状：文档写的版本、legacy 迁移口径与代码历史实现可能不完全一致。
- 影响：容易导致后续维护时误判当前迁移逻辑是否仍会在每次加载时运行。

### 2.13 Hidden-tab 目标仍在 loading 时，点击回退到正常导航，但后台 tab 继续消耗资源

- 来源：Claude
- 位置：`extansion/background/preload/runtime/activation/flow.js:41-43`
- 现状：loading 中用户点击时返回 `handled: false`，让浏览器正常导航。
- 影响：原有 hidden tab 继续加载和占资源，直到后续 cleanup 才可能回收。

### 2.14 激活流程存在 storage 读写放大

- 来源：Claude
- 位置：`extansion/background/preload/runtime/activation/flow.js`
- 现状：一次 activation 内部会多次 load/save preload state，并伴随 normalize。
- 影响：快速连续点击时，storage I/O 和 normalize 开销会被放大。

### 2.15 非 ASCII 域名在 37×38 bucket 中退化到同一格

- 来源：Claude
- 位置：`extansion/wasm/visit-graph-engine/src/db/buckets/*.rs`
- 现状：非 ASCII 域名基本都会映射到 `_` 桶。
- 影响：在大量 IDN 站点场景下，索引意义退化为同桶线性查找。

### 2.16 `total` 是独立计数还是由 `byDay` 求和派生，需要在代码/文档中继续固化

- 来源：Claude
- 位置：`extansion/wasm/visit-graph-engine/src/db/buckets/transitions.rs`
- 现状：`total` 目前是独立维护的，不是简单 `sum(dayKeys)`。
- 影响：如果后续有人按“统一都从按日数据求和”去大改，容易无意中删掉 total 的独立语义。

---

## 3. P3 轻度问题 / 代码气味

### 3.1 `createdAt` 目前仍像“预留字段”，没有形成完整消费者链

- 来源：Claude
- 位置：`pendingSources.createdAt` 写入点
- 现状：字段已存在，但没有 TTL 和统一清理策略。
- 影响：容易让后来维护者误以为 source-lock 生命周期已经完整实现。

### 3.2 `/health` 与部分系统信息接口仍然缺少更细粒度最小鉴权

- 来源：Claude
- 位置：`app/src/api.rs` 路由层
- 现状：即便未来只放行本扩展，健康检查与部分系统信息接口仍没有更细粒度的额外保护。
- 影响：属于被动信息暴露面，重要性低于窗口控制和模型管理接口，但仍值得单独界定边界。

### 3.3 `chrome.windows.create` 的参数组合仍然依赖 Chrome 未文档化行为

- 来源：Claude
- 位置：`extansion/background/preload/runtime/window-manager/creation.js`
- 现状：`state: "normal" + left/top off-screen + focused: false` 仍被当作“尽量不抢焦点”的基础假设。
- 影响：不同 Chrome/Windows 状态下，仍可能出现窗口瞬时前台闪现。

---

## 4. 文档与代码未完全对齐的事项

### 4.1 Runtime-Window-Model 里写的 title-based HWND 匹配仍未落地

- 来源：Claude
- 文档：`Runtime-Window-Model.md`
- 现状：当前仍主要依赖 bounds/off-screen 坐标匹配。

### 4.2 Runtime-Window-Model 里写的 `WS_EX_TOOLWINDOW + SetWinEventHook` 维持链仍未落地

- 来源：Claude
- 文档：`Runtime-Window-Model.md`
- 现状：代码里还是一次性 `SW_HIDE`。

### 4.3 Source-lock TTL 在文档中已出现，但代码未实现

- 来源：Claude
- 文档：`Preload-Tracking-Logic.md`
- 现状：参见 1.3。

### 4.4 路线图中的“并行路径策略 / feature flag 对照期”没有完整落地

- 来源：Claude
- 文档：`Implementation-Roadmap-v0.md`
- 现状：当前更多是直接切主路径，而不是长期保留两条可对照路径。

### 4.5 冷启动兜底策略是否完全落地，需要与当前 `strategy-router` 再核对

- 来源：Claude
- 文档：`Algorithm-Design-Workflow-v0.md` §5.15
- 现状：需要确认“图为空时不开 hidden-tab，只走更软的策略”是否在代码里全面成立。

### 4.6 `1d` 时间窗口口径已确认采用“当前 UTC 当天”

- 来源：用户确认 + 文档收口
- 文档：`Algorithm-Design-Workflow-v0.md`
- 现状：这里明确是按 UTC 自然日，不追求精确滚动 24 小时；因此不再作为问题项继续追踪。

---

## 5. 仍需人工继续对齐的开放问题

### 5.1 `mutationQueue` 是否把某些关键多步流程真正串成原子单元

- 来源：Claude
- 重点对象：
  - `ensurePreloadWindow`
  - `activatePreloadedPage`
  - `recordActivatedPreloadedTransition`
- 需要进一步确认：当前队列保证的是“所有任务串行”，还是“这些多步流程作为单个事务单元串行”。

### 5.2 重载扩展后，已有 preload window / pendingSources 的恢复与认领是否完全正确

- 来源：Claude
- 需要继续核对：
  - preload 窗口是否会被重新认领
  - 旧 pending source 是否会在 worker 重启后被错误套用到仍存活的 tab 上

### 5.3 扩展 UI 关闭和设置页相关事件链是否已完全隔离于 tracking / preload

- 来源：Claude
- 需要继续核对：`intercept/navigation.js`、`intercept/messages.js` 的 origin gate 是否覆盖了所有 UI 导航路径。

### 5.4 `prefetch` 当前的真实执行媒介仍需再次核对

- 来源：Claude
- 需要继续核对：当前究竟是 `<link rel="prefetch">` 注入、Speculation Rules，还是其它路径在负责 soft preload。

### 5.5 冷启动阶段是否会出现长期 0 候选、0 预加载的空转期

- 来源：Claude
- 需要继续核对：在没有历史图、没有页级关键词、没有 AI 状态同步的最冷启动条件下，当前策略是否仍能稳定给出合理候选。

---

## 6. 合并结论

从两份审查结果合并后看，当前最需要优先关注的并不是继续加算法，而是这四类系统性问题：

1. **本地 app 授权边界仍不够窄**
2. **source-lock / hidden-tab 激活这条 tracking 主链仍有时序风险**
3. **AI / 模型长任务和全局后台事件队列强耦合**
4. **预加载窗口隐藏与复用链仍然脆弱，和目标方案有明显差距**

相比之下，其它问题更多属于：

- 数值合理性还需实测
- 文档与实现尚未完全收口
- 一些边缘语义尚未彻底定死

这份合并清单用于后续统一排期；原始两份文档继续保留，不互相覆盖。
