# 代码整体审查问题清单 v0（Claude 视角）

## 0. 说明

这份文档是 Claude 这一轮对整份代码（插件 JS + Wasm + 本地 Rust app）做一次整体审查的产出。
目的只有一个：把已经观察到的问题列出来，方便后续逐条排查。

- 只列问题，不给修复方案
- 只列能在当前代码中直接定位的问题，不记录"是否值得修"的判断
- Codex 会另写一份同类清单，两份文档不要互相覆盖
- 文件引用形式：路径后加 `:line` 或 `:line-range`

---

## 1. 严重问题（直接违反已冻结设计或潜在数据错乱）

### 1.1 预加载激活顺序与设计相反

- 文件：`extansion/background/preload/runtime/activation/flow.js:45-67`
- 设计（`Algorithm-Design-Workflow-v0.md` §4.7、`Runtime-Window-Model.md` "Runtime Flow" 第 6 条 + `Preload-Tracking-Logic.md` "Source of truth"）：
  1. 锁定 source 当前页
  2. 写一条真实跳转消息
  3. 再把 preloaded tab 移入正常窗口
- 实际执行顺序：
  1. `chrome.tabs.move(...)`（第 45 行）
  2. `chrome.tabs.update(..., { active: true })`（第 51 行）
  3. `recordActivatedPreloadedTransition(...)`（第 54 行，其内部才写 `pendingSources` 并调 `record-visit`）
- 风险：
  - 若在 move 之后、record 之前发生崩溃或扩展重载，用户看到已切换的 tab，但图里没有这条边
  - move 会立即触发 `tabs.onActivated` / `webNavigation.onCommitted` 之类事件，可能在 `pendingSources` 还没写的瞬间被其它 listener 读到空 source

### 1.2 Source-lock 没有 TTL（与 `Preload-Tracking-Logic.md` 新增章节不一致）

- 文件：
  - 写入：`extansion/background/preload/runtime/activation/tracking.js:17-22`（会写 `createdAt`）
  - 写入：`extansion/background/tracking/graph/events/tabs.js:8-12`（会写 `createdAt`）
  - 读取：`extansion/background/tracking/graph/events/transitions.js:5-7`（只读 `nodeId` / `pageUrl`）
- 结论：`pendingSources[tabId].createdAt` 在两处被写入，但整个仓库没有任何地方读取它做过期检查
  - 没有 `alarms.create`、`setTimeout` 或"若 now - createdAt > X 则清除"类型的逻辑
  - 只有 `record-visit` 和 tab 被关闭/替换时才会清除 pendingSource
- 影响：
  - 页内 JS 调用 `preventDefault` 取消跳转、中键点击未真正打开新标签页、`location.href = '...'` 失败，都会留下永远不过期的 source lock
  - 下一次真实跳转发生时，source 不再是当前页，而是上一次没走成的点击来源，图里会写出错误的 `A -> C` 边

### 1.3 Source-lock 不在导航 commit 时释放

- 文件：`extansion/background/tracking/graph/events/transitions.js:13-40`
- 现象：`delete state.pendingSources[tabId]` 只在 `shouldRecordTransition` 为真时执行（第 40 行附近）
- 当导航 commit 但判定为"同节点同页面不记录"时（hash 跳转、SPA pushState、无变化刷新），`pendingSources[tabId]` 保留
- 与 `Preload-Tracking-Logic.md` 新增章节里"navigation commit 时清掉 lock"的期望不一致

### 1.4 `A -> A` 自环没有显式拦截

- 文件：`extansion/background/tracking/graph/indexes/transitions/messages.js`（createTransitionMessageRecord 附近）
- 设计（`Algorithm-Design-Workflow-v0.md` §4.7）明确："防止目标页已经变成当前页，结果错误拼出 `A -> A`"
- 代码当前只靠"新节点或新页面才记录"的组合条件间接阻挡站点级自环，但页级 `A(pageX) -> A(pageY)` 不会被同样阻挡
- 实际需要一条显式守卫：`if (fromNodeId === toNodeId && fromPageUrl === toPageUrl) return`

### 1.5 本地 HTTP API 的 CORS 过松（任何 Chrome 扩展都能命中）

- 文件：`app/src/api.rs:88-100`
- 代码：`AllowOrigin::predicate(|origin| origin.starts_with("chrome-extension://"))`
- 风险：
  - 任意已安装的第三方 Chrome 扩展都可以 POST `/api/v1/windows/hide`、`/api/v1/windows/show`、`/api/v1/ai/infer`
  - 没有任何 token / extension id 白名单 / 握手机制
  - 由于本地 app 目的是"系统级隐藏任意匹配的 Chrome 窗口"，别的扩展可以借此隐藏用户正在用的浏览器窗口
- 与 `Zero-Latency-Web-Project-Blueprint-v0.md` §8.5 的本地数据边界原则直接冲突

---

## 2. 中等问题（局部逻辑错位、实现与设计不符）

### 2.1 FFI 两套容器路径容易出错

- 文件：`extansion/wasm/visit-graph-engine/src/ffi.rs`
- `alloc/dealloc` 使用 `Vec<u8>::with_capacity(len)` + `Vec::from_raw_parts(ptr, len, len)`
- `store_result/free_result` 使用 `Vec -> into_boxed_slice` + `Box::from_raw(slice_from_raw_parts_mut(ptr, len))`
- 两条路径各自自洽，`free_result` 这一侧用 fat pointer 传回 `Box<[u8]>`，语义正确
- 真实风险不是"立即 UB"，而是：
  - JS 端必须严格区分"输入缓冲走 dealloc、输出缓冲走 free_result"，一旦用错就是 UB
  - 两条路径长期并存没有 compile-time 防呆
  - `Vec::with_capacity(n)` 并不严格保证只分配 n 字节，依赖 u8 对齐恰好一致的"事实"

### 2.2 Off-screen 坐标与 HWND 匹配耦合在"Chrome 会照单全收"这个假设上

- 文件：`extansion/background/preload/runtime/window-manager/creation.js:40-54`（硬编码 `-32000, -32000, 100, 100`）
- 匹配端：`app/src/window/enumerate.rs:41-60`（±10 像素容忍）
- 已知问题：
  - Chrome 在多显示器或全屏游戏运行时经常不尊重负坐标，窗口会被移到主屏 0,0 附近，此时 ±10 像素匹配必然失败
  - Windows 125% / 150% DPI 下 `GetWindowRect` 返回的是物理像素，Chrome `windows.create` 用的是逻辑像素，两侧对不上
  - 如果同一时刻存在多个预加载窗口（旧实例尚未清理，新实例刚建成），匹配候选按 `visible desc` 排序后取第一个，是非确定性的
- 已在 `Runtime-Window-Model.md` "Known fragility" 章节描述过升级路径（title-based），但代码还没有落

### 2.3 HWND 匹配失败时 `hiddenBySystem=false` 却仍然存活

- 文件：`extansion/background/preload/runtime/window-manager/creation.js:56-69`
- 场景：`nativeAppHideWindow` 返回 `{ ok: false }`，或返回 `ok: true` 但没有 `hwnd`
- 实际处理：fallback 到 `chrome.windows.update(..., "minimized")`，但：
  - 这个 fallback update 自身没有超时、没有重试、没有后续校验窗口是否真的变最小化
  - 这之后 `preloadWindow.hwnd` 保持 undefined，`hiddenBySystem=false`，后续 watchdog 继续走 minimize 维持
  - 但窗口已经以 `state: "normal"` + 屏外坐标创建过一次 — 如果 Chrome 真把它放到了屏幕上的某个位置，minimize fallback 前用户有一个肉眼可见的窗口一闪
- 没有"创建失败就关掉"的兜底路径；hidden fail 的窗口会长期留在用户的窗口列表里

### 2.4 Chrome 自动 re-show 的长期维持逻辑缺失

- 设计文档（`Runtime-Window-Model.md` "Handling Chrome's automatic re-show"）已明确：`SW_HIDE` 要配合 `WS_EX_TOOLWINDOW` + `SetWinEventHook(EVENT_OBJECT_SHOW)` 做长期维持
- 实际代码：`app/src/window/actions.rs` 只有一次性 `ShowWindow(hwnd, SW_HIDE)`，没有 `SetWinEventHook`、没有 `WS_EX_TOOLWINDOW`
- 与文档写的"hiding must therefore be treated as a maintained policy, not a one-shot call"直接矛盾

### 2.5 频数乘区常量硬编码，与样本集 L 的关联只存在于注释里

- 文件：`extansion/background/preload/scoring.js:2-3`
- `TRANSITION_FREQUENCY_LOG_MEAN = 2.311244079810772`、`TRANSITION_FREQUENCY_LOG_SD = 1.4026102051615708`
- 文档（`Algorithm-Design-Workflow-v0.md` §5.14）明确"样本集合 L = {1,2,3,5,8,13,21,34,55,89}"，但代码里没有 L、没有在启动时算 mean/sd
- 如果未来改 L（例如扩到斐波那契更长序列），必须手动重算并替换两个常量，没有任何防呆
- Rust 侧 `scoring.rs` 也没有沉淀这两个常量或样本集 — 说明语义只在 JS 侧

### 2.6 AI interest keyword 推理不传 `/no_think`

- 文件：`extansion/background/preload/scoring.js:191-205`
- 当前发送给本地 app 的 prompt 是 `aiKeywordTools.buildContextKeywordPrompt({...})`，没有"思考链关闭"或者 `think: false` 之类的字段
- 对 Qwen3 系列模型，不显式关闭思考会带来额外几百到几千 token 的中间输出，单次推理耗时显著增加
- 这与 `Algorithm-Design-Workflow-v0.md` §5.12.2.1 "AI 匹配结果一旦出来，就把对应关键词乘区挂上去"这条"要尽快拿到 interest keywords"的口径不太一致 — 目前形态是"尽快发出请求"但"不尽快拿结果"

### 2.7 频数乘区与 AI 关键词乘区强度不匹配

- 文件：`extansion/background/preload/scoring.js`（频数乘区上限 `1 + 2 / 1 ≈ 3.0`）
- AI 关键词乘区设计区间（§5.12.2.1）：无 1.0 / 弱 2.2 / 中 3.6 / 强 5.4
- 但归一化公式是 `x^(1/(0.7n))`，`n` 是非 1 乘区数量。当候选只有一个乘区 (`n=1`) 时，`x^(1/0.7) ≈ x^1.43`，会把 5.4 放大成 ~12 — 拉开
- 而当同时命中 AI + 频数 (`n=2`) 时，`x^(1/1.4) ≈ x^0.71`，`(5.4*3)^0.71 ≈ 16^0.71 ≈ 7.3`，结果比只命中 AI 的还大是合理的
- 但若 AI 给 1.0、频数给 3.0，`n=1`，结果 3.0^1.43 ≈ 4.7 — 比"AI 强命中 + 频数弱"的情况数值上可能反超 AI 弱命中 + 频数 0 的情况
- 这不是代码错误，是数值上可能把"关键词弱命中但频数很大的候选"排到"关键词强命中但频数为零"之前，与 §5.14.1 "关键词命中应明显强于频数"口径相悖。需要端到端观察

### 2.8 `querying open tabs` 取的是整个 sourceWindow 的所有 tab

- 文件：`extansion/background/preload/scoring.js:230-256`
- `chrome.tabs.query({ windowId })` 把当前 normal 窗口的全部标签页都纳入上下文
- 但 normal 窗口里也可能包含已经被 activation 迁过来的 preload tab，或者用户刚开的无关 tab
- §5.12.1 "最近前台页面上下文库"明确要求"只统计真实出现在前台窗口中的页面"，这里的 `open tabs` 实际上没有做"曾否前台"的筛选，是把"同窗口下所有未关闭 tab"都视为上下文
- 风险：AI interest keywords 会被用户随手开的一个不相关页污染

### 2.9 `preloadStateV1.version` 与文档不一致

- `Runtime-Window-Model.md` 写的是 `"version": 2`
- 代码中（以 `extansion/background/preload/state/normalize.js` + `preload/state/model.js` 为起点）的实际 version 常量需要与文档比对 — 文档声称 v2，但此前实现里确实有过 v1。如果现在代码里 legacy 迁移仍然会在每次加载时运行，会出现反复 normalize 带来的写入放大

### 2.10 预加载窗口创建的 check-then-act race

- 文件：`extansion/background/preload/runtime/window-manager/creation.js:11-22, 40-80`
- `ensurePreloadWindow` 是 async 函数，从 "检查 `existingWindowId` 是否有效" 到 "`chrome.windows.create`" 之间有多次 `await`
- 如果两个并发调用（例如同一 normal 窗口里两个 source tab 同时请求 preload）都通过了第 13 行 check，两条分支都会走到第 40 行 create
- 结果可能产生两个 preload 窗口，只有一个写回 `normalWindowRuntime.preloadWindow.windowId`
- 需要确认 `backgroundState.mutationQueue` 是否确实把 `ensurePreloadWindow` 整体序列化 — 从调用点看不是显式保证

---

## 3. 小问题 / 代码气味

### 3.1 `pendingSources.createdAt` 是预留字段但无消费者

- 见 §1.2。保留这种"先写不读"字段的实现半成品，容易让后来人误以为 TTL 已经在用

### 3.2 `chrome.windows.create` 的参数组合依赖 Chrome 行为未被文档化

- `state: "normal" + left: -32000` 在 Chrome 文档里并没有"一定不会抢焦点"的保证
- 用 `focused: false` 缓解，但 Chrome 有时仍会把新窗口短暂聚焦到屏幕

### 3.3 `nativeAppInvokeAiModel` 缺失明确的本地端 timeout

- 文件：`extansion/background/shared/native-app/request.js`（默认 3000ms），但 `/ai/infer` 的真实推理耗时通常大于 3 秒
- 推理路径在第一次冷启动（runtime 未拉起）时可能超过 10 秒。当前代码在 `nativeAppInvokeAiModel` 层是否覆盖默认 timeout、覆盖为多少，值得专门对齐

### 3.4 `37×38 = 1406` bucket 在非 ASCII 域名下全部命中同一格

- `db/buckets.rs` 将非 ASCII 映射为 `_`，所有中文/俄文/阿拉伯站点会全部塞进 `[36][36]`
- 数据层面不会报错，但索引在这类用户上会失去分桶意义，退化成线性查

### 3.5 `last1d` 语义

- 当前实现把 `last1d` 解释成 `age_in_days <= 0`，即"今天 UTC 当天"
- 直觉上"最近 1 天"更接近"最近 24 小时的滚动窗口"
- 文档里没有明确写"按自然日还是滚动 24h"

### 3.6 `total` 桶的维护路径

- `wasm/visit-graph-engine/src/db/buckets/transitions.rs:10-18` 显示 `total` 走独立 `transition_buckets.total`
- 这意味着 `total` 是显式维护的全量计数，不是"summing all day keys"
- 但 §3.3 提到"`total` 不应被 `365d` 替代" — 当前结构满足这点，需要在文档/代码注释中固化"total 是独立计数，不由 by_day 求和派生"，否则后面有人按照"统一改成按日求和"的大改，会悄悄删掉 total

### 3.7 `watcher` → `host` 启动在同一个 Chrome 会话下的重复启动保护

- 文件：`app/src/lifecycle/watcher.rs`
- `watcher` 每秒轮询一次 `chrome_is_running()`，发现 Chrome 存在时 spawn host
- 如果用户手动点击 tray "Exit"，host 退出；watcher 下一秒又看到 Chrome 还在，是否会再次 spawn？`Local-App-Lifecycle.md` 写"不会立即 respawn，要等 no-chrome → chrome 的沿"
- 代码里这条"边沿检测"是否真的存在（即 watcher 自己保存一个 `last_seen_chrome`）需要确认；从轮询语义看一秒一次的 poll 不等于边沿

### 3.8 `Google /search` 归一化

- §4 文档里声称页级和节点级都把 `/search?q=...` 折叠成 `/search`
- 在 Rust `events/transitions.rs` 或 JS `tracking/url/model.js` 里需要确认这条归一化的实现位置，以及是否只覆盖 `www.google.*` 还是也覆盖 `google.co.jp`、`google.com.hk`、`scholar.google.com` 等等
- 如果只硬编码主域，其它子域会漏；如果用正则且过宽，会把非搜索页（例如 Google Maps 的 `/search?api=1`）也误当作搜索入口

### 3.9 预加载 tab 状态 "loading 中用户点击" 直接返回 handled=false

- 文件：`extansion/background/preload/runtime/activation/flow.js:41-43`
- 返回 `handled: false` 让 Chrome 走正常导航路径，语义上是安全的
- 但此时原本的 hidden tab 仍然在加载中，没有任何路径会"趁机等待它完成、或关掉它"。这个 hidden tab 会继续消耗一个后台 tab 和带宽，直到后续 cleanup 触发
- 体验上：用户看到的是一次"仍然有加载"的正常跳转，但我们已经为它做过一次完整的后台 fetch

### 3.10 `chrome.storage.local` 在激活流程中被读写多次

- `activation/flow.js` 中分别在 19、37、53、62、67 行做了 load/save，且 `savePreloadState` 每次都会走一遍 `normalize`
- 每一次 activation 等于 4-5 次 storage 读写 + 2 次完整 normalize
- 在快速连续点击时存在写放大

### 3.11 服务端 `/health` 没有做最小鉴权

- 其它扩展通过 CORS 就能拿到 `/health` 和 `/api/v1/system/hardware` 遥测数据
- 不是高敏感信息，但属于被动泄露

### 3.12 `ensurePreloadWindow` 的 `findReusablePreloadWindowId` 认为"只有一个候选窗口"才复用

- 文件：`creation.js:83-118`
- `if (candidateWindowIds.size !== 1) return null;`
- 如果历史 state 里两个预加载 tab 属于两个不同的残留 preload 窗口，这条判断直接放弃复用，新建第三个
- 残留的两个旧窗口没有被主动清理，需要依赖其它 cleanup 路径

### 3.13 Off-screen 创建后未校验 Chrome 实际 bounds

- 创建后直接把 `left: -32000, top: -32000, width: 100, height: 100` 作为 hide 请求发给本地 app
- 但 Chrome 的真实 `chrome.windows.get(createdWindow.id)` bounds 很可能不是这四个数
- 正确做法应当是创建后 `chrome.windows.get` 拿到实际 bounds，再传给本地 app 匹配
- 当前实现相当于"假设 Chrome 照单全收"

### 3.14 `pendingSources` 结构在 Rust 侧和 JS 侧的一致性

- JS 侧 pendingSources 是 `{ [tabId]: { nodeId, pageUrl, createdAt } }`
- Rust 侧是否有对应结构、是否需要序列化进入图的持久化、能否在 service worker 重启后正确恢复 — 需要专门对齐

---

## 4. 文档与代码不一致的地方（与"代码 bug"不同，是"写了但还没做"）

- §5.9.1 "便携 runtime 真实边界"要求显式 `OLLAMA_MODELS` 环境变量；`app/src/model/runtime/process.rs:56-57` 实现了 — ✅
- §5.9.1 要求"不走官方 installer、不注册系统服务" — 代码中解压到 `portable/runtime/ollama/`，没有看到任何系统服务注册，符合预期
- `Runtime-Window-Model.md` 计划 title-based HWND 匹配 — ❌ 未实现
- `Runtime-Window-Model.md` 计划 `WS_EX_TOOLWINDOW` + `SetWinEventHook` 长期维持 — ❌ 未实现
- `Preload-Tracking-Logic.md` Source-lock TTL — ❌ 未实现（见 §1.2）
- `Zero-Latency-Web-Project-Blueprint-v0.md` §6.2.5 pushState 占位作为后退兜底 — ❌ 未实现，Phase 4 / Phase 5 之外的独立功能
- `Implementation-Roadmap-v0.md` Phase 3.5 并行路径策略（feature flag + 两条路径 + disposition 日志比对）— 当前代码是"直接切，旧路径已删或保留但无 flag"
- `Algorithm-Design-Workflow-v0.md` §5.15 冷启动兜底（无历史信号时不开 hidden tab，只走 prerender / prefetch）— 需要在 `preload/prediction/strategy-router.js` 中确认是否有"图为空即跳过 hidden-tab 策略"分支

---

## 5. 需要进一步人工对齐的开放问题

1. `mutationQueue` 是否真的把 `ensurePreloadWindow` / `activatePreloadedPage` / `recordActivatedPreloadedTransition` 作为一个原子单元排队，还是只对某些 storage 写入序列化？需要在 `core/state/container.js` 里对齐
2. 插件重载后的 `preloadStateV1` 恢复，是否真的会把已存在的 Chrome 窗口重新"认领"回 normalWindowsById 结构？特别是：原有的 hidden preload window 在重载后是否会被误判为普通 normal 窗口，从而反过来被 tracking
3. `pendingSources` 持久化在 `chrome.storage.local` 中，但 service worker 可能被浏览器回收；回收后再恢复是否会把早已过期的 pending source 全部重新套用到还活着的 tab 上
4. 插件扩展 UI（popup / settings）关闭时发出的事件链，现在是否真的完全不进入任何 preload / tracking 逻辑 — 需要在 `intercept/navigation.js` 和 `intercept/messages.js` 里看有没有 origin gate
5. `prefetch` 策略当前是否真的走 `<link rel="prefetch">` 注入，还是仍然依赖浏览器推测规则？`preload/prediction/strategy-router.js` + `preload/rules.js` 需要确认
6. 冷启动兜底（§5.15）当前是否落到代码里？如果没有，在新图上第一轮预测可能会产出 0 候选并持续 0 候选，直到用户手动浏览积累到某个阈值

---

## 6. 本文档与 Codex 清单的区分

- 这份文件标题带 "Claude"，是 Claude 这次审查的产出
- Codex 的同类清单另行产出，请勿合并
- 后续如果要把两份清单合并成一份统一的"待办清单"，应当在一份独立的 `Code-Review-Merged-v0.md` 里，保留这两份原始文档不动
