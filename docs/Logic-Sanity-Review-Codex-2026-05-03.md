# Logic Sanity Review - Codex - 2026-05-03

范围：

- 本地 app 生命周期、Native Messaging、本地 HTTP API 授权边界
- 扩展 service worker 主链、设置页、AI provider / LM Studio 接入
- tracking 频数系统、JS fallback 与插件 Rust/Wasm 一致性
- preload 候选筛选、站点选择、真实标签页预加载和原生预加载分组

时间窗口口径仍按“UTC 日期分组 / 当天”理解，不把“非精确滚动 24 小时”列为问题。

## Fix Pass - 2026-05-03

已修复：

- P0 本地 app 编译失败：补回 extension runtime 检测与 shutdown monitor，`cargo check` 已通过。
- P1 双向生命周期未接回 host：Native Messaging 唤醒会写短期 wake marker，`run_host()` 会消费 marker，并启动 Chrome / extension 双监控；debug-force 模式除外。
- P2 JS fallback 与 Wasm edge 更新语义不一致：fallback replay 现在统一通过 `upsertEdgeFallback()` 更新 edge count，再写 transition/message/page indexes，避免 edge 与 message 分叉。
- P2 JS fallback 与 Wasm bucket index 规则不一致：JS bucket 推导改为优先 `hostname`，并剥离 `www.`，与 Wasm 规则对齐。
- P3 LM Studio 活动查询失败不卸载：连续 3 次无法查询本地 app activity 后，插件会保守卸载当前 LM Studio 模型。
- P3 Wasm Node schema 丢弃 `defaultLandingPageUrl`：Wasm Node schema 与 normalize 已补字段，并重新生成 `extansion/wasm/pkg/visit_graph_engine.wasm`。

已确认/待实机：

- LM Studio v1 REST 端点与当前代码使用的 `/api/v1/models`、`/api/v1/models/load`、`/api/v1/models/unload` 一致；来源为 LM Studio 官方 REST 文档。但当前本机 127.0.0.1:1234 没有 listener，无法做本机通过判定。
- “预测计算边界还没有完全收进插件 Rust/Wasm”是架构迁移项，不是当前阻塞 bug；下一阶段应把站点选择、槽位分配、频数/AI 乘区合并的纯计算输入输出先固化，再迁进 Wasm。

本轮验证：

- `cargo check` in `app`：通过。
- `cargo check` in `extansion\wasm\visit-graph-engine`：通过。
- `cargo build --target wasm32-unknown-unknown --release`：通过，已同步 release wasm 到 `extansion\wasm\pkg\visit_graph_engine.wasm`。
- 全量 `node --check extansion\**\*.js`：通过。
- `git diff --check`：通过，仅有工作区 LF/CRLF 提示。

## 验证命令

- `cargo check` in `app`
  - 失败
- `cargo check` in `extansion\wasm\visit-graph-engine`
  - 通过
- `node --check extansion\service-worker.js`
  - 通过
- `node --check extansion\shared\settings.js`
  - 通过
- `node --check extansion\settings\settings.js`
  - 通过
- 全量 `node --check extansion\**\*.js`
  - 通过

## Findings

### P0 - 本地 app 当前无法编译

文件：

- `app/src/lifecycle.rs:67`
- `app/src/lifecycle/extension.rs:15`

`lifecycle.rs` 重新导出了：

- `spawn_extension_shutdown_monitor`
- `target_extension_is_installed`

但 `app/src/lifecycle/extension.rs` 当前只实现了 `target_extension_id()` 和安装/status 扫描工具，没有实现这两个运行期函数。

`cargo check` 当前报错：

```text
error[E0432]: unresolved imports `extension::spawn_extension_shutdown_monitor`, `extension::target_extension_is_installed`
```

影响：

- 本地 app 发布包无法构建。
- Native Messaging 唤醒链、窗口隐藏 API、system activity 查询全部不可用。
- 插件侧即使逻辑正确，也无法完成真实标签页预加载所需的系统隐藏能力。

建议：

- 先恢复 `extension.rs` 的运行期存在性检测函数。
- 不要把这两个导出删掉来“让它编译”，否则会破坏卸载后 app 自退的双向生命周期设计。

### P1 - 双向生命周期设计还没有接回 host 主链

文件：

- `app/src/main.rs:64-80`
- `app/src/lifecycle.rs:109-123`
- `app/src/lifecycle/native_messaging.rs:52-75`

当前 `run_host()` 只启动了 Chrome shutdown monitor：

- `lifecycle::spawn_chrome_shutdown_monitor(shutdown_tx.clone())`

没有启动 extension shutdown monitor。也就是说，即使补上 `spawn_extension_shutdown_monitor()` 的实现，host 仍不会在目标扩展消失时退出。

另外，`write_native_wake_marker()` 和 `consume_recent_native_wake_marker()` 已经存在，但当前 Native Messaging wake path 没有写 marker，`run_host()` 也没有消费 marker。现在这些函数是死代码。

影响：

- 插件卸载后无法再通知本地 app，但本地 app 也没有主动检测目标扩展消失。
- 如果用户手动或 Native Messaging 启动 host，Chrome 仍开着但插件已卸载时，host 可能继续保留窗口管理能力。
- 文档中“生命周期双向”已经更新，但代码还没有落地。

建议：

- `run_host()` 中恢复 extension monitor。
- Native Messaging 启动 host 前写入短期 wake marker。
- `run_host()` 初始 gate 可允许 native wake 短期绕过扫描抖动，但运行期 monitor 不能被绕过。

### P2 - JS fallback 与 Wasm 的 edge 更新语义不一致

文件：

- `extansion/background/tracking/graph/events/transitions.js:1-35`
- `extansion/background/tracking/graph/events/transitions.js:67-94`
- `extansion/wasm/visit-graph-engine/src/events/transitions.rs:11-77`
- `extansion/wasm/visit-graph-engine/src/db.rs:134-199`

Wasm 路径在记录 transition message 后会进入：

- `apply_transition_message_to_indexes()`
- `replay_transition_message_into_edge_counts()`
- `upsert_edge()`

JS fallback 路径在 `applyRecordVisitFallback()` 中只做：

- append transition message
- apply transition message indexes

但没有调用 `upsertEdgeFallback()`。这个函数存在，却当前没有被 fallback 主链调用。

影响：

- Wasm 正常时 edge count 会更新。
- Wasm 失败进入 JS fallback 时，`graph.edges` 会落后于 `transitionMessages` / buckets。
- debug 图、旧 edge 统计、可能依赖 edge 的后续逻辑会和实际 transition message 不一致。
- 这类差异会让“记录到底成功没有”变得很难判断。

建议：

- 让 JS fallback 的 `applyTransitionMessageToIndexes()` 与 Wasm 同步，也先 replay edge counts。
- 或者明确废弃 `graph.edges` 作为统计源，并从 debug/UI 中移除所有 edge count 依赖。当前代码还没有做到后者。

### P2 - JS fallback 与 Wasm 的 bucket index 规则不一致

文件：

- `extansion/background/tracking/graph/indexes/transitions/buckets.js:129-141`
- `extansion/wasm/visit-graph-engine/src/db/buckets.rs:113-132`

JS 侧 bucket 文本来自：

- `graph.nodes[sourceNodeId].host`
- 不去掉 `www.`

Wasm 侧 bucket 文本优先来自：

- `node.hostname`
- 并且会 `strip_prefix("www.")`

例子：

- JS 对 `www.github.com` 会按 `ww` 入桶。
- Wasm 对同一节点会按 `gi` 入桶。

影响：

- 只要某段时间 Wasm 失败并由 JS fallback 写入桶，之后 Wasm 恢复读取时可能读不到这些计数。
- 反过来，如果 Wasm 写入、JS fallback 读取，也会有同类问题。
- 这会表现成“明明跳转过，top 权重还是 1”。

建议：

- 把 JS 和 Wasm 的 bucket label 规则统一。
- 更稳的方案是统一使用 `hostname` 并剥掉 `www.`，或者统一使用 `nodeId` 的规范 host，不要两边各自推导。

### P2 - 预测计算边界还没有完全收进插件 Rust/Wasm

文件：

- `extansion/background/preload/scoring.js:98-156`
- `extansion/background/preload/prediction/site-selection.js:1-157`
- `extansion/background/preload/prediction/site-selection.js:281-433`

当前已经把基础 score normalization 交给 Wasm：

- `scorePreloadCandidatesBatch()`

但以下核心预测逻辑仍在 JS：

- AI 关键词乘区生成
- 站点 AI 关键词聚合
- 站点权重排序
- 两组 native/tab site selection
- 页面槽位分配算法 `allocateSelectedSitePageSlots()`

这不一定是立即 bug，但和最新文档边界不一致：预测计算核心应该逐步进入插件 Rust/Wasm，JS 只做浏览器 API、provider 调用和编排。

影响：

- JS 与 Wasm fallback 更容易继续分叉。
- 后续算法继续升级时，预测核心可能再次散落在多个 JS 文件里。
- 复杂 slot allocation 和权重组合难以统一测试。

建议：

- 短期可以保持 JS 编排，但应把“纯计算输入/输出”先整理成稳定结构。
- 下一步把站点选择和槽位分配迁进 Wasm，AI provider 调用仍留 JS。

### P3 - LM Studio 模型保活/卸载依赖本地 app 可用性

文件：

- `extansion/background/ai/providers.js:291-318`

LM Studio lifecycle watchdog 通过本地 app 查询：

- `/api/v1/system/activity`
- `chromeRunning`
- `nonChromeFullscreen`

如果本地 app 离线，当前逻辑 catch 后返回 `null`，不会主动卸载 LM Studio 模型。

影响：

- 本地 app 不可用、Native Messaging 注册失效、或当前 P0 编译失败时，LM Studio 模型可能保持加载。
- 这和“Chrome 关闭 / 非 Chrome 全屏超过 5 秒 / 插件停止时卸载”的目标不完全一致。

建议：

- 保持本地 app 只做状态查询是合理的。
- 但插件侧应定义“状态查询不可用”时的保守策略，例如：连续 N 次查询失败后卸载 LM Studio 模型，或者在 service worker suspend / pause / preloading disabled 时继续强制卸载。

### P3 - Wasm Node schema 会丢弃 JS 侧的 `defaultLandingPageUrl`

文件：

- `extansion/background/tracking/graph/events/current-page.js:41-53`
- `extansion/wasm/visit-graph-engine/src/model/graph.rs:89-101`

JS fallback 创建 node 时写入：

- `defaultLandingPageUrl`

但 Wasm `Node` struct 没有这个字段。只要状态经过 Wasm apply/query 的序列化回写，这个字段就会被丢弃。

当前继承机制已经按新设计弱化/移除，所以这不是当前预测主链阻塞项。但如果后面还要使用“站点第一个真实落点”或 landing page 统计，这里会变成隐性数据丢失。

建议：

- 如果字段已废弃，JS fallback 也应删除它。
- 如果字段仍要保留，Wasm schema 必须补字段并参与 normalize。

### P3 - LM Studio 管理端点需要实机确认

文件：

- `extansion/shared/lmstudio.js:5-7`
- `extansion/settings/ai-models.js:311-344`

当前假设 LM Studio 提供：

- `GET /api/v1/models`
- `POST /api/v1/models/load`
- `POST /api/v1/models/unload`

设置页和 service worker 都围绕这三个端点做模型列表、加载状态和卸载。这个设计方向符合“插件只调用外部 OpenAI-compatible 工具”的边界，但这些 LM Studio 本地管理端点需要在当前安装版本上实机确认。

影响：

- 如果 LM Studio 版本只稳定提供 OpenAI-compatible `/v1/models` 和 `/v1/chat/completions`，但不支持 load/unload 管理端点，设置页会显示不可用或加载失败。
- AI 预测本身不会因此破坏基础规则链，但“选择后默认保持加载 / 条件触发卸载”的体验不会成立。

建议：

- 实机测试 LM Studio server 的模型 list/load/unload。
- 若 load/unload 端点不可用，降级为“只检测已加载模型，用户在 LM Studio 手动加载/卸载”。

## 当前确认通过的部分

- JS 文件语法检查通过，`importScripts` 顺序未发现新的语法级阻塞。
- Wasm crate `cargo check` 通过。
- 模型安装/卸载/便携 Ollama 旧路由已从 app API 中移除，未发现 service worker 仍引用 `ai-models:*` 或 `native-app/ai` 的残留主链。
- tracking 频数结构已经分成站点频数、外站到子页面频数、站内子页面频数三套结构；主要风险在 fallback/Wasm 一致性，而不是三表缺失。
- `_blank` reserved tab 已有 500ms timeout fallback，不再是无期限 about:blank。

## 建议修复顺序

1. 先修 P0，让本地 app 恢复编译。
2. 接着修 P1，把 extension shutdown monitor 接回 host 运行期。
3. 修 JS fallback / Wasm 一致性，包括 edge replay 和 bucket index 规则。
4. 再考虑把站点选择、槽位分配等纯计算进一步迁进插件 Rust/Wasm。
5. 最后做 LM Studio 实机兼容性测试，并决定 load/unload 不可用时的降级策略。
