# Codex 入口边界审查 2026-04-19

## 1. 本轮审查目标

这份文档只回答一个问题：

- 在已经指定了 4 个入口文件之后，当前代码里还有哪些“高层逻辑”游离在这些入口之外？

这里的“游离”不等于“立刻就是 bug”。
要区分两种情况：

- 合理的子系统协调层
- 不合理的隐式高层入口

前者可以保留，后者应继续收口。

---

## 2. 已指定的入口文件

- 扩展主程序文件：
  - `extansion/service-worker.js`
- 扩展后台维护文件：
  - `extansion/background/preload/runtime/policy/watchdog.js`
- 本地 app 主程序文件：
  - `app/src/main.rs`
- 本地 app 后台维护文件：
  - `app/src/lifecycle/host.rs`
- 本地 app 旧 watcher 清理文件：
  - `app/src/lifecycle/watcher.rs`

---

## 3. 当前仍然游离在外的高层逻辑

### 3.1 `extansion/scripts/navigation-interceptor.js`

这是当前最明显的扩展侧游离高层逻辑。

它现在不只是“页面边缘适配器”，而是同时承担了：

- 点击拦截
- source page 预锁定
- 链接打开行为学习
- 预加载激活尝试
- 候选链接扫描
- 页面摘要上报
- speculation rules 注入

也就是说，它已经不只是 content script 的薄边缘层，而是一个页面端的小型高层协调器。

### 判断

- 这是需要继续收口的。
- 它应该继续保留 DOM 读取、事件捕获、页面局部信号采集。
- 但“导航接管决策”“预加载激活决策”“页面端消息编排”这类高层语义，后续应继续向后台主程序链收。
- 当前点击链已进一步整理成 page-side edge helper，不再把 primary click plan 和 fallback 执行直接糊在一个大函数里。

---

### 3.2 `extansion/background/preload/runtime/window-manager/creation.js`

当前指定的扩展后台维护文件是 `watchdog.js`，但 preload window 的高层维护逻辑并没有真正只停留在 watchdog。

`creation.js` 现在承担了：

- preload window 创建
- preload window 复用
- `hwnd` 探测
- system hide 尝试
- stale preload window state 重置

这已经不是纯粹的“创建 helper”，而是 preload window 生命周期的一部分高层维护逻辑。

### 判断

- 它不一定要物理搬回 `watchdog.js`。
- 当前已经新增：
  - `runtime/window-manager.js`
- 所以后续更准确的心智模型应是：
  - `watchdog.js` 是维护入口
  - `window-manager.js` 是 preload window 子系统主管边界
  - `creation.js` 是其下游实现模块
- 以当前边界看，它已经更接近“可接受的子系统实现层”，而不是新的独立高层入口。

---

### 3.3 `extansion/background/preload/runtime/window-manager/hiding.js`

这个文件现在承担了：

- system-hidden 刷新
- fallback minimize 维持
- preload window 隐藏态保持

这也是典型的“维护逻辑仍然散在维护入口之外”的例子。

### 判断

- 这是合理存在的维护子模块。
- 但从入口边界上看，它确实属于 `watchdog` 维护职责的一部分，而不是完全独立的高层逻辑。
- 当前问题不是“必须删”，而是需要在心智模型上明确：
  - `watchdog.js` 是维护入口
  - `window-manager.js` 是 preload window 主管边界
  - `hiding.js / cleanup.js / repair.js / creation.js / lifecycle/windows.js` 是维护子模块

---

### 3.4 `extansion/background/preload/prediction/strategy-router.js`

这个文件当前承担了：

- 候选池进入正式策略层前的最后总装配
- 规则链筛选
- cross-site 站点层选择
- 最终策略分流

它本质上是预测子系统的总协调器。

### 判断

- 这是可以接受的高层子系统协调层。
- 它并不是新的全局入口。
- 只要它继续局限于“prediction 子系统总装配”，就不算需要强行收回 `service-worker.js`。

---

### 3.6 `app/src/window/manager.rs`

本地 app 的隐藏窗口维护链目前已经单独收成：

- `app/src/window/manager.rs`

它承担了：

- hidden window registry
- hidden window 维护线程
- request-level hide/show policy

而底层动作目前留在：

- `app/src/window/actions.rs`

只负责：

- Win32 `ShowWindow`
- `WS_EX_TOOLWINDOW`
- frame change 刷新

### 判断

- 这条维护链现在属于“合理存在的子系统协调层”。
- 它不必并回 `watcher.rs`，因为维护对象不同：
  - `watcher.rs` 维护 host 生命周期
  - `window/manager.rs` 维护隐藏窗口状态
- 当前关键不是继续拆，而是保持这条边界不回流。

---

## 4. 当前可接受、不算游离的问题点

### 4.1 `app/src/tray.rs`

当前它已经更接近合理的 UI 壳：

- 菜单点击只触发 `lifecycle::request_manual_host_exit(...)`
- 实际 suppression 写入和 host 退出政策在 `lifecycle` 边界

所以它当前不再算主要“游离高层逻辑”。
只要后续不再把生命周期政策重新写回去，就可以接受。

### 4.2 `extansion/background/core/router.js`

当前它基本已经退化成：

- runtime / navigation / message 分发边界

这符合设计目标，不算游离高层逻辑。

### 4.3 `app/src/api.rs`

它是本地 app HTTP API 的子系统入口。
这是合理的，不算新的主程序入口。

### 4.4 `extansion/background/learning/*`

学习层虽然仍有编排，但目前已经在自己的子系统里收得比较干净。
它们是高层子系统逻辑，不是新的全局入口。

---

## 5. 结论

当前最值得继续警惕的“游离高层逻辑”有 1 个：

1. `extansion/scripts/navigation-interceptor.js`

其中：

- `navigation-interceptor.js`
  - 需要继续收口

当前不建议为了形式继续大拆。
更合理的方向是：

- 保留指定入口
- 承认少数合理存在的子系统协调层
- 继续把最容易失控的那几个游离点往指定入口语义上收
