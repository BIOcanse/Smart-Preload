# 代码结构审计：过大文件与职责边界

审计日期：2026-06-13

审计目标：

- 检查仓库内是否存在过大文件、生成物混入源码区、发布物/测试输出堆积等问题。
- 检查当前扩展、本地 app、Wasm 和测试代码中是否存在明显职责混淆。
- 给出不影响当前发布稳定性的后续拆分建议。

本次只做结构审计和文档记录，不改变运行逻辑。

## 统计口径

文件体量分两类统计：

1. 物理体积：递归统计工作区文件，排除 `.git`，用于发现构建缓存、发布包、日志和浏览器 profile。
2. 源码体量：排除 `.git`、`.claude`、`output`、`dist`、`target` 后，统计 `.js`、`.mjs`、`.rs`、`.html`、`.css`、`.ps1`、`.cmd`、`.json`、`.toml`、`.md` 物理行数；如果另提“有效行”，指 PowerShell `Measure-Object -Line` 得到的非空输入行。

源码体量阈值：

- `> 1000` 行：高风险，通常需要拆分或至少明确子模块 owner。
- `700-1000` 行：中高风险，若同时承担多个运行时职责，应优先拆。
- `500-700` 行：中风险，允许存在算法/配置集中实现，但要检查职责是否单一。
- 测试 smoke 脚本不直接按源码阈值定性，因为它们通常包含浏览器启动、测试页面、断言和清理流程，但过长时仍需要拆 helper。

## 物理大文件与目录

当前大体积主要来自本地生成物，已在 `.gitignore` 或子项目 `.gitignore` 中覆盖，不属于“误提交源码”级别问题。

| 路径 | 大小 | 文件数 | 判断 |
| --- | ---: | ---: | --- |
| `app/target` | 约 747.16 MB | 2150 | Rust 构建缓存。已被 `.gitignore` 忽略，可按需清理。 |
| `extansion/wasm/visit-graph-engine/target` | 约 545.51 MB | 1446 | Wasm/Rust 构建缓存。由子项目 `.gitignore` 忽略，可按需清理。 |
| `dist` | 约 391.71 MB | 2157 | 发布包与 staging。已忽略；包含多个旧版本副本和日志，适合定期清理或只保留最新 release。 |
| `output` | 约 186.50 MB | 11388 | Playwright/Chromium 测试输出和 profile。已忽略；适合按测试日期清理。 |
| `.claude` | 约 1.88 MB | 234 | 本地工作树/工具状态。已忽略；不是发布内容。 |

`.gitignore` 覆盖情况：

- `app/target/`
- `app/target-codex/`
- `extansion/wasm/visit-graph-engine/target/`
- `output/`
- `dist/`
- `.claude/`

结论：

- 没发现需要从 Git 历史/跟踪集中移除的超大源码文件。
- 本地磁盘上确实有较多发布和测试产物，主要集中在 `dist`、`output` 和 Rust `target`。这些不是源码结构问题，但会干扰人工查看目录和后续打包判断。

建议：

- 发布前保留 `dist` 最新版本和必要测试包即可，旧 staging 可定期清理。
- `output/playwright` 建议按日期保留最近 1-2 次失败样本，其余清理。
- `target` 不需要随发布保留；需要释放空间时直接清理对应 `target` 目录，由 Cargo 重建。

## 已跟踪大文件

已跟踪文件中体积靠前的是：

| 路径 | 大小 | 判断 |
| --- | ---: | --- |
| `extansion/wasm/pkg/visit_graph_engine.wasm` | 约 931.5 KB | 发布所需 Wasm 产物，合理。 |
| `app/Cargo.lock` | 约 100.8 KB | Rust 锁文件，合理。 |
| `docs/Algorithm-Design-Workflow-v0.md` | 约 55 KB / 1748 物理行 | 长文档，合理但可归档。 |
| `extansion/settings/settings.js` | 约 42.9 KB / 1204 物理行 | 源码过大，需拆分。 |
| `scripts/testing/preload-browser-isolation-smoke.mjs` | 约 38.4 KB / 1305 物理行 | smoke 测试过长，后续可抽公共 harness。 |
| `scripts/testing/bookmark-preload-smoke.mjs` | 约 35.6 KB / 1073 物理行 | smoke 测试过长，后续可抽公共 harness。 |
| `extansion/shared/settings.js` | 约 35.0 KB / 1133 物理行 | 配置 schema/归一化/策略工具混合，需拆分。 |

结论：

- 已跟踪文件没有异常大的二进制包。
- 真正需要关注的是几个 700-1000+ 行源码文件和 smoke 测试脚本。

## 源码体量 Top

排除生成物后的源码/文档行数靠前文件：

| 物理行数 | 路径 | 初步判断 |
| ---: | --- | --- |
| 1748 | `docs/Algorithm-Design-Workflow-v0.md` | 长设计文档，可归档或拆分，但不是运行风险。 |
| 1305 | `scripts/testing/preload-browser-isolation-smoke.mjs` | 测试脚本过长，推荐抽 browser harness。 |
| 1204 | `extansion/settings/settings.js` | 设置页 UI、读写、AI 模型、导航、规则卡、性能提示混在一起。 |
| 1133 | `extansion/shared/settings.js` | 默认值、schema、归一化、规则计算、代理匹配、AI provider 工具混在一起。 |
| 1073 | `scripts/testing/bookmark-preload-smoke.mjs` | 测试脚本过长，推荐抽通用 smoke helper。 |
| 1010 | `extansion/background/preload/scheduler/selections.js` | 调度选择 owner 过大，含快照、分配、策略过滤、通知和状态同步。 |
| 911 | `scripts/testing/preload-scheduler-selections.mjs` | 单元测试较长，但可接受；后续抽 fixtures。 |
| 910 | `scripts/testing/click-intercept-navigation-smoke.mjs` | 测试脚本过长，推荐抽 browser harness。 |
| 889 | `extansion/background/preload/scheduler/attention.js` | attention 采样、池化、持久化、触发重排混在一起。 |
| 863 | `extansion/background/preload/runtime/window-manager/creation.js` | 创建、复用、隐藏、回退、窗口枚举、签名判断混在一起。 |
| 807 | `extansion/background/preload/runtime/policy/watchdog.js` | 看门狗、资源压力、性能提示、关闭/休眠执行混在一起。 |
| 782 | `extansion/background/preload/prediction/site-selection.js` | engine adapter、fallback 算法、AI 站点评分、配置 cap、槽位分配混在一起。 |
| 733 | `extansion/settings/settings.css` | 设置页 CSS 偏长，但仍是单页面样式；若 UI 继续扩大再拆。 |
| 602 | `extansion/background/preload/runtime/interaction.js` | hover/contextmenu 入口、策略过滤、hidden-tab/native 写入和清理混在一起。 |
| 588 | `extansion/background/preload/scoring.js` | 基础评分与 AI 推断/缓存/诊断混合。 |
| 572 | `extansion/background/ai/keywords.js` | 关键词 prompt、解析、字段聚合、匹配算法混合，建议中期拆。 |
| 570 | `extansion/wasm/visit-graph-engine/src/selection.rs` | Wasm 算法文件偏长但职责较集中，暂不优先拆。 |
| 531 | `extansion/settings/index.html` | 单页设置 HTML 偏长；可由设置项 schema 化后缩短。 |

## 职责边界问题

### 1. 设置页单文件承担过多职责

文件：`extansion/settings/settings.js`

现状：

- 约 1204 物理行，约 50 个函数。
- 同时负责：
  - DOM 元素引用和事件绑定。
  - 读取表单、保存设置、渲染表单。
  - 调度器设置读写。
  - AI provider/model 下拉和远程模型加载。
  - 左侧导航滚动状态。
  - rule card 动态构建。
  - 性能不足/native app warning 展示。

典型边界：

- `initializeSettingsPage` / `bindUiEvents`：页面生命周期。
- `readFormSettings` / `renderForm` / `syncBaseControlsFromSettings`：表单状态。
- `refreshAiModelOptions` / `ensureSelectedLmStudioModelLoadedFromSettings`：AI provider 运行时。
- `buildNavScrollTargets` / `syncNavForScrollPosition`：导航 UI。
- `renderRuleCards` / `createRuleControlWidget`：规则卡渲染系统。
- `refreshPerformanceWarning` / `renderPerformanceWarning`：运行时诊断提示。

问题：

- 设置项越来越多后，任何新增字段都要同时穿过 DOM、读表单、写表单、互斥规则、保存、dirty 状态、说明 tooltip，容易漏同步。
- AI 模型加载是异步运行时行为，和普通本地设置读写混在同一文件，打开设置页时更难判断哪些操作可能阻塞。
- rule card 已经有 schema 雏形，但 UI 渲染仍在页面主文件里，导致设置页继续膨胀。

建议拆分：

- `extansion/settings/state.js`：`savedSettings`、`draftSettings`、dirty/status、save/reset。
- `extansion/settings/form.js`：普通字段读写和互斥控制。
- `extansion/settings/rule-cards.js`：规则卡 DOM 构建、输入归一化、tooltip。
- `extansion/settings/ai-models-panel.js`：AI provider/model 列表、LM Studio 模型加载。
- `extansion/settings/navigation.js`：左侧导航、滚动同步。
- `extansion/settings/runtime-warnings.js`：性能/native app warning。

优先级：高。

理由：这是用户可见设置入口，后面继续加配置时最容易出错。

### 2. 全局设置 API 变成“配置系统 + 策略工具箱”

文件：`extansion/shared/settings.js`

现状：

- 约 1133 物理行，约 48 个函数。
- 同时负责：
  - 默认设置 `DEFAULT_SETTINGS`。
  - rule card schema。
  - 设置归一化和 merge。
  - 代理跳过规则归一化与 URL 匹配。
  - AI provider catalog fallback 和 provider/model 工具。
  - rule card 公式计算。
  - 设备 profile 检测和 effective settings。
  - storage load/save。

问题：

- 这里被 background、settings page、popup 等多处共享，一旦继续加入更多策略函数，会变成全局依赖中心。
- `shouldSkipProxyRuleUrl` 这类运行策略判断和 `normalizeStoredSettings` 放在同一对象下，调用方很难区分“纯配置归一化”和“运行时策略决策”。
- AI provider 相关逻辑不属于通用设置归一化，应当是 `ai-settings` 或 `ai-model-catalog` 的职责。

建议拆分：

- `extansion/shared/settings/defaults.js`：默认值和常量。
- `extansion/shared/settings/schema.js`：rule card schema、字段 schema、可显示 help 文案 key。
- `extansion/shared/settings/normalize.js`：归一化、merge、互斥规则。
- `extansion/shared/settings/rules.js`：rule card 计算、比较器、cap 派生。
- `extansion/shared/settings/proxy-rules.js`：代理规则归一化与 URL 匹配。
- `extansion/shared/settings/ai.js`：AI provider/model 设置工具。
- `extansion/shared/settings/storage.js`：load/save。
- `extansion/shared/settings/index.js`：组合并暴露 `ZeroLatencySettings`。

优先级：高。

理由：设置 schema 是未来所有 UI 和调度逻辑的共同基础，必须保持可读和可扩展。

### 3. 预加载调度选择 owner 过大

文件：`extansion/background/preload/scheduler/selections.js`

现状：

- 约 1010 物理行，约 39 个函数。
- 同时负责：
  - 根据候选池生成 snapshot。
  - 保存/裁剪 candidate selection snapshot。
  - 基于 attention dwell share 分配 native/hidden-tab 额度。
  - proxy/native-only/incognito 策略过滤。
  - 从 snapshot 构造 scheduled selection。
  - 同步 desired set 到真实 preload runtime。
  - 读取 open tabs。
  - 通知 source tabs。
  - 记录 diagnostics。

问题：

- 它现在既是“调度算法层”，又是“状态持久化层”，还是“Chrome tabs 查询/通知层”。
- proxy/native-only/incognito 这种策略调用散落其中，会让后续添加新全局策略时继续扩散。
- `buildLimitedSelectionFromSnapshot`、`buildScheduledSelectionForSnapshot`、`synchronizeScheduledPreloadSelection` 属于不同抽象层，应分开。

建议拆分：

- `scheduler/snapshots.js`：snapshot 建立、保存、裁剪、summary。
- `scheduler/planner.js`：输入 snapshots + dwell shares + settings，输出 scheduled selections。
- `scheduler/filters.js`：统一执行 proxy/incognito/native-only/resource-pressure 过滤。
- `scheduler/sync.js`：把 scheduled selection 同步到 preload runtime。
- `scheduler/notify.js`：source tab 通知。
- `scheduler/selections.js` 保留高层门面。

优先级：高。

理由：这是当前窗口级预加载新架构的核心，继续增改时风险最高。

### 4. Attention 采样、池化、持久化和重排触发混在一起

文件：`extansion/background/preload/scheduler/attention.js`

现状：

- 约 889 物理行，约 29 个函数。
- 同时负责：
  - 判断当前 tab 是否可计时。
  - 输入/媒体活动权重。
  - pending duration 累积。
  - segment 入池和时间池挤出。
  - dwell share 计算。
  - active tab/window 事件处理。
  - 保存 preload state。
  - 入池后触发 reschedule。

问题：

- 用户要求“内部真实精确秒数累计，攒满分片入池，入池立即触发重新分配”，这个语义本身复杂，当前文件把状态机和副作用放在一起，后续排查容易困难。
- 计时规则、segment pool 数据结构和 scheduler 触发应有明确边界。

建议拆分：

- `scheduler/attention/model.js`：cursor、pending、segment、pool 数据操作。
- `scheduler/attention/collector.js`：tab/window/activity 事件转 cursor 更新。
- `scheduler/attention/pool.js`：入池、挤出、dwell share。
- `scheduler/attention/effects.js`：保存 state、触发 reschedule、diagnostics。
- `scheduler/attention.js` 保留门面。

优先级：中高。

理由：功能已基本稳定，但语义复杂，建议在下一轮大重构时拆。

### 5. Window manager creation 文件职责偏宽

文件：`extansion/background/preload/runtime/window-manager/creation.js`

现状：

- 约 863 物理行，约 28 个函数，`globalThis` 调用较多。
- 同时负责：
  - preload window 创建。
  - preload window 复用。
  - incognito source context。
  - sentinel tab 创建/识别。
  - native app 系统隐藏。
  - hide backoff。
  - Chrome windows 枚举。
  - 候选窗口排序。
  - window runtime 状态写回。

问题：

- “创建窗口”和“系统级隐藏/回退策略”是两个生命周期，混在一起会让后台隐藏窗口现形问题更难定位。
- 复用已有窗口、创建新窗口、隐藏窗口、记录 hide failure 都在同一文件，测试粒度不好切。

建议拆分：

- `window-manager/create.js`：创建新 preload window。
- `window-manager/reuse.js`：发现并复用现有 preload window。
- `window-manager/sentinel.js`：sentinel tab 生命周期。
- `window-manager/system-hide.js`：native hide 调用、backoff、failure 记录。
- `window-manager/selection.js`：候选窗口筛选和排序。
- `window-manager/creation.js` 保留 `ensurePreloadWindow` 门面或删除。

优先级：中高。

理由：本地 app 隐藏窗口/心跳/Edge 适配都依赖这块，边界清楚会直接降低实机 bug 定位成本。

### 6. Watchdog 文件混合了策略判断、性能采样和执行动作

文件：`extansion/background/preload/runtime/policy/watchdog.js`

现状：

- 约 807 物理行，约 18 个函数。
- 同时负责：
  - preload window watchdog。
  - native-only 模式下清理 hidden-tab。
  - resource pressure 策略。
  - native app activity/performance snapshot 调用。
  - performance warning 缓存。
  - close/sleep hidden tabs 执行动作。
  - preload window system hide signature。

问题：

- “是否应该降载”和“如何降载”混在一起。
- 性能不足提示与真实资源压力执行共享状态，后续 UI 查询很容易又引入阻塞路径。
- `closeHiddenTabsForResourcePressure` / `sleepHiddenTabsForResourcePressure` 与 watchdog 主循环是不同 owner。

建议拆分：

- `runtime/policy/watchdog.js`：只保留周期入口、窗口修复/保温。
- `runtime/policy/resource-pressure/detector.js`：activity/performance snapshot、sample window。
- `runtime/policy/resource-pressure/decision.js`：close/sleep/ignore 决策。
- `runtime/policy/resource-pressure/apply.js`：关闭/休眠 hidden tabs。
- `runtime/policy/performance-warning.js`：UI warning 缓存和轻量查询。
- `runtime/policy/system-hide-signature.js`：隐藏状态签名。

优先级：高。

理由：这块和 popup/settings 的性能提示、游戏/专业软件策略、后台页面隐藏稳定性都有交集。

### 7. 站点选择算法文件同时承担 engine adapter 与 fallback 算法

文件：`extansion/background/preload/prediction/site-selection.js`

现状：

- 约 782 物理行，约 29 个函数。
- 同时负责：
  - 构造 Wasm engine request。
  - 解析 engine response。
  - fallback 同源/跨站点选择。
  - site cluster 构建和排序。
  - AI 站点关键词 multiplier。
  - native/tab page slot limit 解析。
  - `allocateSelectedSitePageSlots` 整数分配函数。

问题：

- engine adapter 与 fallback 选择算法应分离，否则 engine 行为和 JS fallback 行为容易不一致。
- `allocateSelectedSitePageSlots` 是通用整数分配算法，现在藏在 site-selection 内，后续上层 tab 分配也会复用，应该独立。
- AI multiplier 是可选增强，不应混入基础 site selection 主体。

建议拆分：

- `prediction/site-selection/engine-adapter.js`
- `prediction/site-selection/fallback.js`
- `prediction/site-selection/clusters.js`
- `prediction/site-selection/limits.js`
- `prediction/site-selection/slot-allocation.js`
- `prediction/site-selection/ai.js`
- `prediction/site-selection.js` 保留门面。

优先级：中高。

理由：算法已经被多层调度复用，拆出整数分配函数有利于避免上下层算法漂移。

### 8. Scoring 文件混合基础评分和 AI 推断

文件：`extansion/background/preload/scoring.js`

现状：

- 约 588 物理行，约 25 个函数。
- 同时负责：
  - 基础分、频数 multiplier、候选排序。
  - AI keyword multiplier。
  - AI interest context 构造。
  - 调用 AI provider。
  - AI 缓存、裁剪、诊断。
  - open context pages 收集。

问题：

- 基础评分应是纯函数，AI 推断是异步外部依赖，两者混在一起会增加测试和性能判断成本。
- 后续如果支持更多 AI provider 或关闭 AI，基础评分仍应独立稳定。

建议拆分：

- `preload/scoring/base.js`
- `preload/scoring/frequency.js`
- `preload/scoring/ai-context.js`
- `preload/scoring/ai-inference.js`
- `preload/scoring/cache.js`
- `preload/scoring.js` 保留门面。

优先级：中。

### 9. 交互预加载 runtime 文件承担入口、策略和执行

文件：`extansion/background/preload/runtime/interaction.js`

现状：

- 约 602 物理行，约 16 个函数。
- 同时负责：
  - hover/contextmenu status/start/cancel。
  - context 解析。
  - incognito/proxy/native-only/resource pressure 过滤。
  - hidden-tab interaction preload 创建。
  - synthetic native preload 写入。
  - contextmenu 预加载销毁。
  - source runtime 清理。

问题：

- 入口消息处理和执行策略混在一起，后续 Chrome/Edge 行为差异、无痕窗口、右键菜单行为继续增加时容易膨胀。
- hidden-tab 执行和 synthetic native 执行应通过统一 target plan 后分发。

建议拆分：

- `runtime/interaction/context.js`
- `runtime/interaction/policy.js`
- `runtime/interaction/plan.js`
- `runtime/interaction/hidden-tab.js`
- `runtime/interaction/synthetic.js`
- `runtime/interaction/cleanup.js`
- `runtime/interaction.js` 保留 public API。

优先级：中。

### 10. Tracking 入口耦合了 preload 和 learning

文件：`extansion/background/tracking/index.js`

现状：

- 约 402 物理行，不算过大，但 `globalThis` 引用较多。
- 同时负责：
  - webNavigation visit/current-page 记录。
  - bookmark preload navigation 处理。
  - created navigation target 处理。
  - 调用 preload activation。
  - 调用 learning link behavior。
  - incognito/proxy skip 策略。
  - tab replacement transition。

问题：

- tracking owner 理论上应只维护访问图和 tab state；现在会主动调用 preload activation 和 learning 行为，跨域副作用较多。
- 这类交叉调用未来容易造成“拦截/预加载/访问图/学习”之间的循环依赖。

建议拆分或改边界：

- `tracking/navigation-events.js`：把 Chrome navigation details 归一化成 tracking events。
- `tracking/transition-recorder.js`：只负责写访问图。
- `tracking/current-page.js`：只负责当前页 state。
- `tracking/integration/preload-activation.js`：明确记录 tracking -> preload 的桥接。
- `tracking/integration/learning.js`：明确记录 tracking -> learning 的桥接。
- 或者由 router/runtime 编排这些 integration，tracking 本身只返回结果，不直接调用其它系统。

优先级：中。

### 11. AI keywords 文件偏算法集合

文件：`extansion/background/ai/keywords.js`

现状：

- 约 572 物理行，约 26 个函数。
- 同时负责：
  - prompt 构造。
  - AI 输出解析。
  - keyword 归一化。
  - candidate/site semantic fields 构造。
  - keyword 匹配、分词、tier 计算。

问题：

- 目前体量可接受，但 prompt、parse、match、field extraction 是不同职责。
- 后续如果 prompt 版本化或多语言关键词增强，这个文件会很快超过 700 行。

建议拆分：

- `ai/keywords/prompt.js`
- `ai/keywords/parse.js`
- `ai/keywords/fields.js`
- `ai/keywords/match.js`
- `ai/keywords/index.js`

优先级：低到中。

### 12. Service worker 入口依赖清单过长

文件：`extansion/service-worker.js`

现状：

- 约 336 物理行，不算过大。
- 但 `importScripts(...)` 清单从入口直接列出约 160 行模块路径。
- 入口还直接注册所有 Chrome 事件并决定 queue 类型。

问题：

- MV3 service worker 没有 bundler 时，显式 `importScripts` 是现实约束；但清单过长导致加载顺序风险高。
- 每次新增模块都要人工插入正确顺序，容易漏依赖或顺序错。

建议：

- 短期保留显式清单，但按 domain 加注释分组。
- 中期考虑生成 `service-worker.imports.generated.js` 或使用轻量构建脚本根据 manifest 列表生成。
- 保持事件注册和消息 queue 分派在入口；不要把领域逻辑写回入口。

优先级：中。

## 测试文件问题

长测试脚本：

- `scripts/testing/preload-browser-isolation-smoke.mjs`：1305 物理行。
- `scripts/testing/bookmark-preload-smoke.mjs`：1073 物理行。
- `scripts/testing/click-intercept-navigation-smoke.mjs`：910 物理行。
- `scripts/testing/preload-scheduler-selections.mjs`：911 物理行。

判断：

- 这些不是发布运行时代码，风险低于核心 background 模块。
- 但浏览器 smoke 脚本已经把测试服务器、浏览器 profile、扩展加载、页面构造、断言、截图/日志输出都写在一个文件里，失败时定位成本高。

建议：

- `scripts/testing/lib/browser-extension-harness.mjs`：Chromium/Edge 启动、扩展加载、profile 管理。
- `scripts/testing/lib/http-fixtures.mjs`：本地测试站点和路由。
- `scripts/testing/lib/extension-debug.mjs`：调试 snapshot、runtime events、storage helper。
- `scripts/testing/lib/assertions.mjs`：通用断言和等待条件。
- 各 smoke 脚本只保留场景步骤。

优先级：低到中。

## 不建议立即处理的项

以下项当前不建议作为发布前阻塞项：

- `extansion/wasm/pkg/visit_graph_engine.wasm`：虽然是已跟踪二进制，但它是扩展运行所需的 Wasm 产物，体积不到 1 MB。
- `_locales/*/messages.json`：每个约 692 行，属于多语言完整文案，不应为了行数拆分。
- `docs/*.md` 长文档：文档可归档整理，但不是运行时风险。
- `app/src`：目前最大 Rust 源文件约 381 物理行左右，本地 app 结构整体比扩展 background 更健康。

## 建议优先级

### 发布前只建议做的事

1. 不改运行逻辑。
2. 保留当前 `.gitignore`。
3. 清理本地磁盘时优先处理 `dist` 旧版本、`output/playwright` 旧 profile、Rust `target`。
4. 若继续改 popup/settings，避免再往 `settings.js` 和 `shared/settings.js` 直接堆大块逻辑。

### 发布后第一轮结构整理

1. 拆 `extansion/shared/settings.js`。
2. 拆 `extansion/settings/settings.js`。
3. 拆 `extansion/background/preload/scheduler/selections.js`。
4. 拆 `extansion/background/preload/runtime/policy/watchdog.js`。

### 发布后第二轮结构整理

1. 拆 `window-manager/creation.js`。
2. 拆 `scheduler/attention.js`。
3. 拆 `prediction/site-selection.js`。
4. 拆 `preload/scoring.js` 和 `runtime/interaction.js`。
5. 抽 smoke test harness。

## 文件结构规划

推荐目标结构示意：

```text
extansion/
  shared/
    settings/
      defaults.js
      schema.js
      normalize.js
      rules.js
      proxy-rules.js
      ai.js
      storage.js
      index.js
  settings/
    settings.js
    state.js
    form.js
    navigation.js
    rule-cards.js
    ai-models-panel.js
    runtime-warnings.js
  background/
    preload/
      scheduler/
        attention/
          model.js
          collector.js
          pool.js
          effects.js
        snapshots.js
        planner.js
        filters.js
        sync.js
        notify.js
        selections.js
      runtime/
        policy/
          watchdog.js
          performance-warning.js
          resource-pressure/
            detector.js
            decision.js
            apply.js
        window-manager/
          create.js
          reuse.js
          sentinel.js
          system-hide.js
          selection.js
          index.js
        interaction/
          context.js
          policy.js
          plan.js
          hidden-tab.js
          synthetic.js
          cleanup.js
          index.js
      prediction/
        site-selection/
          engine-adapter.js
          fallback.js
          clusters.js
          limits.js
          slot-allocation.js
          ai.js
          index.js
      scoring/
        base.js
        frequency.js
        ai-context.js
        ai-inference.js
        cache.js
        index.js
```

## 总结

当前代码没有严重的“巨大文件误提交”问题；大体积主要是本地构建、发布和测试输出，已经忽略。源码层面真正的问题是扩展 background 的预加载调度系统和设置系统增长很快，已经出现多个 700-1000+ 行的 owner 文件。它们不是马上会导致发布失败的问题，但继续加功能时会显著增加漏同步、阻塞 UI、策略互相影响和实机 bug 定位成本。

最应该优先控制的是：

1. `extansion/shared/settings.js`
2. `extansion/settings/settings.js`
3. `extansion/background/preload/scheduler/selections.js`
4. `extansion/background/preload/runtime/policy/watchdog.js`
