# Codex 主管模块架构方案 v0

## 1. 目标

这份文档只回答一个问题：

- 在当前逻辑已经很复杂的前提下，怎样允许少数“大主管模块”存在，同时避免继续长成屎山。

原则是：

- 主程序只负责在正确时机调用主管模块
- 主管模块可以偏大
- 中层模块负责同一子系统内的协调
- 底层模块只做纯函数、查询、结构转换、平台调用

这里统一使用：

- `A / AA / AAA`

这种层级表示法来固定边界。

---

## A. 扩展侧

### AA. 指定入口

#### AAA. 扩展主程序入口

- `extansion/service-worker.js`

职责：

- 装配全部后台模块
- 绑定 Chrome 事件
- 创建全局状态容器
- 把事件送进统一主程序链

它不应该继续承载：

- preload 策略判断
- tracking 业务判断
- 页面端导航接管细节

#### AAB. 扩展后台维护入口

- `extansion/background/preload/runtime/policy/watchdog.js`

职责：

- 周期性维护 preload runtime
- 触发 repair / cleanup / hidden-state keepalive
- 作为 preload runtime 维护入口

它不应该直接变成：

- preload 运行时的全量实现文件

维护入口和维护子模块应继续分离。

---

### AB. 主程序调度层

#### ABA. 统一主程序链

- `background/core/router.js`
- `background/core/router/messages.js`
- `background/core/router/navigation.js`
- `background/core/router/runtime.js`

职责：

- 统一收入口
- 调用 `intercept / judge / actions`
- 只做调度，不堆业务判断

#### ABB. 主程序消息域

- `background/core/messages.js`
- `background/core/messages/*`

职责：

- 调试快照
- 设置同步
- AI 模型状态消息

这是主程序周边的消息子系统，不是新的全局入口。

---

### AC. NavigationManager

建议定位为：

- 扩展侧导航主管模块

当前实际文件群：

- `extansion/background/navigation/manager.js`
- `extansion/scripts/navigation-interceptor.js`
- `background/intercept/navigation.js`
- `background/judge/navigation.js`
- `background/actions/navigation.js`
- `background/tracking/index.js`（其中与导航意图/浏览器导航桥接相关的部分）

#### ACA. 当前问题

`navigation-interceptor.js` 现在承担了太多高层逻辑：

- 点击拦截
- source 锁定
- 链接行为学习触发
- preload 激活尝试
- 候选扫描
- 页面摘要上报
- speculation rules 注入

这说明页面端边缘层已经膨胀成半个主管模块。

#### ACB. 建议方案

后续应收成一个显式主管层，例如：

- `background/navigation/manager.js`

职责：

- 汇合页面端意图与浏览器导航事件
- 管当前标签页替换资格
- 管 `_self / _blank` 行为决策
- 管 source-lock 的高层语义

而 `navigation-interceptor.js` 应逐步缩成：

- DOM 读取
- 事件捕获
- 发消息

#### ACC. 当前已完成的第一步

当前点击导航主链已经开始真实收口：

- 页面端不再直接调用：
  - `tracking:remember-source-page`
  - `tracking:record-link-behavior`
  - `preload:activate-if-ready`
- 这些高层动作已经先统一收进：
  - `background/navigation/manager.js`

当前页面端仍然保留：

- Google 搜索内部模式切换的本地短路
- 是否需要预先 `preventDefault`
- `_blank` 预留空白窗口的保底执行

这是当前阶段允许保留的页面端边缘逻辑，后续如果继续收口，优先从这里下刀。

当前进一步收口后，页面端已经不再自己判断：

- `same-origin / cross-site`
- 是否应该交给后台导航主管处理

这两条现在已经统一交给：

- `background/navigation/manager.js`

所以 content script 的点击链已经更接近：

- 捕获事件
- 少量边缘特判
- 预先阻止默认行为
- 请求后台给出执行方案
- 执行返回方案

当前页面端剩余的点击处理也已经继续收成几个显式 edge helper：

- click handling plan
- background resolution request
- browser fallback execution

所以后续如果还要继续收口，优先判断的是：

- 这些 edge helper 是否还能再减

而不是重新把高层业务判断塞回 content script。

---

### AD. TrackingManager

当前实际文件群：

- `background/tracking/index.js`
- `background/tracking/engine.js`
- `background/tracking/view.js`
- `background/tracking/graph/*`
- `background/tracking/engine/*`

#### ADA. 建议定位

这是扩展侧 tracking 主管模块及其下游数据层。

职责：

- 当前页状态维护
- 真实跳转入图
- link behavior 学习入图
- transition metrics 查询
- 对 Wasm / JS fallback 的统一业务出口

#### ADB. 分层建议

- 主管层：
  - `tracking/index.js`
  - 后续可显式提升为 `tracking/manager.js`
- 中层：
  - `tracking/engine.js`
  - `tracking/view.js`
- 底层：
  - `tracking/graph/*`
  - `tracking/engine/query-fallback/*`
  - `tracking/engine/wasm/*`

当前这层大方向是对的，不建议再大拆。

---

### AE. PredictionPlanner

当前实际文件群：

- `background/preload/prediction.js`
- `background/preload/prediction/strategy-router.js`
- `background/preload/prediction/candidate-pool.js`
- `background/preload/prediction/metrics.js`
- `background/preload/prediction/site-selection.js`
- `background/preload/scoring.js`
- `background/preload/rules.js`

#### AEA. 建议定位

这是扩展侧预测主管模块。

职责：

- 候选池构造
- 站点聚类
- 站点权重与站点选择
- 站点槽位分配
- 页级权重计算
- 最终 preload plan 生成

#### AEB. 分层建议

- 主管层：
  - `prediction/strategy-router.js`
- 中层：
  - `candidate-pool.js`
  - `metrics.js`
  - `site-selection.js`
  - `rules.js`
  - `scoring.js`
- 底层：
  - strategy 子模块

`strategy-router.js` 当前作为预测总协调器是可以接受的，不算新的全局入口。

---

### AF. PreloadRuntimeManager

当前实际文件群：

- `background/preload/runtime/manager.js`
- `background/preload/runtime/window-manager.js`
- `background/preload/runtime/window-manager/*`
- `background/preload/runtime/policy/*`
- `background/preload/runtime/lifecycle/*`
- `background/preload/runtime/source-tabs/*`
- `background/preload/runtime/activation/*`
- `background/preload/runtime/candidate-registration.js`

#### AFA. 建议定位

这是扩展侧 preload runtime 主管模块。

职责：

- preload window 创建/复用
- preload tab 生命周期
- hidden-tab 激活
- system-hidden 状态维持
- cleanup / repair / reset

#### AFB. 当前问题

维护逻辑虽然有 `watchdog.js` 入口，但窗口子系统内部仍然需要一个显式边界。
当前应明确区分两层：

- `runtime/manager.js`
  - preload runtime 总主管入口
- `runtime/window-manager.js`
  - preload window 子系统主管入口

而下面这些文件保留为窗口子系统下游模块：

- `window-manager/creation.js`
- `window-manager/hiding.js`
- `lifecycle/windows.js`

后续应在文档和代码心智上明确：

- `watchdog.js` 是维护入口
- 这些文件是维护子模块
- 不再把它们当普通 helper

#### AFC. 当前已完成的第一步

当前已经新增：

- `background/preload/runtime/manager.js`
- `background/preload/runtime/window-manager.js`

并且这些高层入口已开始统一改走它：

- runtime message 的 preload 注册
- runtime message 的 preload 激活
- watchdog 维护触发
- runtime settings 触发的 preload 维护
- source-tab 预加载同步中的窗口 ensure / hide
- window removed / bounds changed 的窗口事件入口

也就是说，`PreloadRuntimeManager` 现在已经开始成为：

- preload runtime 的显式主管入口

同时，`window-manager.js` 现在也已经开始成为：

- preload window 子系统的显式主管入口

后续再继续收时，应优先把新的高层 runtime 语义挂到这里，而不是直接点底层文件。

---

### AG. LearningManager

当前实际文件群：

- `background/learning/index.js`
- `background/learning/foreground-pages.js`
- `background/learning/link-behavior.js`
- `background/ai/keywords.js`

#### AGA. 建议定位

这是扩展侧学习主管模块。

职责：

- 历史页面池
- page digest ingestion
- link behavior 学习
- AI 输入材料维护
- 页级关键词入库链路

#### AGB. 分层建议

- 主管层：
  - `learning/index.js`
- 中层：
  - `foreground-pages.js`
  - `link-behavior.js`
  - `ai/keywords.js`

目前这层还算清楚，不需要再拆。

---

## B. 本地 app 侧

### BA. 指定入口

#### BAA. 本地 app 主程序入口

- `app/src/main.rs`

职责：

- 模式分发
- host 总装配
- API / tray / host 生命周期装配

#### BAB. 本地 app 后台维护入口

- `app/src/lifecycle/host.rs`

职责：

- 扩展安装检测
- host 单实例
- host 运行期间的扩展卸载关闭监控
- 不负责启动新的离散 host / watcher 进程

#### BAC. 本地 app 旧 watcher 清理入口

- `app/src/lifecycle/watcher.rs`

职责：

- 清理历史 Windows Run watcher 自启动项
- 旧 `--watcher` 参数兼容退出

---

### BB. LifecycleManager

当前实际文件群：

- `app/src/lifecycle.rs`
- `app/src/lifecycle/chrome.rs`
- `app/src/lifecycle/host.rs`
- `app/src/lifecycle/watcher.rs`

建议定位：

- 本地 app 生命周期主管模块

职责：

- 模式判断
- Chrome 运行状态检测
- host shutdown monitor
- legacy watcher cleanup

当前已完成的边界收口：

- `tray.rs` 现在只负责触发手动退出请求
- 生命周期语义开始回到：
  - `app/src/lifecycle.rs`
  - `app/src/lifecycle/host.rs`
  - `app/src/lifecycle/watcher.rs`

---

### BC. WindowManager

当前实际文件群：

- `app/src/window.rs`
- `app/src/window/manager.rs`
- `app/src/window/enumerate.rs`
- `app/src/window/actions.rs`

#### BCA. 建议定位

这是本地 app 的窗口维护主管模块。

职责：

- Chrome 窗口枚举
- hide/show
- `WS_EX_TOOLWINDOW`
- hidden window registry
- hidden window monitor thread

#### BCB. 当前问题

当前 `WindowManager` 已明确拆成两层：

- `window/manager.rs`
  - 持有 hidden window registry
  - 持有 hidden window monitor thread
  - 持有 request -> policy -> response 的高层维护语义
- `window/actions.rs`
  - 只保留 Win32 hide/show/tool-window 动作

这样后续再加窗口维护逻辑时，新增高层语义应继续挂到：

- `window/manager.rs`

而不是重新塞回 `actions.rs`。

#### BCC. 当前已完成的第一步

当前窗口链对外边界已经完成两步收口：

- API routes 不再直接调用：
  - `window/actions.rs`
  - `window/enumerate.rs`
- 现在改为统一先走：
  - `app/src/window.rs`
- 同时窗口维护语义也已从：
  - `window/actions.rs`
  收回：
  - `window/manager.rs`

也就是说，当前 `WindowManager` 的边界已经变成：

- `window.rs`
  - 对外统一导出边界
- `window/manager.rs`
  - 显式高层维护边界
- `window/actions.rs`
  - 低层 Win32 动作层

后续继续收时，应优先把新的窗口高层语义继续挂到：

- `window/manager.rs`

而不是让 API 或其他模块继续直连下层文件。

---

### BD. ModelRuntimeManager

当前实际文件群：

- `app/src/model.rs`
- `app/src/model/runtime/*`
- `app/src/model/infer.rs`
- `app/src/model/status/*`
- `app/src/model/catalog.rs`

建议定位：

- 本地 app 的模型/runtime 主管模块

职责：

- portable runtime 所有权
- 安装/状态/推理
- 模型目录与生命周期

---

### BE. ApiServer

当前实际文件群：

- `app/src/api.rs`
- `app/src/api/routes/*`

建议定位：

- 本地 app API 子系统入口

职责：

- 路由
- 鉴权/CORS 边界
- 调用 `WindowManager / ModelRuntimeManager / Telemetry`

它不是新的主程序入口，当前保留合理。

---

## C. 当前推荐的主管模块收口顺序

### CA. 第一优先级

- `extansion/scripts/navigation-interceptor.js`

原因：

- 最容易继续长成第二个隐式主程序

### CB. 第二优先级

当前没有新的第二优先级残留点。

preload window 边界当前已基本收口到：

- `runtime/manager.js`
- `runtime/window-manager.js`

后续只需防止新的高层入口绕过这两个边界。

### CC. 第三优先级

当前没有新的第三优先级残留点。

`window/actions.rs` 已完成第一轮正式收口；
`tray.rs` 当前也已经降回可接受的 UI 壳范围，后续只需防止政策回流。

---

## D. 规则

后续新增逻辑时统一先问 3 个问题：

1. 这是哪个主管模块的职责？
2. 这是高层业务判断，还是中低层工具逻辑？
3. 这是新的入口，还是已有入口下的子系统实现？

只有在回答清楚这 3 个问题后，才允许放代码。
