# Codex Design Compliance Review 2026-04-19

这份文档只记录“当前代码与既定设计 / 文档口径不一致”的问题。

- 不和 `Code-Review-Merged-v0.md` 混用
- 不和 Claude 的审查文档合并
- 当前只列问题，不在这里写修复方案

---

## P1

### 1. Popup `Top` 已被改成 preload 视图，和既定文档口径相反

**现状**

- popup 后台返回的 `currentTopTargets` 直接来自 `buildCurrentPreloads(...)`
  - [extansion/background/core/messages/debug.js](../extansion/background/core/messages/debug.js)
- popup 也直接把它渲染成 `Top`
  - [extansion/popup/popup.js](../extansion/popup/popup.js)
  - [extansion/popup/hello.html](../extansion/popup/hello.html)

关键位置：

- `debug.js:15`
- `state/view.js:27`
- `popup.js:68`
- `popup.js:77`
- `popup.js:95`
- `hello.html:181`

**为什么不符合设计**

既定文档口径是：

- `Top` 是当前页面的 page-local outbound top destinations
  - [docs/Preload-Tracking-Logic.md:32](./Preload-Tracking-Logic.md)
  - [docs/Preload-Tracking-Logic.md:33](./Preload-Tracking-Logic.md)

现在实际却变成了：

- `Top = 当前 preload state 中的条目`
- 并且空文案也变成了 `No preload-qualified links on this page yet.`

**直接后果**

- 没有 preload 条目时，`Top` 会空，即使当前页其实已经有历史跳转数据
- UI 上已经不再能区分“历史 top”与“当前 preload”
- 用户会把 `Top` 误认为“设计上的 top”，但现在看到的是另一层数据

---

### 2. `Top` 列表混合 `hidden-tab / prerender / prefetch`，会把“可替换目标”和“不可替换目标”混成一层

**现状**

- `buildCurrentPreloads(...)` 会把：
  - `hiddenTabEntriesByUrl`
  - `prerenderEntriesByUrl`
  - `prefetchEntriesByUrl`
  全部拼到同一个数组里，再按 `score` 排序
  - [extansion/background/preload/state/view.js](../extansion/background/preload/state/view.js)

关键位置：

- `state/view.js:27`
- `state/view.js:34`
- `state/view.js:45`
- `state/view.js:56`
- `state/view.js:70`

**为什么不符合设计**

文档里对跨站当前标签页 hard swap 的既定口径是：

- 开启实验开关后，才允许 `hard swap`
- 它依赖 hidden-tab 容器
  - [docs/Algorithm-Design-Workflow-v0.md:452](./Algorithm-Design-Workflow-v0.md)
  - [docs/Algorithm-Design-Workflow-v0.md:454](./Algorithm-Design-Workflow-v0.md)
  - [docs/Algorithm-Design-Workflow-v0.md:458](./Algorithm-Design-Workflow-v0.md)

但当前 UI 显示层把：

- 可替换的 `hidden-tab`
- 不能替换的 `prefetch`
- 也不走 hard swap 的 `prerender`

全都放进同一个 `Top` 列表。

**直接后果**

- 用户在 `Top` 里看到 GitHub，不等于 GitHub 是一个可用于当前标签页替换的 hidden-tab
- 这会直接制造“明明上榜了，为什么不替换”的错觉

---

### 3. Google 搜索页的链接打开行为学习被 query-less 归一化污染，`_blank / _self` 记忆会跨查询串联

**现状**

- Google 搜索结果页在页级 URL 上会被统一归一化到 query-less `/search`
  - [extansion/background/tracking/url/model.js](../extansion/background/tracking/url/model.js)
- 链接打开行为学习的 source key 也直接使用 `normalizePageUrlForIndex(sourcePageUrl)`
  - [extansion/background/learning/link-behavior.js](../extansion/background/learning/link-behavior.js)
- 读取行为记忆时同样基于这个归一化后的 page URL
  - [extansion/background/tracking/graph/indexes/link-behavior.js](../extansion/background/tracking/graph/indexes/link-behavior.js)

关键位置：

- `url/model.js:21`
- `url/model.js:174`
- `learning/link-behavior.js:39`
- `learning/link-behavior.js:71`
- `indexes/link-behavior.js:1`
- `indexes/link-behavior.js:12`

**为什么不符合设计**

文档里已经把这层定义成：

- source-page-local on purpose
- 同一个目标在不同 source page 上可以有不同打开方式
  - [docs/Preload-Tracking-Logic.md:78](./Preload-Tracking-Logic.md)

但当前 Google 搜索页被 query-less 折叠后：

- `google 搜索 github`
- `google 搜索 chrome extension`
- `google 搜索 rust wasm`

都会共享同一个 source page key。

**直接后果**

- 某次搜索中对 GitHub 的 `_blank` 行为记忆，可能污染到后续完全不同搜索上下文
- 进而把本该判成 `cross-site-current-tab` 的候选，错误送进 `cross-site-new-tab` 场景
- 这会直接影响：
  - 策略是 `hidden-tab` 还是 `prefetch`
  - 当前标签页 hard swap 是否还能命中

---

### 4. 频数乘区现在只吃 `pageTransitionCount`，站点级历史完全失效，已经偏离“页级与站点级并存”的设计

**现状**

- JS 侧候选 enrich 现在直接：
  - `transitionCount = pageTransitionCount`
  - [extansion/background/preload/prediction/metrics.js](../extansion/background/preload/prediction/metrics.js)
- JS fallback query 返回的 `transitionCount` 也只给页级值
  - [extansion/background/tracking/engine/query-fallback/transitions.js](../extansion/background/tracking/engine/query-fallback/transitions.js)
- Wasm query 也同步只返回页级值
  - [extansion/wasm/visit-graph-engine/src/query/transitions.rs](../extansion/wasm/visit-graph-engine/src/query/transitions.rs)

关键位置：

- `metrics.js:30`
- `query/transitions.rs:169`
- `query/transitions.rs:170`
- `query/transitions.rs:171`

**为什么不符合设计**

文档中计数与索引层仍然明确定义：

- 站点级跳转计数桶
- 页级跳转计数桶
- 页级消息和站点级消息并存
  - [docs/Algorithm-Design-Workflow-v0.md:237](./Algorithm-Design-Workflow-v0.md)
  - [docs/Algorithm-Design-Workflow-v0.md:239](./Algorithm-Design-Workflow-v0.md)
  - [docs/Algorithm-Design-Workflow-v0.md:1429](./Algorithm-Design-Workflow-v0.md)

但当前实现已经不是“并存后综合使用”，而是：

- 站点级频数虽然还在查
- 但不会进入最终 `transitionCount`

**直接后果**

- 这轮虽然修掉了“GitHub 主页频数污染所有子页”的问题
- 但同时也把站点级历史信号整个切没了
- 用户已经访问过某站点，但没有访问过精确子页时，权重仍然会卡在 `1`

这和设计里“页级和站点级并存”的预期不一致，当前属于一刀切过头。

---

## P2

### 5. 当前标签页 hard swap 仍然是“best effort 消费已有 hidden-tab”，不是一条确定性可观测的替换链

**现状**

- 点击当前标签页跨站链接时，内容脚本会发 `preload:activate-if-ready`
  - [extansion/scripts/navigation-interceptor.js](../extansion/scripts/navigation-interceptor.js)
- 激活链只会查现有 hidden-tab entry
- 最多等 `1200ms`
- 还没 `complete` 就直接删除 entry 并 fallback
  - [extansion/background/preload/runtime/activation/flow.js](../extansion/background/preload/runtime/activation/flow.js)

关键位置：

- `navigation-interceptor.js:231`
- `navigation-interceptor.js:254`
- `navigation-interceptor.js:316`
- `flow.js:1`
- `flow.js:27`
- `flow.js:46`
- `flow.js:47`
- `flow.js:165`

**为什么不符合设计**

设计口径已经被收成：

- hard swap 只消费已有 preload 成果
- 没有成果就正常放行

但当前实现缺一个很关键的可观测边界：

- UI 和 runtime 没有明确告诉用户“这个目标到底是不是 hidden-tab ready”
- 用户只能看到混合后的 `Top`
- 点击后如果 1.2 秒内没 ready，entry 还会被直接删掉

**直接后果**

- 从用户视角看，就是“开了替换标签页，但行为非常像没开”
- 这不是单个 if 的问题，而是当前 hard swap 还没有一个稳定、可观测、能解释的 readiness 边界

---

## 结论

当前最核心的不一致，不是语法层，而是这 5 条：

1. `Top` 被改成了 preload 列表，偏离文档原定义
2. `Top` 还混合了不可替换策略，误导用户判断 hard swap 是否应该发生
3. Google 搜索页的 `_self / _blank` 学习被 query-less source key 污染
4. 频数乘区现在只看页级，站点级历史信号被整体切掉
5. hard swap 虽然功能开关存在，但现在还不是一条足够可观测的确定性替换链

这 5 条是当前最值得先收的设计一致性问题。
