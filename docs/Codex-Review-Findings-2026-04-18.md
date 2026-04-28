# Codex Review Findings 2026-04-18

这份文档只记录我这轮代码审查确认下来的问题清单，不和 Claude 的审查混用。

范围：
- `extansion/background/*`
- `extansion/scripts/*`
- `extansion/wasm/visit-graph-engine/src/*`
- `app/src/*`

不包含修复方案，只列问题、影响和证据位置。

---

## [P1] 本地 app API 仍然对任意 Chrome 扩展开放

位置：
- [app/src/api.rs](/D:/Code%20/Chrome%20extension/app/src/api.rs:88)

问题：
- 本地 HTTP 服务的 CORS 现在不再允许普通网页访问，但仍然接受任何 `chrome-extension://...` 源。
- 这意味着用户机器上的任意已安装扩展，都可以直接调用：
  - `/api/v1/ai/infer`
  - `/api/v1/ai/models/install`
  - `/api/v1/windows/hide`
  - `/api/v1/windows/show`

影响：
- 本地工具层实际上仍然暴露给“所有扩展”，而不是“本扩展”。
- 这会把模型管理、窗口隐藏和系统信息接口变成跨扩展控制面。

---

## [P1] 全局 mutation queue 会被 AI 推理和模型管理长时间堵住

位置：
- [extansion/background/core/state/container.js](/D:/Code%20/Chrome%20extension/extansion/background/core/state/container.js:14)
- [extansion/service-worker.js](/D:/Code%20/Chrome%20extension/extansion/service-worker.js:152)
- [extansion/background/actions/messages.js](/D:/Code%20/Chrome%20extension/extansion/background/actions/messages.js:21)
- [extansion/background/learning/foreground-pages.js](/D:/Code%20/Chrome%20extension/extansion/background/learning/foreground-pages.js:69)
- [extansion/background/core/messages/ai-models.js](/D:/Code%20/Chrome%20extension/extansion/background/core/messages/ai-models.js:50)

问题：
- 所有浏览器事件、消息、alarm 都串行进入同一个 `mutationQueue`。
- 但队列里的任务包含：
  - 页面关键词推理
  - AI 上下文推理
  - 模型安装/卸载
- 这些路径可能耗时数秒到数十分钟。

影响：
- 一旦 AI 推理或模型下载在队列前面，后面的：
  - tracking
  - preload watchdog
  - tab/window 生命周期处理
  - 其他 runtime message
  都会被整体阻塞。
- 这是系统级实时性问题，不是单点逻辑错误。

---

## [P1] 候选扫描和页面摘要上报绑定，动态页面上会反复写 tracking 并可能重复触发 AI 页面总结

位置：
- [extansion/scripts/navigation-interceptor.js](/D:/Code%20/Chrome%20extension/extansion/scripts/navigation-interceptor.js:64)
- [extansion/scripts/navigation-interceptor.js](/D:/Code%20/Chrome%20extension/extansion/scripts/navigation-interceptor.js:84)
- [extansion/background/learning/foreground-pages.js](/D:/Code%20/Chrome%20extension/extansion/background/learning/foreground-pages.js:23)
- [extansion/background/learning/foreground-pages.js](/D:/Code%20/Chrome%20extension/extansion/background/learning/foreground-pages.js:61)

问题：
- 内容脚本每次候选重扫时，都会同时：
  - `sendCandidateLinks()`
  - `reportPageDigest()`
- 页面摘要处理链会先无条件写一遍 `record-foreground-page`，然后才检查关键词是否过期。
- 如果页面 DOM 高频变化，或者 `contentFingerprint` 随小变化而变化，就会不断重新触发这一整条链。

影响：
- 动态页面上会产生大量无意义的 tracking state 写入。
- 若 `contentFingerprint` 变化频繁，还可能重复触发 AI 页面关键词生成。
- 与全局串行队列叠加后，容易放大成整体卡顿。

---

## [P2] AI 预测是否启用依赖设置里的“已下载模型”缓存，而不是启动时主动同步的本地真实状态

位置：
- [extansion/background/preload/scoring.js](/D:/Code%20/Chrome%20extension/extansion/background/preload/scoring.js:104)
- [extansion/background/actions/runtime.js](/D:/Code%20/Chrome%20extension/extansion/background/actions/runtime.js:32)
- [extansion/background/core/messages/ai-models.js](/D:/Code%20/Chrome%20extension/extansion/background/core/messages/ai-models.js:50)

问题：
- 预加载打分层判断 AI 是否可用时，依赖：
  - `settings.preloading.effectiveAiPredictionModelDownloaded`
- 但启动阶段只会探测 native app health，不会主动拉一次本地模型状态。
- 模型状态只有在显式触发 `ai-models:get-status` / `ai-models:set-installed` 时才会同步回设置。

影响：
- 如果模型已经在本地 app 里存在，但扩展启动后没有显式同步状态，AI 预测会被错误地视为不可用。
- 这会导致“本地模型实际上可用，但后台预测链一直不启用 AI”。

---

## [P2] 候选池按 URL 只保留第一次出现的链接，丢弃了同页后续更强的语义信息

位置：
- [extansion/background/preload/prediction/candidate-pool.js](/D:/Code%20/Chrome%20extension/extansion/background/preload/prediction/candidate-pool.js:21)

问题：
- 当前候选池用 `seen` 按 `candidateUrl` 去重。
- 同一个目标 URL 在页面中出现多次时，只保留第一次遇到的那条。
- 后续更好的：
  - `anchorText`
  - `nearbyText`
  - `ariaLabel`
  - `visibility`
  - `targetHint`
  都会被直接丢掉。

影响：
- AI 关键词匹配可能用到的是页头/页脚/导航栏中的弱文本，而不是正文区域里更准确的链接语义。
- `_self / _blank` 的快速判断也可能被第一次出现的弱样本污染。

---

## [P2] Wasm 引擎首次加载失败后不会重试，会长期退回 JS fallback

位置：
- [extansion/background/tracking/engine/wasm/load.js](/D:/Code%20/Chrome%20extension/extansion/background/tracking/engine/wasm/load.js:1)

问题：
- `visitGraphEnginePromise` 在首次加载失败后会被缓存成解析为 `null` 的 Promise。
- 后续不会再尝试重新 fetch / instantiate wasm，直到 service worker 整体重启。

影响：
- 一次临时性的加载失败就会让整次 worker 生命周期都停留在 JS fallback。
- 这会造成性能和行为边界不稳定，而且不容易从外部看出来。

---

## [P3] 当前窗口标签页进入 AI 上下文时，大多数只有标题，没有稳定文本摘要

位置：
- [extansion/background/preload/scoring.js](/D:/Code%20/Chrome%20extension/extansion/background/preload/scoring.js:215)
- [extansion/background/ai/keywords.js](/D:/Code%20/Chrome%20extension/extansion/background/ai/keywords.js:50)

问题：
- AI 上下文里确实会带“当前窗口已打开标签页”。
- 但这些标签页的 `textDigest` 只会从 5 条历史页面信息池里回填。
- 对绝大多数当前仍然打开但不在这 5 条历史池里的标签页，送进 AI 的通常只有：
  - `pageUrl`
  - `title`
  - 空的 `textDigest`

影响：
- 与当前设计文档“当前窗口已有标签页信息”相比，现状更像“当前窗口页标题列表 + 少量历史文本补丁”。
- AI 的近期兴趣关键词推理会比预期更依赖标题，语义信息偏弱。

---

## 结论

当前最需要优先关注的，不是更多算法参数，而是这三类系统风险：

1. 本地 app 授权边界仍然过宽
2. AI / 模型操作与全局后台事件队列强耦合
3. 动态页面上的摘要/学习链缺少稳态节流

这些问题不一定立刻表现为语法错误，但会直接影响后续真实测试时的结论可靠性。
