# Zero-Latency Web 落地路线图 v0

## 1. 目标

这份路线图只回答三个问题：

- 先做什么
- 后做什么
- 每一步完成后，系统边界会变成什么样

它不替代算法设计文档。
它是当前推进顺序的执行版。

---

## 1.1 当前指定入口边界

当前已固定 4 个指定入口文件：

- 扩展主程序文件：`extansion/service-worker.js`
- 扩展后台维护文件：`extansion/background/preload/runtime/policy/watchdog.js`
- 本地 app 主程序文件：`app/src/main.rs`
- 本地 app 后台维护文件：`app/src/lifecycle/host.rs`
- 本地 app 旧 watcher 清理文件：`app/src/lifecycle/watcher.rs`

后续路线图里的“收口”“减厚”“边界整理”，都以这 4 个指定入口为基线判断：

- 高层逻辑如果继续长在别处，需要先判断它是合理的子系统协调层，还是新的隐式入口。
- 只有前者可以保留；后者应继续收回指定入口边界。

当前配套文档：

- `docs/Codex-Manager-Architecture-v0.md`
- `docs/Codex-High-Level-Bugs-2026-04-19.md`

---

## 2. 当前阶段划分

## Phase 1: 稳定基础追踪链

目标：

- 当前页面状态稳定维护
- 真实跳转消息只在真实导航发生时写入
- popup `Top` 不再因为 source 丢失而失真

完成标准：

- `null -> B` 和 `A -> A` 这类错误记录消失
- Google 搜索结果页这类已打开页面在扩展重载后仍可正常作为 source

## Phase 2: 清理 Rust 计算核边界

目标：

- Rust 内部先拆出清晰的数据/查询边界
- 为后续独立的筛选/打分层做准备

完成标准：

- `lib.rs` 不再同时堆全部类型、查询、索引、事件处理
- 至少先有清晰的 query 层与底层数据层边界

## Phase 3: 清理预测链

目标：

- 当前规则链继续可用
- 预测输入、筛选顺序、权重输出都收成明确边界

完成标准：

- 当前规则链不再和 tracking/runtime 混在一起
- 未来高级权重算法可以直接插入，不用推翻旧链

## Phase 3.5: 收口统一事件主链

目标：

- 所有浏览器事件、content script 消息、扩展 UI 消息，先进入主程序
- 主程序只做接入、标准化、判断、动作调度
- tracking / learning / preload / activation 不再各自边判断边执行

完成标准：

- `service-worker` 成为真正的主程序入口
- `router` 只负责分发，不继续堆业务逻辑
- 初步形成 `intercept / judge / actions / learning` 四类模块
- 后续 Claude 和 Codex 协作时，消息处理路径有统一口径

### Phase 3.5 的并行路径策略

收口主程序入口是一次高风险改造，因为旧入口已经分散在 tracking / preload / learning / native 各自的 listener 里。直接硬切换会产生"新旧逻辑同时存在但口径不一致"的窗口期。

当前应固定一条落地策略：

- 新主程序路径先在 feature flag 后启用，不默认开
- 让两条路径并行跑一段时间，对每条事件都记录两边的 disposition
- 比对日志找出差异
- 差异为零后再把旧路径删掉

不走"先合并再慢慢调 bug"的路线。一旦旧路径被删，后续任何行为回归都没有参考系。

## Phase 4: 升级后台窗口方案

目标：

- 浏览器层和系统层职责彻底分开
- 过渡到“真实后台页 + 系统级完全隐藏”

完成标准：

- 后台窗口方案不再依赖最小化思路
- Native Messaging + Win32 `ShowWindow` 成为正式主路径

## Phase 5: 接入高级算法

目标：

- 链路上下文
- AI 关键词信号
- 页面组权重
- 统一权重归一化

完成标准：

- 高级算法作为新信号层插入，而不是破坏原有主链

---

## 3. 当前执行顺序

当前按下面这个顺序推进：

1. 同步文档口径
2. 收口 `service-worker -> router` 主程序入口
3. 拆 `intercept / judge / actions / learning` 主链
4. 拆 Rust `query` 层
5. 继续拆 Rust `db/index` 层
6. 再拆出 Rust `filter/scoring` 层
7. 再清理 JS 预测链

---

## 4. 近期修复记录

- 2026-04-18 第一轮稳定性修复：
  - 本地 app 接口引入扩展 origin 注册与授权。
  - source-lock 增加 TTL 和 commit 消费逻辑。
  - hidden-tab 激活顺序改成先记 tracking 再 move tab。
  - 长任务移出全局 mutation queue，改走 side-effect queue。
  - 候选扫描和页面摘要上报解耦，摘要链增加指纹去重。
  - 候选池按 URL 合并更强语义，不再保留第一次出现。
  - Wasm 引擎首次加载失败后增加冷却重试。

- 2026-04-18 第二轮稳定性修复：
  - 本地 app 改成动态 CORS，只对注册中的扩展 origin 返回允许头。
  - preload window 复用从“必须恰好一个候选窗口”改成“选最佳候选窗口”，并加入按 normalWindowId 去重的 in-flight ensure promise。
  - hidden-tab 点击时若目标仍在 loading，会立即丢弃对应后台 entry/tab，避免双重加载长期残留。
  - 系统级窗口隐藏进一步落到 `WS_EX_TOOLWINDOW + SW_HIDE`，watchdog/bounds 变化时会按 `hwnd` 或实际 bounds 重新隐藏。
  - 频数乘区的参考分布改成代码内显式样本集 `L={1,2,3,5,8,13,21,34,55,89}` 推导，不再只靠硬编码均值和标准差。

- 2026-04-18 Ordering 规则切换：
  - `Ordering` 中的筛选对象从“频数”改成“权重”。
  - 旧配置 `highFrequencyRank / frequencyRange` 会自动迁移到 `highWeightRank / weightRange`。
  - JS fallback 与 Wasm filter 都改成按 `candidate.score` 执行筛选和排名。
8. 最后整体切换后台窗口方案

这个顺序的原因是：

- 先稳主程序入口和消息链
- 再稳 tracking / learning / preload 的模块边界
- 再稳数据边界
- 再做更强预测
- 最后替换后台窗口主实现

---

## 4. 本轮已开始的事项

本轮已经开始：

- 文档同步
- Rust 计算核第一步拆分
- Rust `query` 层已从 `lib.rs` 抽离
- Rust `db/index` 层已开始从 `lib.rs` 抽离
- Rust `events/ingestion` 层已从 `lib.rs` 抽离
- `lib.rs` 已进一步收缩为 FFI、类型与顶层分发中心
- wasm 计算核的 `lib.rs` 已继续拆成：
  - `ffi`
  - `responses`
- `model` 层已从 `lib.rs` 抽离
- 当前 Wasm 分层已形成：`lib / model / db / events / query`
- 当前 `extansion/wasm/visit-graph-engine/src/lib.rs` 已进一步退化成 FFI 入口与顶层分发边界，不再继续承载内存桥和响应包装样板实现
- `scoring` 层骨架已建立，用于后续权重组合与 `1 / (0.7n)` 次方归一化
- `scoring` 已接入当前候选筛选主链，当前先作为“base score -> normalized score”的统一出口
- 当前 `scoring` 仍保持现有行为基本不变，后续再往这个边界里接时间权重、链路权重、关键词权重与页面组权重
- JS 侧预加载打分出口已从 `prediction` 主链拆到独立 `preload/scoring.js`
- 候选打分已改成批量调用 Wasm `scoring`，避免每个候选单独跨一次 FFI
- 当前开始补统一 `support + enable` 边界：先判 capability，再决定功能是否实际生效
- JS 侧规则链也已从 `prediction` 主链拆到独立 `preload/rules.js`
- 规则链判断已开始走 Wasm filter 边界，当前为“Wasm 优先，JS 回退”
- wasm 计算核的 `filter.rs` 已继续拆成：
  - `filter/model`
  - `filter/rules`
  - `filter/sort`
- 最终候选优先级排序也已从 `prediction` 主链收进 `rules/filter` 边界
- `maxTargets` 截断也已收进 `rules/filter` 边界
- 页级跳转计数/消息索引已开始进入 Rust `db/index`
- 候选跳转统计已开始走 Rust 批量 query 边界，`prediction` 不再直接依赖 JS 页级桶做这一步
- 原始消息层与频数层的时间口径已明确改为“按 UTC 日期分组”
- 固定窗口值（`1d / 7d / 30d / 365d`）后续改为查询阶段按日期组动态求和，不再长期维护多套窗口桶
- 时间衰减权重继续后置，当前先只依赖时间窗口筛选
- 当前已开始替换旧固定窗口桶：Rust / JS 图结构改为 `total + byDay`
- 原始消息层已新增按 UTC 日期分组索引，用于后续窗口查询与老化检查
- 现有 `windowKey` 对外接口保留不变，但内部实现已开始切到“按日期组动态求和”
- 设置页已新增 AI 预测辅助占位项：模型选择 + 启用开关
- 设置页已新增模型管理占位项：模型选择 + 下载状态开关
- 当前模型列表已收进共享设置层：Qwen3 `0.6B / 1.7B / 4B`，Gemma 4 `E2B / E4B`
- 时间窗口中的 `total` 全量窗口继续保留，不会被 `365d` 替代
- AI runtime 口径已改成“本地 app 目录内的便携 runtime + 本地模型目录”
- AI 模型管理当前开始从“设置占位”推进到“本地 app 真实下载 / 删除 / 检测”
- 当前目标运行时固定为 `ollama-runtime`
- 本地 app 已新增 AI 状态 / 安装 / 删除 / 通用推理 API 端点
- 扩展侧已新增 `ai-models:get-status` / `ai-models:set-installed` 后台消息链
- 设置页 `Manage model` 已开始走真实本地 app 状态，而不是纯本地占位布尔值
- AI 关键词库口径已明确改成“页级数据库 + 页级索引层”
- 最近上下文口径已明确改成“只统计真实进入前台的页面”
- AI 关键词乘区当前已固定初始区间：
  - 无命中 `1.0`
  - 弱命中 `2.2`
  - 中命中 `3.6`
  - 强命中 `5.4`
- 第一阶段关键词匹配已固定口径：
  - AI 先生成“近期兴趣关键词”
  - AI 输入先固定为：历史页面信息池 + 当前窗口已有标签页 + 当前活动页面
  - 目标页关键词也是 AI 为已访问目标页生成并入库的页级语义材料
  - 实际匹配对象是：`interestKeywords -> (linkInfo + targetPageKeywords)`
  - 被匹配池先由页面内链接信息构成，再按目标页是否有历史关键词补充目标页语义
  - AI 推理与“链接扫描 + 目标页关键词补全”并行进行
  - AI 匹配环节与其他预测环节也并行推进，不作为整条预测链的同步阻塞点
  - 关键词乘区作为异步可补入乘区，算好后直接挂到总权重上
  - 历史页面信息池当前固定为三个并行数组：`titles / urls / texts`，长度先定为 `5`
  - 只通过强乘区并入现有总分
  - 不额外新增关键词命中优先级排序层
  - 频数后续再单独调公式
- 第一阶段关键词匹配当前已开始真实落地：
  - 图结构已新增历史页面信息池三数组
  - 页级关键词库已新增批量查询出口
  - 候选链接采集已补充 `anchorText / nearbyText / titleAttr / ariaLabel / imageAlt / hrefPathTokens`
  - `candidateSemanticBundle` 已开始由 `linkInfo + targetPageKeywords` 组成
  - AI 近期兴趣关键词推理已开始与候选池构造并行推进
  - 关键词乘区已开始作为异步补入乘区挂进现有总权重链
  - debug snapshot 已开始暴露历史页面信息池和当前 preload 条目的 AI 关键词命中结果，方便测试期观察
- AI prompt 组装边界已收回扩展 JS；本地 app 只保留 runtime / model 管理和通用模型调用
- 本地 app AI 推理接口已收成统一 `infer` 出口，页面关键词 prompt 已开始由扩展侧独立组装
- 站外导航频数系统下一步已明确重构为“双层排序”：
  - 先按站点频数 + 站点 AI 匹配算 `siteWeight`
  - 先按执行策略拆成原生预加载组和真实标签页组
  - 再在各组内分别按 `siteWeight` 做站点上限截断
  - 再只在各组各自的已选站点里分配子页面预加载槽位
  - 最后站点内部再按“外站 -> 子页面”频数 + 子页面 AI 匹配抢槽位
- 站点槽位分配后续不再使用旧 `flag` 方案，而是直接检测当前页面里该站点实际有多少个可导航子页面，作为 `cap`
- 站点选择上限和各组页面槽位上限后续分开维护，不再混成一个值
- 站点槽位分配的设计说明与算法代码已拆成两份文件维护，不再混在一个文档里
- 站外导航双层频数系统的实现边界已单独收成：
  - `站外导航双层频数落地方案.md`
  - 后续按“先扩 query 字段，再加站点层，再接分槽，再切正式输出”的顺序推进
- 页面端点击导航链已开始收口：
  - 新增 `background/navigation/manager.js`
  - content script 不再直接碰 tracking/preload 激活高层消息
  - 第一轮目标是把点击导航的高层编排先从 `navigation-interceptor.js` 挪到后台主管模块
- preload runtime 主管入口已开始成形：
  - 新增 `background/preload/runtime/manager.js`
  - preload 注册、激活、watchdog 维护、runtime settings 维护已开始统一走这个主管入口
- 第一阶段已开始落地：
  - Rust / JS 候选频数查询已扩成三套字段：
    - `siteTransitionCount`
    - `outboundPageTransitionCount`
    - `intraSitePageTransitionCount`
  - 当前只是把数据边界收正，尚未切正式排序逻辑
- 第二阶段和第三阶段已开始落地：
  - 站点选择上限已拆成两套共享设置：
    - `siteSelectionLimit`
    - `tabSiteSelectionLimit`
  - 页面槽位上限也已拆成两套共享设置：
    - `nativePerPagePreloadLimit`
    - `perPagePreloadLimit`
  - Ordering 中的规则已重新映射：
    - `highWeightRank` -> 原生预加载组的站点选择上限
    - `highWeightRankTab` -> 真实标签页预加载组的站点选择上限
  - Preload 区规则已重新映射：
    - `nativePerPagePreloadLimit` -> 原生预加载组的页面槽位上限 `a_native`
    - `perPagePreloadLimit` -> 真实标签页预加载组的页面槽位上限 `a_tab`
  - cross-site 候选已新增独立站点层模块：
    - `background/preload/prediction/site-selection.js`
  - 当前页的 cross-site 候选现在会先：
    - 判定执行策略
    - 拆成原生预加载组和真实标签页组
    - 组内按站点聚类
    - 计算 `cap`
    - 计算 `siteWeight`
    - 分别经过各组自己的站点上限截断
    - 用分槽算法给各组已选站点分配各自的页面槽位
    - 再由站内子页面按现有页级权重抢位
  - same-origin / 站内候选暂时保持原有单层页级路径
  - strategy router 目前已接上这条 cross-site 站点层，当前标签页硬替换开启时也会把对应跨站当前页候选归入真实标签页组
  - 页级频数乘区语义已收正：
    - cross-site 页面只吃 `outboundPageTransitionCount`
    - same-origin 页面只吃 `intraSitePageTransitionCount`
    - 不再让页级频数乘区直接吃一个模糊的 `pageTransitionCount`
  - 站点层选择信息已开始沿 runtime 链传递到 preload entry / popup `Top`
    - 当前可以直接看到 `siteWeight`
    - 当前可以直接看到分到的页面槽位和站点排名
- 原有“默认子页面继承站点值”机制已判定为过渡方案，后续应整体删除
- `service-worker` 已开始收成“主程序 + 分发器”结构，浏览器事件统一先进 router，再下发到 tracking / preload / learning 模块
- 学习链已开始单独模块化，前台页面摘要与关键词写回不再直接堆在主入口里
- 当前统一设计口径已固定为：
  - 所有事件先进入主程序
  - 主程序先标准化消息
  - 再进入判断链
  - 判断链返回 disposition
  - 动作模块统一执行
- runtime message 主链已开始正式切到：
  - `intercept/messages`
  - `judge/messages`
  - `actions/messages`
  这条新路径
- 当前已经不再由 `router` 直接对 runtime message 做巨型 `switch`
- `core/router` 已继续拆成：
  - `core/router/messages`
  - `core/router/navigation`
  - `core/router/runtime`
- 当前 `background/core/router.js` 已进一步退化成主程序类壳，不再继续承载 message、navigation 和 runtime 三条调度主链的具体实现
- browser event 主链也已开始正式切到：
  - `intercept/navigation`
  - `judge/navigation`
  - `actions/navigation`
  这条新路径
- 当前 tracking / preload 相关的导航事件、tab 事件、window 事件、alarm 已先迁到这条链
- runtime lifecycle 主链也已开始正式切到：
  - `intercept/runtime`
  - `judge/runtime`
  - `actions/runtime`
  这条新路径
- 当前 `bootstrap / installed / startup / storage-changed -> apply runtime settings`
  已先迁到这条链
- learning 层已继续拆成：
  - `learning/link-behavior`
  - `learning/foreground-pages`
  - `learning/index`
- 当前 `remember-source-page`、`record-link-behavior`、`foreground-page-digest`
  已通过 learning 入口统一调度
- preload/runtime 已继续拆成：
  - `runtime/candidate-registration`
  - `runtime/source-tabs`
  - `runtime/window-manager`
  - `runtime/window-policy`
  - `runtime/lifecycle`
  - `runtime/activation`
- 当前 `sync.js` 与 `windows.js` 已退化成薄的导入边界，不再继续承载具体实现
- preload/runtime/window-manager 已继续拆成：
  - `runtime/window-manager/creation`
  - `runtime/window-manager/hiding`
  - `runtime/window-manager/priming`
- 当前 `runtime/window-manager.js` 已成为 preload window 子系统统一导出边界：
  - watchdog、source-tabs 和 window lifecycle 事件已开始统一走这里
- `runtime/window-manager/creation.js`
  - 负责窗口 ensure / 复用 / HWND 探测
- `runtime/window-manager/hiding.js`
  - 负责系统隐藏和 minimize fallback
- `runtime/lifecycle/windows.js`
  - 负责窗口事件实现，但入口已收回到 `runtime/window-manager.js`
- preload/runtime/window-policy 已继续拆成：
  - `runtime/policy/cleanup`
  - `runtime/policy/repair`
  - `runtime/policy/watchdog`
- 当前 `runtime/window-policy.js` 已退化成后台窗口策略层统一导出边界，不再继续承载 cleanup、repair 和 watchdog 全部实现
- preload/runtime/lifecycle 已继续拆成：
  - `runtime/lifecycle/candidates`
  - `runtime/lifecycle/tabs`
  - `runtime/lifecycle/windows`
  - `runtime/lifecycle/reset`
- 当前 `runtime/lifecycle.js` 已退化成生命周期层统一导出边界，不再继续承载候选刷新、tab/window 生命周期和 reset 全部实现
- preload/runtime/activation 已继续拆成：
  - `runtime/activation/flow`
  - `runtime/activation/tracking`
- 当前 `runtime/activation.js` 已退化成激活层统一导出边界，不再继续承载预加载页激活流程和激活后的 tracking 写回全部实现
- preload/runtime/source-tabs 已继续拆成：
  - `runtime/source-tabs/ownership`
  - `runtime/source-tabs/hidden-tabs`
  - `runtime/source-tabs/speculation`
- 当前 `runtime/source-tabs.js` 已退化成 source tab 运行时同步层统一导出边界，不再继续承载 ownership、hidden-tab 和 speculation 全部实现
- preload/prediction 已继续拆成：
  - `prediction/metrics`
  - `prediction/candidate-pool`
  - `prediction/strategy-router`
- 当前 `preload/prediction.js` 已退化成预测编排层统一导出边界，不再继续承载候选池、metrics enrich 和策略分流全部实现
- preload/state 已继续拆成：
  - `state/model`
  - `state/normalize`
  - `state/lookup`
  - `state/view`
- 当前 `preload/state.js` 已退化成状态层统一导出边界，不再继续承载全部实现
- `preload/state/normalize` 已继续拆成：
  - `state/normalize/entries`
  - `state/normalize/runtime`
  - `state/normalize/legacy`
- 当前 `preload/state/normalize.js` 已退化成预加载状态归一化层统一导出边界，不再继续承载 entry、runtime 和 legacy 迁移全部实现
- preload/state/lookup 已继续拆成：
  - `state/lookup/normal-windows`
  - `state/lookup/source-tabs`
  - `state/lookup/membership`
  - `state/lookup/pruning`
- 当前 `preload/state/lookup.js` 已退化成 lookup 层统一导出边界，不再继续承载 normal window、source tab、成员关系和裁剪全部实现
- tracking/graph/model 已继续拆成：
  - `graph/model/schema`
  - `graph/model/normalize`
  - `graph/model/edge-stats`
- 当前 `tracking/graph/model.js` 已退化成图模型统一导出边界，不再继续承载全部实现
- tracking/graph/model/normalize 已继续拆成：
  - `graph/model/normalize/learning`
  - `graph/model/normalize/messages`
  - `graph/model/normalize/startup`
  - `graph/model/normalize/graph`
- 当前 `tracking/graph/model/normalize.js` 已退化成归一化层统一导出边界，不再继续承载全部 graph、消息、学习和启动补偿实现
- tracking/graph/events 已继续拆成：
  - `graph/events/current-page`
  - `graph/events/transitions`
  - `graph/events/learning`
  - `graph/events/tabs`
- 当前 `tracking/graph/events.js` 已退化成图事件分发层统一导出边界，不再继续承载 current page、transition、learning 和 tab 生命周期全部实现
- tracking/engine 已继续拆成：
  - `engine/wasm`
  - `engine/query-fallback`
  - `engine/api`
- 当前 `tracking/engine.js` 已退化成 tracking 引擎统一导出边界，不再继续承载全部实现
- tracking/engine/wasm 已继续拆成：
  - `engine/wasm/io`
  - `engine/wasm/bridge`
  - `engine/wasm/load`
- 当前 `tracking/engine/wasm.js` 已退化成 Wasm 引擎层统一导出边界，不再继续承载加载、内存编解码和调用桥全部实现
- `tracking/engine/query-fallback` 已继续拆成：
  - `engine/query-fallback/transitions`
  - `engine/query-fallback/learning`
- 当前 `tracking/engine/query-fallback.js` 已退化成 fallback 查询层统一导出边界，不再继续承载 transition 和 learning 全部查询实现
- tracking/graph/indexes 已继续拆成：
  - `graph/indexes/link-behavior`
  - `graph/indexes/keywords`
  - `graph/indexes/transitions`
- 当前 `tracking/graph/indexes.js` 已退化成图索引统一导出边界，不再继续承载全部实现
- tracking/graph/indexes/transitions 已继续拆成：
  - `graph/indexes/transitions/buckets`
  - `graph/indexes/transitions/query`
  - `graph/indexes/transitions/messages`
- 当前 `tracking/graph/indexes/transitions.js` 已退化成跳转索引统一导出边界，不再继续承载 bucket、窗口查询和消息索引全部实现
- `tracking/graph/indexes/transitions/query` 已继续拆成：
  - `graph/indexes/transitions/query/window`
  - `graph/indexes/transitions/query/source`
  - `graph/indexes/transitions/query/pages`
- 当前 `tracking/graph/indexes/transitions/query.js` 已退化成跳转查询层统一导出边界，不再继续承载时间窗口查询、source 视图和页级读取全部实现
- core/state 已继续拆成：
  - `core/state/config`
  - `core/state/storage`
  - `core/state/container`
  - `core/state/bindings`
- 当前 `core/state.js` 已退化成后台状态容器层统一导出边界，不再继续承载状态容器类和全局绑定全部实现
- core/state/storage 已继续拆成：
  - `core/state/storage/normalize`
  - `core/state/storage/tracking`
  - `core/state/storage/preload`
  - `core/state/storage/bootstrap`
- 当前 `core/state/storage.js` 已退化成状态存储层统一导出边界，不再继续承载 tracking/preload 读写、启动初始化和 map 归一化全部实现
- core/messages 已继续拆成：
  - `core/messages/debug`
  - `core/messages/settings`
  - `core/messages/ai-models`
- 当前 `core/messages.js` 已退化成后台消息域统一导出边界，不再继续承载 debug、settings 和 AI 模型管理全部实现
- 本地 app 的 `model.rs` 已继续拆成：
  - `model/catalog`
  - `model/types`
  - `model/runtime`
  - `model/status`
  - `model/infer`
- 当前 `app/src/model.rs` 已退化成便携模型能力的统一导出边界，不再继续承载模型清单、请求响应类型、runtime、状态和推理实现细节
- 本地 app 的 `api.rs` 已继续拆成：
  - `api/routes/system`
  - `api/routes/ai`
  - `api/routes/windows`
- 当前 `app/src/api.rs` 已退化成 HTTP 服务入口与路由装配边界，不再继续承载各路由域的具体处理实现
- 本地 app 的 `model/runtime.rs` 已继续拆成：
  - `model/runtime/paths`
  - `model/runtime/install`
  - `model/runtime/process`
- 当前 `app/src/model/runtime.rs` 已退化成便携模型运行时层统一导出边界，不再继续承载路径、安装和进程控制全部实现
- 本地 app 的 `model/status.rs` 已继续拆成：
  - `model/status/runtime`
  - `model/status/models`
- 当前 `app/src/model/status.rs` 已退化成便携模型状态汇总层统一导出边界，不再继续承载 runtime 状态和模型状态全部实现
- wasm 计算核的 `db.rs` 已继续拆成：
  - `db/buckets`
  - `db/learning`
  - `db/normalize`
- 当前 `extansion/wasm/visit-graph-engine/src/db.rs` 已退化成数据库层统一导出边界和剩余核心落库链，不再继续承载全部 bucket、学习、归一化实现
- `wasm db/buckets` 已继续拆成：
  - `db/buckets/transitions`
  - `db/buckets/pages`
- 当前 `extansion/wasm/visit-graph-engine/src/db/buckets.rs` 已退化成 bucket 公共 helper 与统一导出边界，不再继续承载站点/页级全部 bucket 读写实现
- `wasm db/normalize` 已继续拆成：
  - `db/normalize/graph`
  - `db/normalize/reconcile`
- 当前 `extansion/wasm/visit-graph-engine/src/db/normalize.rs` 已退化成归一化层统一导出边界，不再继续承载 graph normalize、消息整理和启动补偿全部实现
- wasm 计算核的 `model.rs` 已继续拆成：
  - `model/graph`
  - `model/learning`
  - `model/engine`
- 当前 `extansion/wasm/visit-graph-engine/src/model.rs` 已退化成数据模型层统一导出边界，不再继续承载 graph、学习结构和引擎事件/查询全部实现
- wasm 计算核的 `events.rs` 已继续拆成：
  - `events/current_page`
  - `events/transitions`
  - `events/learning`
  - `events/tabs`
- 当前 `extansion/wasm/visit-graph-engine/src/events.rs` 已退化成事件分发层统一导出边界，不再继续承载 current page、transition、learning 和 tab 生命周期全部实现
- wasm 计算核的 `query.rs` 已继续拆成：
  - `query/transitions`
  - `query/learning`
- 当前 `extansion/wasm/visit-graph-engine/src/query.rs` 已退化成查询路由层统一导出边界，不再继续承载 transition 和 learning 全部查询实现
- 当前 `extansion/wasm/visit-graph-engine/src/filter.rs` 已退化成筛选边界统一导出层，不再继续承载输入模型、规则判断和排序比较全部实现
- 本地 app 的 `telemetry.rs` 已继续拆成：
  - `telemetry/hardware`
  - `telemetry/performance`
- 本地 app 的 `telemetry/mod.rs` 已继续拆成：
  - `telemetry/types`
  - `telemetry/utils`
- 当前 `app/src/telemetry/mod.rs` 已退化成遥测层统一导出边界，不再继续承载硬件/性能采集、类型定义和工具函数全部实现
- 浏览器事件链后续再按同样方式继续迁移
- 下一阶段的重点不是继续堆功能，而是把：
  - `intercept`
  - `judge`
  - `actions`
  三层真正落成独立目录和模块
- 后续所有新增逻辑都应优先挂到统一事件主链上，而不是绕过主程序直接互调

Phase 4 后台窗口方案已开始推进：

- 本地 Rust 应用已新增 Win32 窗口管理模块 `window.rs`
- 本地 app 的 `window.rs` 已继续拆成：
  - `window/manager`
  - `window/enumerate`
  - `window/actions`
- 当前 `app/src/window.rs` 已退化成窗口层统一导出边界，不再继续承载窗口维护、枚举与窗口动作全部实现
- 当前 `app/src/window/manager.rs` 已成为隐藏窗口 registry / monitor / request-level policy 的显式维护边界
- 当前 `app/src/window/actions.rs` 已退化成 Win32 动作层，不再继续承载高层隐藏窗口维护语义
- 本地 app 的 `lifecycle.rs` 已继续拆成：
  - `lifecycle/chrome`
  - `lifecycle/host`
  - `lifecycle/watcher`
- 当前 `app/src/lifecycle.rs` 已退化成生命周期统一导出边界，不再继续承载 Chrome 探测、host 单实例、扩展安装检测和 shutdown monitor 全部实现
- 当前 `app/src/lifecycle/host.rs` 承担 host 单实例、扩展安装检测和扩展卸载关闭监控；不负责补拉任何离散进程
- 当前 `app/src/lifecycle/watcher.rs` 仅保留历史 Windows Run watcher 清理和旧 `--watcher` 参数兼容
- 本轮稳定性修复已开始落地：
  - 本地 app API 已新增“注册并锁定当前扩展 origin”的授权边界，不再接受任意扩展直接控制
  - runtime message 已新增 `side-effect` 队列，AI 推理、模型管理、候选注册和页面摘要链不再阻塞主 mutation queue
  - source-lock 已新增 TTL，并在导航 commit 时统一消费，不再无限残留
  - hidden-tab 激活链已改成“先写 tracking，再移动 tab”
  - Wasm 引擎首次加载失败后已支持冷却后重试，不再整轮 worker 生命周期永久退回 JS fallback
  - 候选池按 URL 的去重已改成“合并语义更强的重复链接”，不再只保留第一次出现
  - 页面摘要上报已从候选扫描链解耦，并增加指纹去重，减少动态页面上的重复 tracking 写入
  - `1d` 时间窗口口径已明确固定为“当前 UTC 当天”，不再按滚动 24 小时理解
- 新增 API 端点：`GET /api/v1/windows/chrome`、`POST /api/v1/windows/hide`、`POST /api/v1/windows/show`
- Win32 层使用 `EnumWindows` + `Chrome_WidgetWin_1` 类名匹配 + `ShowWindow(SW_HIDE/SW_SHOWNA)` 实现系统级完全隐藏
- 扩展侧新增 `background/shared/native-app.js` 作为本地应用 HTTP 客户端
- `support.js` 新增平台检测 `detectPlatformSupport()` 和本地应用可用性探测 `probeNativeAppAvailability()`
- 扩展侧的 `background/shared/support.js` 已继续拆成：
  - `shared/support/platform`
  - `shared/support/features`
  - `shared/support/usability`
- 当前 `background/shared/support.js` 已退化成功能支持层统一导出边界，不再继续承载平台识别、feature support 和 usability 探测全部实现
- 扩展侧的 `background/shared/native-app.js` 已继续拆成：
  - `shared/native-app/request`
  - `shared/native-app/health`
  - `shared/native-app/ai`
  - `shared/native-app/windows`
- 当前 `background/shared/native-app.js` 已退化成本地 app 客户端统一导出边界，不再继续承载请求、健康检查、AI 和窗口操作全部实现
- 设置层新增 `preloadWindow.systemLevelHiding.support` 和 `usable` 字段，用于降级判断
- 预加载状态层新增 `preloadWindow.hwnd` 和 `preloadWindow.hiddenBySystem` 字段
- `ensurePreloadWindow` 已支持双路径：系统级隐藏优先，最小化回退
- 创建后台窗口时，如果本地应用可用：先以 `state: "normal"` + 屏幕外坐标创建，再由本地应用 `ShowWindow(SW_HIDE)` 完全隐藏
- 如果本地应用不可用或隐藏失败：降级到原有 `state: "minimized"` 路径
- `enforcePreloadWindowPolicy` 和 `handlePreloadWindowBoundsChanged` 已识别 `hiddenBySystem` 标志，跳过冗余最小化修复
- 设置页新增 Native App 状态卡片，展示连接状态和系统级隐藏是否激活
- 服务工作线程启动时自动探测本地应用可用性
- 本地应用 Cargo.toml 已添加 `windows` crate (Win32 API) 和 `serde_json` 依赖
- 已添加 `.cargo/config.toml` 指定无空格的 target-dir 解决构建路径问题

本轮不做：

- 一次性接入高级 AI 算法
- 一次性把所有旧 JS fallback 层彻底删除
- 在没有主程序统一判断链之前继续新增分散逻辑入口

---

## 5. 本地记录原则

后续推进时，本地文档按下面分工维护：

- `Algorithm-Design-Workflow-v0.md`
  负责记录真实工作流程和算法层设计
- `Runtime-Window-Model.md`
  负责记录后台窗口与运行时对象结构
- `Preload-Tracking-Logic.md`
  负责记录 tracking 与 preload 的交界规则
- `Implementation-Roadmap-v0.md`
  负责记录推进顺序和当前阶段

后面新增补充时，优先改已有文档，不再平行开太多重复说明文件。

## 6. Claude / Codex 协作口径

后续如果 Claude 和 Codex 同时参与设计或落地，当前应统一遵守以下口径：

- 算法与工作流程口径以：
  - `Algorithm-Design-Workflow-v0.md`
  为准
- 推进顺序与当前阶段口径以：
  - `Implementation-Roadmap-v0.md`
  为准
- tracking 与 preload 的交界规则以：
  - `Preload-Tracking-Logic.md`
  为准

协作时优先修改这些既有文档，不再额外平行写新的”临时说明稿”。

## 7. Phase 5 之前需要清掉的三条基础风险

Phase 5 高级算法接入前，应优先清理三类基础层面的遗留问题，不属于功能增量，但会直接影响后续验证结论的可信度：

1. 权重归一化公式
   - 纯 `1 / n` 次方在多信号一致时没有增强效果
   - 当前已先调成 `1 / (0.7n)`，减弱归一化强度
   - 详见 `Algorithm-Design-Workflow-v0.md` §5.14.1
   - 后续仍需结合真实点击测试继续调参

2. 便携 ollama-runtime 的真实边界
   - 环境变量、端口、进程生命周期都必须由本地 app 接管
   - 任何一环落回系统默认路径，便携性就不成立
   - 详见 `Algorithm-Design-Workflow-v0.md` §5.9.1

3. 后台窗口定位与持续隐藏
   - HWND 匹配改成 title-based 精确匹配
   - `SW_HIDE` 改成维持策略而不是一次性调用
   - 详见 `Runtime-Window-Model.md` 新增两节

其他调整都是增量优化，可以在迭代中边跑边调。

---

## 8. 最近一次算法口径调整

- 预加载候选的基础权重已改成固定 `1`
- 跳转频数不再直接写入基础分
- 跳转频数当前只通过频数乘区进入总权重
- 频数乘区公式固定为：
  - 当 `x <= 0` 时：`y = 1`
  - 当 `x > 0` 时：
    - `y = 1 + 2 / (1 + exp(-((ln(x) - Mean(M)) / SD(M))))`
  - 当前样本集合固定为：
    - `L = {1,2,3,5,8,13,21,34,55,89}`

---

## 9. 最近一次运行时修复

- preload 后台窗口现在改成“建立后常驻复用”，不会再因为临时没有 hidden-tab 条目就被 watchdog 立刻关闭
- 当前标签页跨站替换不再依赖候选注册回包的本地 flag，点击时会直接尝试后台替换
- 如果目标 hidden-tab 还在排队或加载，会先给一小段等待时间，再决定是否 fallback 到普通导航
- 当前标签页跨站替换不会在点击时现建 hidden-tab；只有目标已经提前进入后台加载链时，才尝试等待并替换
- preload window 关闭或被移除时，现在会一起清掉 `windowId / hwnd / hiddenBySystem`，避免 stale `hwnd` 被下一次系统隐藏链误复用
- preload window 预热常驻策略已临时关闭；没有真实 hidden-tab 工作时，不再无条件保温一个后台 Chrome 窗口
- preload window 创建路径现在先以 `minimized` 起步，再尝试系统级隐藏，减少“先 normal visible 再异步 hide”导致的闪烁
- 本地 app 现在会持续监视已登记的 hidden Chrome `hwnd`，只要 Chrome 自己把窗口重新 show 出来，就会再次 `SW_HIDE`
- `a` 现在只由站点层页面分槽阶段消费；后续规则链只做筛选/排序，不再对最终页面集合按 `a` 再切第二刀
- 同页同 URL 的多个链接实例不再因为“其中一个是 `_blank`”就整体升级成 `_blank`；候选会优先继承更强可见性/语义实例的打开方式
