# Codex 高层逻辑与边界 Bug 记录 2026-04-19

## 1. 目的

这份文档只记录本轮“从主逻辑到主管模块”调查中发现的高层 bug / 设计偏移。

它和架构方案文档分开维护：

- 架构方案：讲应该怎么分层
- 这份清单：讲现在有哪些地方不符合这个目标

---

## 2. 当前发现的问题

### Bug 1. `navigation-interceptor.js` 已经膨胀成页面端隐式主管模块

文件：

- `extansion/scripts/navigation-interceptor.js`

表现：

- 一个 content script 同时承担点击拦截、source-lock、行为学习、preload 激活、候选扫描、页面摘要上报、speculation rules 注入。

问题：

- 页面边缘层和后台高层判断混在一起。
- 后续一旦继续在这里叠逻辑，很容易形成第二条平行主程序链。

建议：

- 保留 DOM 读取和事件捕获。
- 后续把导航接管语义继续收回后台主管模块。

当前进度：

- 第一轮收口已完成。
- 点击导航时直接调用的高层消息已经统一改为走：
  - `background/navigation/manager.js`
- 但页面端仍然保留：
  - Google 搜索内部模式短路
  - 预先 `preventDefault`
  - `_blank` 预留空白窗口保底

所以这条问题现在是“已开始收口，尚未完全收平”，不是完全未处理状态。

进一步进度：

- 页面端已经不再自己判断：
  - `same-origin / cross-site`
  - 是否要交给后台导航主管处理
- 当前点击链内剩余的 page-side 逻辑，已经进一步收成显式 edge helper：
  - primary click handling plan
  - background resolution request
  - browser fallback execution

这说明当前问题已经从“页面端持有大量导航政策”收缩为：

- 页面端仍然保留少量浏览器交互边缘处理
- 这些残留主要是为了满足：
  - 同步 `preventDefault`
  - popup 保留窗口
  - 浏览器默认导航回退

后续继续收时，优先只看这些残留边缘处理是否还能再减。

---

### Bug 2. preload runtime 维护逻辑仍然散在 `watchdog` 之外

文件：

- `extansion/background/preload/runtime/window-manager/creation.js`
- `extansion/background/preload/runtime/window-manager/hiding.js`
- `extansion/background/preload/runtime/policy/watchdog.js`

表现：

- `watchdog.js` 是维护入口，但 `creation.js / hiding.js` 里也有明显的高层维护语义。

问题：

- 维护责任边界不够清晰。
- 很容易导致修一个窗口生命周期 bug 时，得跨多个文件来回找高层状态。

建议：

- 继续保留这些子模块。
- 但在代码和文档心智上都明确它们属于 `watchdog` 下的维护子系统。

当前进度：

- 第一轮入口收口已完成。
- 新增：
  - `background/preload/runtime/manager.js`
- 新增：
  - `background/preload/runtime/window-manager.js`
- 现在 runtime message、watchdog 和 runtime settings 触发的维护动作，已经开始先走 runtime 主管边界。
- source-tab 预加载同步、window removed / bounds changed 入口，也已经开始先走 preload window 子系统主管边界。

所以这条问题当前状态是：

- 已基本收口
- `creation.js / hiding.js / lifecycle/windows.js` 当前保留为实现级维护子模块是可以接受的
- 当前剩余任务主要是继续避免新的高层入口绕过 `runtime/window-manager.js`

---

### Bug 3. `tray.rs` 已经触碰 host 生命周期语义

文件：

- `app/src/tray.rs`

表现：

- manual exit 信号触发
- 当前会话退出语义
- tray tick 驱动 shutdown 协调

问题：

- 一个原本应偏 UI 壳的文件，已经承载了一部分生命周期政策。

建议：

- 当前可以保留。
- 但不要再继续把生命周期政策写进去。

当前进度：

- 手动退出抑制文件机制已删除；不再需要 watcher 防止补拉
- `tray.rs` 现在只保留“触发 manual exit 请求”的职责
- 当前剩余内容主要是：
  - 菜单事件消费
  - shutdown 信号消费
  - event loop tick 保活

所以这条问题当前状态是：

- 已基本收口
- 当前属于可接受的 UI 壳残留
- 后续只需防止新的生命周期政策重新长回 `tray.rs`

---

### Bug 4. `window/actions.rs` 不再只是工具层

文件：

- `app/src/window/actions.rs`

表现：

- hidden window registry
- hidden window monitor thread
- 持续 `SW_HIDE`
- tool-window 维持

问题：

- 从文件名看像 action helper，实际一度已经长成窗口维护子系统。
- 如果继续维持这种结构，后续很容易再往“工具文件”里塞高层逻辑。

当前进度：

- API routes 已经不再直接调用：
  - `window/actions.rs`
  - `window/enumerate.rs`
- 窗口对外调用边界已先收回：
  - `app/src/window.rs`
- 2026-04-20 已新增：
  - `app/src/window/manager.rs`
- hidden window registry / monitor / request-level policy 已从：
  - `window/actions.rs`
  收回：
  - `window/manager.rs`
- `window/actions.rs` 现在只保留 Win32 hide/show/tool-window 动作

所以这条问题当前状态是：

- 已完成第一轮修复
- 后续只需防止新的高层维护语义重新回流到 `actions.rs`

---

## 3. 当前处理建议

优先级顺序：

1. 收 `navigation-interceptor.js`
2. 持续防止 preload window 高层入口绕过 `runtime/window-manager.js`
