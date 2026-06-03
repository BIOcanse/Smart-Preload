# 模块拆分计划 - Codex - 2026-05-09

## 1. 目标

本计划只处理模块边界和拆分顺序，不改变算法语义。

当前固定规则：

- 大算法不拆文件，只在原文件内拆函数。
- 非算法逻辑按功能拆文件。
- 入口文件保持薄，只做装配、事件绑定、调度。
- 不为了“文件变短”而拆；只有功能边界明确、能降低 bug 密度时才拆。

## 2. 本轮扫描结果

### 2.1 最大文件

- `extansion/scripts/navigation-interceptor.js`：1109 行
- `extansion/settings/settings.js`：1033 行
- `extansion/shared/settings.js`：843 行
- `app/src/window/manager.rs`：755 行
- `extansion/background/preload/runtime/window-manager/creation.js`：690 行
- `extansion/background/preload/prediction/site-selection.js`：664 行
- `extansion/background/ai/providers.js`：549 行
- `extansion/background/ai/keywords.js`：545 行
- `app/src/api.rs`：514 行
- `extansion/wasm/visit-graph-engine/src/selection.rs`：490 行

### 2.2 最大函数

- `registerPreloadCandidates`：193 行，`extansion/background/preload/runtime/candidate-registration.js`
- `activatePreloadedPage`：191 行，`extansion/background/preload/runtime/activation/flow.js`
- `resolveClickNavigation`：164 行，`extansion/background/navigation/manager.js`
- `ensurePreloadWindowInternal`：146 行，`extansion/background/preload/runtime/window-manager/creation.js`
- `wrapVisitGraphEngine`：146 行，`extansion/background/tracking/engine/wasm/bridge.js`
- `select_preload_candidate_group`：144 行，`extansion/wasm/visit-graph-engine/src/selection.rs`
- `handleForegroundPageDigest`：142 行，`extansion/background/learning/foreground-pages.js`
- `buildSiteSemanticFieldEntries`：134 行，`extansion/background/ai/keywords.js`
- `synchronizePreloadsForSourceTab`：133 行，`extansion/background/preload/runtime/source-tabs/hidden-tabs.js`
- `recordVisit`：125 行，`extansion/background/tracking/index.js`

## 3. 拆分原则

### 3.1 算法文件只拆函数

以下文件视为算法密集或计算边界文件，不拆成多个文件：

- `extansion/background/preload/prediction/site-selection.js`
- `extansion/background/preload/scoring.js`
- `extansion/background/ai/keywords.js`
- `extansion/wasm/visit-graph-engine/src/selection.rs`
- `extansion/wasm/visit-graph-engine/src/db/normalize/graph.rs`
- `extansion/wasm/visit-graph-engine/src/query/transitions.rs`

允许做的事：

- 把巨函数拆成阶段函数。
- 给阶段函数固定输入输出对象。
- 保留同一个文件里的算法阅读连续性。

不做的事：

- 不把站点选择、槽位分配、关键词匹配拆到多个文件。
- 不拆散频数映射、AI 乘区、排序归一化的核心算法链。

### 3.2 功能文件按职责拆文件

以下文件不是大算法，而是功能堆叠，应按职责拆：

- `extansion/scripts/navigation-interceptor.js`
- `extansion/background/ai/providers.js`
- `app/src/window/manager.rs`
- `app/src/api.rs`

preload runtime 的流程文件介于两者之间：

- `candidate-registration.js`
- `activation/flow.js`
- `window-manager/creation.js`

它们不是算法，但承担主管流程。拆法是：主流程文件保留 orchestrator，周边可复用阶段逻辑拆到同目录功能文件。

## 4. 第一阶段：content script 拆分

### 4.1 当前问题

`extansion/scripts/navigation-interceptor.js` 同时承担：

- bootstrap 和事件绑定
- 点击/中键点击捕获
- 后台导航解析请求
- `_blank` about:blank 占位页兜底
- 候选链接扫描
- 瀑布流固定链接基线
- 页面摘要上报
- speculation rules 注入/清理
- DOM mutation 观察与调度

这已经接近第二个隐式主程序入口。它应该缩成页面端 edge bootstrap。

### 4.2 目标结构

新增目录：

- `extansion/scripts/navigation/`

建议文件：

- `extansion/scripts/navigation/shared.js`
  - 常量、轻量 URL/文本工具、错误安全包装。
- `extansion/scripts/navigation/background-client.js`
  - `chrome.runtime.sendMessage` 包装、timeout 包装、后台返回标准化。
- `extansion/scripts/navigation/click-edge.js`
  - `mousedown/click/auxclick` 捕获、点击意图提取、调用后台解析、执行后台返回的 edge 动作。
- `extansion/scripts/navigation/fallbacks.js`
  - 当前页跳转 fallback、`_blank` 占位页 fallback、超时处理。
- `extansion/scripts/navigation/candidate-scan.js`
  - 页面链接收集、候选链接文本提取、稳定性等待、候选签名。
- `extansion/scripts/navigation/waterfall-baseline.js`
  - 初始固定链接集合、动态链接忽略策略。
- `extansion/scripts/navigation/page-digest.js`
  - 页面标题/URL/文本摘要/内容指纹提取与上报。
- `extansion/scripts/navigation/speculation-rules.js`
  - `<script type="speculationrules">` 注入、更新、清理。
- `extansion/scripts/navigation/dom-observer.js`
  - MutationObserver、DOMContentLoaded/load/focus 事件调度。
- `extansion/scripts/navigation-interceptor.js`
  - 只保留 bootstrap：创建 context、绑定事件、连接各功能模块。

### 4.3 Manifest 加载方式

MV3 content script 不能使用 `importScripts`。拆分后通过 `manifest.json` 的 `content_scripts[0].js` 顺序加载。

建议加载顺序：

1. `scripts/navigation/shared.js`
2. `scripts/navigation/background-client.js`
3. `scripts/navigation/fallbacks.js`
4. `scripts/navigation/speculation-rules.js`
5. `scripts/navigation/waterfall-baseline.js`
6. `scripts/navigation/candidate-scan.js`
7. `scripts/navigation/page-digest.js`
8. `scripts/navigation/click-edge.js`
9. `scripts/navigation/dom-observer.js`
10. `scripts/navigation-interceptor.js`

每个文件用 IIFE 挂到同一个命名空间：

- `globalThis.ZeroLatencyNavigationContent`

禁止散落全局函数名，避免重现 service worker 全局声明冲突。

### 4.4 拆分验收

- `navigation-interceptor.js` 降到 150 行以内。
- 页面端不新增业务判断；复杂判断继续交给 `background/navigation/manager.js`。
- `node --check` 全部通过。
- 手动测试：
  - Google 搜索页候选能上报。
  - `_blank` 占位页超时能 fallback。
  - 当前页替换点击能请求后台。
  - 瀑布流动态新增链接不进入候选。
  - speculation rules 能被后台清理。

## 5. 第二阶段：preload runtime 流程拆分

### 5.1 candidate registration

当前文件：

- `extansion/background/preload/runtime/candidate-registration.js`

当前巨函数：

- `registerPreloadCandidates`

建议拆法：

- 保留 `candidate-registration.js` 作为 orchestrator。
- 新增 `candidate-registration/context.js`
  - `resolveCandidateRegistrationContext`
  - source tab/window 校验、preload context 跳过、active tab 检查、runtime settings 获取。
- 新增 `candidate-registration/tracking.js`
  - `ensureCurrentPageTracked`
  - 当前页面补登记。
- 新增 `candidate-registration/diagnostics.js`
  - selection debug event、diagnostics log。
- 新增 `candidate-registration/apply-selection.js`
  - hidden-tab 同步、prerender/prefetch entry 同步、保存 preload state。
- 新增 `candidate-registration/response.js`
  - content script policy、targets 返回对象构造。

验收：

- `registerPreloadCandidates` 变成线性流程：校验 -> 补 tracking -> 预测 -> 记录日志 -> 应用 selection -> 返回。
- 任何文件不直接绕过 `PreloadRuntimeManager` 去做高层 runtime 决策。

### 5.2 activation flow

当前文件：

- `extansion/background/preload/runtime/activation/flow.js`

当前巨函数：

- `activatePreloadedPage`

建议拆法：

- 保留 `activation/flow.js` 作为 orchestrator。
- 新增 `activation/request.js`
  - 校验 source tab、target URL、deadline、source window。
- 新增 `activation/resolution.js`
  - `resolveActivatablePreloadedEntry`
  - wait/poll loading entry。
- 新增 `activation/promotion.js`
  - move tab、ensure URL、activate tab、remove source tab。
- 新增 `activation/cleanup.js`
  - source tab runtime cleanup、preload state 保存。
- 保留 `activation/tracking.js`
  - 继续负责真实跳转记录。

验收：

- `activatePreloadedPage` 只表达流程，不直接堆具体 tab 操作细节。
- loading 的后台 tab 仍然能被移动到前台，不退化为点击无响应。
- deadline 语义保持不变。

### 5.3 window creation

当前文件：

- `extansion/background/preload/runtime/window-manager/creation.js`

当前巨函数：

- `ensurePreloadWindowInternal`

建议拆法：

- 保留 `creation.js`，先只做文件内函数拆分，不急着拆文件。
- 阶段函数：
  - `tryReuseTrackedPreloadWindow`
  - `tryReuseDiscoveredPreloadWindow`
  - `createMinimizedPreloadWindow`
  - `commitPreloadWindowRuntimeState`
  - `recordPreloadWindowEnsureEvent`

原因：

- 这个文件和 system hiding / hwnd 捕获强耦合，贸然拆文件容易引入后台窗口闪烁回归。
- 等第一阶段和第二阶段稳定后，再考虑把 discovery / creation / identity proof 拆文件。

## 6. 第三阶段：AI provider 功能拆分

### 6.1 providers.js

当前文件：

- `extansion/background/ai/providers.js`

它不是算法文件，应该按 provider 功能拆。

建议结构：

- `extansion/background/ai/providers.js`
  - 对外 facade：`invokeConfiguredAiProvider`、LM Studio watchdog 入口转发。
- `extansion/background/ai/providers/request.js`
  - `buildAiProviderRequest`
  - provider/model/apiKey/endpoint 解析。
- `extansion/background/ai/providers/openai-compatible.js`
  - OpenAI-compatible body/header 构造。
- `extansion/background/ai/providers/gemini.js`
  - Gemini request/response。
- `extansion/background/ai/providers/claude.js`
  - Claude request/response。
- `extansion/background/ai/providers/response.js`
  - provider output text extraction。
- `extansion/background/ai/providers/lmstudio-lifecycle.js`
  - 模型 ready/load/unload/watchdog。

验收：

- 新增 provider 时只改 provider 子文件和 catalog。
- `providers.js` 不再同时管 HTTP body、response parser、LM Studio lifecycle。

### 6.2 keywords.js

当前文件：

- `extansion/background/ai/keywords.js`

这是关键词匹配算法文件，不拆文件。

只做文件内函数整理：

- Prompt 构造区
- Response parse 区
- Candidate semantic field 构造区
- Site semantic field 构造区
- Match scoring 区

验收：

- `buildSiteSemanticFieldEntries` 拆成几个小函数。
- 不把关键词匹配算法拆到多个文件。

## 7. 第四阶段：本地 app 功能拆分

### 7.1 app API

当前文件：

- `app/src/api.rs`

建议结构：

- `app/src/api.rs`
  - `pub use` / module export / `spawn_server` facade。
- `app/src/api/state.rs`
  - `ApiState`、allowed origins、heartbeat lease、debug token。
- `app/src/api/server.rs`
  - tokio runtime、router assembly、listener。
- `app/src/api/auth.rs`
  - origin/token 校验 middleware。
- `app/src/api/cors.rs`
  - extension CORS。
- `app/src/api/persistence.rs`
  - allowed origin/debug token 文件读写。
- `app/src/api/routes/*`
  - 保持当前 routes 结构。

验收：

- `api.rs` 降为入口文件。
- protected route 和 bootstrap route 的授权边界更容易审查。
- 不改变端口、路径、授权策略。

### 7.2 app WindowManager

当前文件：

- `app/src/window/manager.rs`

建议结构：

- `app/src/window/manager.rs`
  - 对外 facade：hide/show/list/snapshot/track。
- `app/src/window/manager/registry.rs`
  - hidden window registry、record 更新。
- `app/src/window/manager/monitor.rs`
  - 100ms hidden window monitor thread。
- `app/src/window/manager/hooks.rs`
  - WinEvent hook thread 和 callback。
- `app/src/window/manager/snapshot.rs`
  - monitor snapshot、serialization。
- `app/src/window/actions.rs`
  - 继续只放 Win32 action。
- `app/src/window/enumerate.rs`
  - 继续只放窗口枚举。

验收：

- `actions.rs` 不接收高层策略。
- monitor/hook/snapshot 可以单独审查，方便排查后台窗口闪烁。
- 不改变 hide/show 的外部 API。

## 8. 第五阶段：大算法文件内拆函数

### 8.1 site-selection.js

不拆文件。

建议内部区域：

- Public orchestrator
- Native/tab grouping
- Cross-site cluster build
- Site AI multiplier
- Engine adapter
- JS fallback
- Allocation helpers
- Compare/normalize helpers

优先拆的函数：

- `trySelectPreloadCandidateGroupWithEngine`
- `applySiteSelectionToCandidateGroupFallback`
- `buildSiteAiKeywordMultipliersByNodeId`

### 8.2 scoring.js

不拆文件。

建议内部区域：

- Frequency multiplier
- AI interest context
- Page keyword lookup
- Open/recent context collection
- Candidate scoring merge

优先拆：

- `collectOpenContextPages`
- `getAiInterestKeywordsForPreloading`

### 8.3 wasm selection.rs

不拆文件。

建议内部函数：

- `build_selection_inputs`
- `score_site_candidates`
- `select_top_sites`
- `allocate_page_slots`
- `select_pages_inside_sites`
- `build_selection_response`

优先拆：

- `select_preload_candidate_group`
- `allocate_selected_site_page_slots`

## 9. 暂缓拆分项

### 9.1 settings 页面

文件：

- `extansion/settings/settings.js`
- `extansion/shared/settings.js`
- `extansion/settings/settings.css`

原因：

- 前端结构和样式属于 Claude 主要负责区域。
- 当前只在 schema/runtime 逻辑有 bug 时由 Codex 小范围修改。

后续如果要拆，应由 Claude 主导 UI 组件化或页面模块化。

### 9.2 tracking

文件：

- `extansion/background/tracking/index.js`
- `extansion/background/tracking/graph/*`
- `extansion/background/tracking/engine/*`

原因：

- 当前目录已经比较细。
- 最大函数 `recordVisit` 可以先文件内拆阶段函数，不必创建更多文件。

建议：

- 后续如需整理，只做 `recordVisit` 内部阶段函数：
  - source resolution
  - current page update
  - transition decision
  - event apply
  - debug output

## 10. 推荐落地顺序

1. 拆 `navigation-interceptor.js`。
2. 拆 `candidate-registration.js` 周边功能文件。
3. 拆 `activation/flow.js` 周边功能文件。
4. 文件内整理 `window-manager/creation.js`。
5. 拆 `background/ai/providers.js`。
6. 拆 `app/src/api.rs`。
7. 拆 `app/src/window/manager.rs`。
8. 文件内整理算法文件：`site-selection.js`、`scoring.js`、`keywords.js`、`selection.rs`。

这个顺序的理由：

- 先处理最可能造成真实浏览器行为 bug 的 content script 和 preload runtime。
- 再处理 AI provider 和本地 app 边界。
- 最后处理大算法内部函数，因为算法还会继续由用户指导迭代，过早拆文件会增加协作成本。

## 11. 每一步必须跑的检查

JS 侧：

- `node --check` 覆盖全部扩展 JS/MJS。
- service worker importScripts 顶层重复声明扫描。
- content script 多文件加载后检查命名空间是否完整。

Rust 侧：

- `cargo fmt`
- `cargo check`
- `cargo test`

浏览器实测：

- Google 搜索页候选生成。
- Google 搜索结果点击已预加载页面替换。
- `_blank` 点击 fallback。
- 后台隐藏窗口不闪烁。
- 关闭插件账户窗口后 app heartbeat 退出。
- 设置页保存后默认配置不被污染。

## 12. 落地进度

### 2026-05-09 第一轮

已完成：

- `extansion/scripts/navigation-interceptor.js` 拆为页面端 bootstrap，功能下沉到 `extansion/scripts/navigation/*`。
- `manifest.json` 的 content script 改为多文件顺序加载，所有 content 模块统一挂到 `globalThis.ZeroLatencyNavigationContent`。
- `registerPreloadCandidates` 拆为 context、tracking、diagnostics、apply-selection、response 五个功能文件。
- `activatePreloadedPage` 拆为 request、resolution、promotion、cleanup 四个功能文件，`flow.js` 保留线性 orchestrator。
- `ensurePreloadWindowInternal` 只做文件内函数拆分，抽出 tracked reuse、discovered reuse、create、commit runtime state，未拆文件以降低后台窗口隐藏回归风险。
- `background/ai/providers.js` 拆为 provider facade，request/response/common/LM Studio lifecycle 分离。
- `app/src/api.rs` 拆为 state、origin、persistence、auth、cors、server，`api.rs` 只保留模块导出与常量。

已验证：

- 扩展 JS/MJS 全量 `node --check` 通过。
- service worker `importScripts` 零缩进顶层重复声明扫描通过。
- `cargo fmt` in `app` 通过。
- `cargo check` in `app` 通过。

下一步：

- 拆 `app/src/window/manager.rs`。
- 再做大算法文件内函数整理，不拆算法文件。

### 2026-05-09 第二轮

已完成：

- `app/src/window/manager.rs` 拆为 `manager/mod.rs`、`registry.rs`、`monitor.rs`、`hooks.rs`、`snapshot.rs`。对外 hide/show/snapshot 入口保持不变，监控线程、WinEvent hook、registry 记录分开审查。
- `extansion/background/shared/native-app/request.js` 拆为 facade，transport、registration、heartbeat、heartbeat activity、common 下沉到 `native-app/request/*`。原有 `fetchNativeApp`、heartbeat facade 名称保留。
- `app/src/lifecycle/extension.rs` 拆为 `extension/mod.rs`、`profile.rs`、`manifest.rs`、`scan.rs`、`storage.rs`。插件安装检测中的 profile 发现、manifest 判断、Secure Preferences 扫描、storage fallback 已分层。
- `app/src/lifecycle/native_messaging.rs` 拆为 `native_messaging/mod.rs`、`manifest.rs`、`registry.rs`、`process.rs`、`protocol.rs`。Native Messaging 的 manifest 写入、注册表、host 唤醒进程、stdio 协议边界分开。
- `app/src/lifecycle/install.rs` 拆为 `install/mod.rs`、`registry.rs`、`origin.rs`、`status.rs`。安装/卸载流程保持 orchestrator，注册表读写、allowed origin 持久化、status 组装分离。
- `extansion/background/tracking/index.js` 不拆文件，只把 `recordVisit` 拆为文件内阶段函数：trackable/preload 校验、record context 构造、Google bookmark 特例记录、当前页保存、自跳转跳过、真实 visit 写入。

已验证：

- 本轮每个 Rust 拆分点之后均跑过 `cargo fmt` + `cargo check`。
- `native-app/request` 拆分后已跑扩展 JS/MJS 全量 `node --check`。
- `service-worker.js` `importScripts` 顶层重复声明扫描通过。

当前保留：

- `settings.js` 暂不拆，前端结构后续由 Claude 主导。
- `site-selection.js`、`scoring.js`、`keywords.js`、Wasm `selection.rs` 不拆文件，后续只做文件内函数整理。
- `window-manager/creation.js` 暂不拆文件，只保留已完成的文件内阶段函数，避免后台隐藏窗口逻辑再引入闪烁回归。

### 2026-05-09 第三轮

已完成：

- `extansion/background/preload/prediction/site-selection.js` 不拆文件，内部拆出 Wasm engine request 构造、engine result 回填、fallback 同站候选选择、fallback 跨站站点截断、fallback 跨站候选装配。
- `extansion/background/preload/scoring.js` 不拆文件，内部拆出 AI 预测可用性判断、AI 上下文页面加载、当前页上下文构造、结果诊断、cache key 构造、provider 推理调用。
- `extansion/background/ai/keywords.js` 不拆文件，内部拆出站点语义聚合结构、链接字段收集、目标页关键词收集、聚合结果输出。
- `extansion/wasm/visit-graph-engine/src/selection.rs` 不拆文件，内部拆出候选分区、同站候选选择、跨站站点截断、槽位分配、selection result 装配。
- 已运行 `extansion/scripts/build-wasm.ps1`，同步重建 `extansion/wasm/pkg/visit_graph_engine.wasm`，避免 Wasm 源码和插件加载产物不一致。

后续建议：

- `settings.js` 暂缓，等前端侧统一拆。
- 如果继续收口，优先针对 `bookmarks.js`、`candidate-pool.js`、`foreground-pages.js` 做同样的文件内阶段函数整理；这些属于预测/学习主管逻辑，不需要再继续拆目录。

### 2026-05-09 第四轮

已完成：

- `extansion/background/preload/prediction/bookmarks.js` 不拆文件，内部拆出书签预加载上下文解析、书签频数排名、目标诊断、独立 hidden-tab 目标构造。
- `extansion/background/preload/prediction/candidate-pool.js` 不拆文件，内部只处理页面链接候选构造、候选 Map merge、metrics enrichment。书签不是页面内链接，不再合并进普通候选池。
- `extansion/background/learning/foreground-pages.js` 不拆文件，内部拆出前台页 digest 上下文解析、recent foreground record 写入、AI 关键词可用性判断、关键词生成、关键词写库。

当前剩余：

- `settings.js` 和 UI 配置 schema 相关文件暂不拆。
- `window-manager/creation.js` 保持文件内拆分，不继续拆目录，除非后续再集中测试隐藏窗口闪烁。
- `preload/state/normalize/entries.js`、`tracking/graph/*` 等数据归一化文件结构已经较细，后续只在发现具体 bug 时局部整理。
