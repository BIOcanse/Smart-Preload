# Codex 设计一致性静态审查 2026-04-19 v2

这份清单只记录本轮新的静态审查结果，不和之前的合并问题表混写。

审查重点：

- 后台隐藏 preload window 是否符合“真实隐藏容器”的设计目的
- 外站双层频数 / 站点分槽是否符合新设计
- 预加载总槽位与站点选择上限是否按设计协同

本轮是静态代码审查，没有做浏览器端到端复现。

---

## P1

### 1. `a` 被 cross-site 站点分槽和全局规则链重复消费，same-origin 候选会把站点分槽结果再次冲掉

涉及：

- `extansion/background/preload/prediction/site-selection.js:15-79`
- `extansion/background/preload/prediction/strategy-router.js:14-48`
- `extansion/background/preload/rules.js:1-54`

当前实现里，cross-site 站点层先用 `pageSlotLimit` 计算站点分槽并选出页面；但 same-origin 候选被直接原样并回结果，不参与这次分槽。随后 `strategy-router` 又把整个合并后的候选池交给 `applyOrderedPreloadRules(..., maxTargets=a)` 再切一次。

结果是：

- 站点分槽并不是最终结果
- 只要同页上还有 same-origin 候选，就可能把已经分好的 cross-site 页面再次截掉
- `a` 不再是“已选站点集合内部的页面总槽位”，而是又退回成了一个后置全局切片

这和文档里“先站点入选，再在已选站点集合里用 `a` 分配页面槽位”的设计不一致。

---

### 2. preload window 关闭后没有清空 `hwnd / hiddenBySystem`，后续可能把错误的 Chrome 窗口重新隐藏

涉及：

- `extansion/background/preload/runtime/lifecycle/windows.js:25-38`
- `extansion/background/preload/runtime/policy/cleanup.js:1-23`
- `extansion/background/preload/runtime/window-manager/creation.js:154-170`
- `app/src/window/enumerate.rs:17-23`

当前 preload window 被关闭或被 cleanup 回收时，只清了 `windowId`，没有同步清掉：

- `preloadWindow.hwnd`
- `preloadWindow.hiddenBySystem`

而下一次 `hidePreloadWindowBySystem(...)` 会优先信任这个旧 `hwnd`。native app 如果收到 `hwnd`，会直接按 `hwnd` 找 Chrome 窗口并隐藏，不再按 bounds 二次确认。

结果是：

- stale `hwnd` 一旦碰巧又对应到别的 Chrome 窗口，就会隐藏错窗口
- 即使没隐藏错，也会让重新隐藏链进入不可预测状态

这不是小脏状态问题，而是会直接导致“错误窗口被藏掉 / 正确 preload window 没被藏掉”的系统级错误。

---

### 3. 创建 preload window 时先创建 `state: "normal"` 的真实窗口，再异步去隐藏，天然会闪

涉及：

- `extansion/background/preload/runtime/window-manager/creation.js:77-95`
- `extansion/background/preload/runtime/window-manager/creation.js:194-221`
- `app/src/window/actions.rs:25-54`

当前系统隐藏链的真实顺序是：

1. `chrome.windows.create({ state: "normal" })`
2. 等 Chrome 真把窗口建出来
3. JS 轮询本地窗口列表找新增 `hwnd`
4. 再调用 native `SW_HIDE`

这条链决定了：

- 新窗口在 OS 层必然会以正常窗口形态存在一小段时间
- `PRELOAD_WINDOW_HWND_WAIT_MS` 甚至给了 1000ms 的等待窗口
- 也就是说“先 visible，再隐藏”不是偶发 bug，而是当前实现本身的结构

这和“后台窗口应作为完全隐藏容器”的设计目标明显不一致。当前代码虽然加了重试和 bounds/`hwnd` diff，但仍然没有绕开“先显示出来一次”这个根本问题。

---

## P2

### 4. 隐藏策略还是一次性 `SW_HIDE`，没有维护型 re-hide 链，Chrome 自己 re-show 时仍然会漏出来

涉及：

- `app/src/window/actions.rs:25-54`
- `extansion/background/preload/runtime/window-manager/hiding.js:1-33`
- `extansion/background/preload/runtime/policy/watchdog.js:1-74`

当前 native 侧只做：

- `WS_EX_TOOLWINDOW`
- `ShowWindow(SW_HIDE)`

extension 侧再靠：

- bounds-changed
- watchdog

去补救。

但代码里没有任何 `SetWinEventHook(EVENT_OBJECT_SHOW)` 之类的 maintained hiding 机制。Chrome 一旦因为内部行为主动 `SW_SHOW` 这个窗口，当前链路只能等：

- 下一个 bounds 事件
- 或下一次 watchdog tick

才可能再收回去。

这意味着“完全隐藏”当前仍然只是 best-effort，不是 maintained policy。对一个长期存在的 preload container，这个缺口会持续制造闪烁和露出。

---

### 5. watchdog 无论是否有 hidden-tab entry 都会保温一个 preload window，任何隐藏失手都会直接暴露给用户

涉及：

- `extansion/background/preload/runtime/policy/watchdog.js:21-41`
- `extansion/background/preload/runtime/policy/watchdog.js:108-113`

`shouldKeepWarmPreloadWindow()` 当前只看：

- hidden-tab runtime 支持
- `preloading.enabled === true`

于是只要开启预加载，watchdog 就会在“没有任何 hidden preload entry”的情况下也维持一个 preload window。

这会带来两个后果：

1. 只要系统隐藏链有一次失手，用户就会长期看到那个 sentinel/blank window
2. “没有任何实际 hidden preload 任务”时，系统依然暴露出一个真实 Chrome 窗口对象

从设计角度看，warm container 可以作为优化，但不应该在隐藏链不稳定时继续无条件保温。现在这条策略把一个本该后台化的失败，直接升级成了前台可见问题。

---

## P3

### 6. 当前页同一个 URL 的多个链接实例会被合并成一个候选，`_blank` 语义会被“只要有一个是 `_blank` 就整体升级”

涉及：

- `extansion/background/preload/prediction/candidate-pool.js:22-72`
- `extansion/background/preload/prediction/candidate-pool.js:106-120`

候选池当前按 `candidateUrl` 去重。只要同页出现多个指向同一 URL 的链接：

- 这些实例会被合并成一个 candidate
- `targetHint` 的合并逻辑是：只要任一实例是 `_blank`，结果就整体变成 `_blank`

这会损失两个重要信息：

- 同一页内不同链接实例的实际打开行为差异
- 不同实例的文本语义差异

对于普通页面这只是精度损失；但对于 Google 搜索结果、站点 sitelink、卡片式结果页，这种“把任意一个 `_blank` 放大成整个 URL 的 `_blank`”会直接影响策略分流和替换判断。

---

## 结论

当前最不符合设计目的、也最容易制造“弱智 Bug”的，是这 5 类：

1. `a` 的语义被站点层和后置规则层双重消费
2. preload window 关闭后 `hwnd` 脏状态没清
3. preload window 创建时天然先 visible 再 hide
4. 隐藏链仍然不是 maintained policy
5. warm preload window 无条件常驻，把隐藏失手直接暴露给用户

如果按修复优先级排，我建议先处理：

1. `hwnd / hiddenBySystem` 清理
2. preload window 创建路径
3. `a` 与站点分槽的最终边界
4. warm preload window 保温策略
