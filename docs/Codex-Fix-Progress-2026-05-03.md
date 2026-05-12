# Codex 修复进度 2026-05-03

## 已落地

- 本地 app 窗口枚举从只认 Google Chrome 扩展为支持 Chrome / Edge / Chromium / Chrome for Testing / Playwright Chromium，并在窗口 API 返回 `processId`、`processName`、`executablePath`、`browserKind`，用于识别具体浏览器实例。
- 本地 API 授权从单个 extension origin 改成多 origin 集合。`/api/v1/extension/register` 只有在能证明 origin 对应已安装目标插件时才会加入允许列表，避免 origin 文件缺失时 first-request-wins。
- 后台真实标签页预加载窗口增加系统隐藏失败计数、失败原因和 30 秒退避。watchdog 会先确认前台 normal window 仍存在，系统隐藏不可用或退避中时不再创建空保温窗口。
- 预加载候选刷新改成只请求每个 normal window 的 active tab。`tabs.onActivated` 会清理同窗口旧 source tab 的 hidden-tab / speculation 状态，然后请求新 active tab 重新提交候选。
- 追踪层把非 `link` 的主框架导航改成只更新当前页面状态，不写跳转频数。`record-visit` 传给 Wasm 的页面 URL 已改为 `normalizePageUrlForIndex` 后的值，避免 Google 搜索动态参数污染页面级频数。

## 待实机验证

- 无状态调试 Chrome / Chrome for Testing 背景窗口是否能被 app 正确枚举并隐藏。
- 同一 Chrome 账户多 normal window 是否分别只保留自己的 active tab 预加载窗口和上限。
- 新开 Google 搜索、地址栏输入、刷新是否只更新当前页，不增加跳转频数；搜索结果页点击链接是否仍写入跳转。
- extension 多 origin 注册在同一 app 进程内能否同时服务多个插件实例。

## 2026-05-03 独立调试结果

- 使用 `D:\tmp\zlw-profile-codex-9444` 独立 Chrome for Testing profile、`D:\Code\ChromeExtExt` 插件 junction、`9444` CDP 端口完成测试。
- 本地 app 以 `--host` debug force 启动，`/health` 正常；`/api/v1/windows/chrome` 能枚举 Chrome for Testing 前台窗口和预加载窗口。
- Google 搜索页能触发真实 hidden-tab 预加载；后台预加载窗口 `visible=false`、`toolWindow=true`，hidden monitor 未观察到隐藏后的可见/on-screen episode。
- 首轮发现 Google 搜索 `history-state-updated + link` 仍会写入 `google/search -> google/search` 自跳转；已在 `recordVisit` 前加规范化 self-transition 硬拦截，重测后 `transitionSequence=0`。
- 点击已预加载的搜索结果后，前台页替换为目标页，没有出现目标页重复或前台 `about:blank`。回到搜索页后，Google -> GitHub 频数写入，`https://github.com/` 权重从 `1` 提升到 `1.4913073112858317`。
- 多 normal window 测试通过：两个前台窗口分别有独立 `preloadWindow.windowId/hwnd`，第一个窗口保持 GitHub hidden-tab 组，第二个窗口独立生成 Rust 搜索的 native prerender 组。
- 测试中发现 expected preload window 内会残留未登记的普通 `about:blank`；已在 repair 中清理非 sentinel 且非 tracked preload tab。重测后后台窗口只剩 sentinel + tracked preload tabs。

## 仍需后续决策

- Native Messaging 目前主要注册在 Chrome 路径。若要正式支持 Edge 主动唤醒，需要补 `Software\\Microsoft\\Edge\\NativeMessagingHosts` 注册和 Edge profile 扫描。
- 当前阶段每个 normal window 使用完整设置上限；后续再加全局总上限和平分策略。

## 2026-05-03 追加独立调试

- 使用 `D:\tmp\zlw-profile-codex-9556-*` 独立 Chrome for Testing profile、`9556` CDP 端口、插件 ID `plhnlmgppnniebdhimmpkadocbeajiml` 复测。
- 初始 Google 搜索 `github` 不写跳转，`transitionSequence=0`；页面链接候选被拆到真实标签页预加载组，`github.com` 站点拿到 2 个槽位，`desktop.github.com` 拿到 1 个槽位。
- raw CDP `Input.dispatchMouseEvent` 在当前环境没有形成有效 Google 结果点击；改用 Playwright locator 点击 `a[href="https://github.com/"]` 后触发真实用户点击链路。
- 替换链路命中：事件出现 `navigation.click.cross-site-current-tab.activation-attempt` 与 `navigation.click.cross-site-current-tab.activation-hit`，已预加载的 `https://github.com/` 标签页被移动到前台窗口，原 Google source tab 被移除，没有重复 GitHub 前台页，也没有前台普通 `about:blank`。
- 回到 Google 搜索后，`https://github.com/` 的 `siteTransitionCount=1`、`outboundPageTransitionCount=1`、最终 score=`1.4913073112858317`；`https://github.com/login` 只继承站点入选槽位，页面自身 `outboundPageTransitionCount=0`，score 仍为 `1`，符合“站点选槽 + 子页面内部按被外站导航频数排序”的当前设计。
- 多窗口复测：GitHub 搜索窗口和 Rust 搜索窗口分别拥有独立 normal window runtime 与独立 hidden preload window；本地 app 枚举两个 Chrome for Testing 前台窗口和两个 `about:blank#zero-latency-preload-window` tool window。
- hidden monitor 数据显示 tracked preload window 当前 `visible=false`、`onScreen=false`、`toolWindow=true`，跟踪后 `wasVisibleSinceTracked=false`、`wasOnScreenSinceTracked=false`。`firstHideMatchVisible=true` 仅表示创建瞬间隐藏前匹配到可见窗口，随后系统隐藏成功。
- 测试脚本通过 `chrome.tabs.update` 把 GitHub 前台页改回 Google 时会写入一条 GitHub -> Google 记录，这是测试方式造成的扩展侧程序化导航副作用，不等价于用户地址栏/页面内点击场景；后续如果插件内部会主动改前台 tab URL，需要给该路径加 ignore marker。

## 2026-05-03 心跳与保温窗口修复

- 本地 app 增加插件运行实例 heartbeat lease：扩展通过 `/api/v1/extension/heartbeat` 每 10 秒续租，app 侧 45 秒 TTL 清理过期 lease；host 启动 60 秒后若没有任何活跃插件实例，会自动退出。
- `/api/v1/extension/register` 成功时也会写入一次 heartbeat，避免刚唤醒 host 时还没等到 alarm 就被视为无实例。
- 扩展运行时配置应用后会立即发送 heartbeat 并创建 heartbeat alarm；服务暂停或预加载关闭时会清除 heartbeat alarm，让 app 在 TTL 后自然退出。
- 插件启动/运行时会为每个普通前台窗口主动创建保温 preload window。即使当前页是 `about:blank` 或不参与预测，也会保留 `about:blank#zero-latency-preload-window` sentinel；sentinel 不属于 source tab，不参与预加载槽位和候选上限。
- active tab 切换或旧 source tab 清理后，如果系统级隐藏仍可用，不再因为当前窗口没有 hidden preload entries 而关闭 preload window，而是保持 sentinel 窗口，减少后续重新创建导致的闪烁。
- AI 预测链路增加诊断事件：`prediction.ai.interest.*`、`prediction.ai.page-match.*`、`prediction.ai.site-match.*`。后续可直接从日志判断 AI 是否启用、是否生成兴趣关键词、目标页关键词是否存在、候选/站点是否命中以及实际 multiplier。

## 2026-05-03 心跳与保温窗口实测

- 使用 `D:\tmp\zlw-profile-codex-9560-*` 独立 Chrome for Testing profile 复测。
- 在 `about:blank` 初始页调用 runtime apply 后，立即创建 preload window，状态中 `sourceTabs={}`，只保留 sentinel tab，`hiddenBySystem=true`，native hwnd 已记录。
- hidden monitor 显示该窗口隐藏后 `currentlyVisible=false`、`currentlyOnScreen=false`、`currentlyToolWindow=true`，且未记录隐藏后的可见/on-screen episode。
- heartbeat alarm 成功续租，日志显示 `native-app.heartbeat.success` 和 app 侧 `extension-heartbeat::active=1`。
- 关闭隔离 Chrome 后等待 58 秒，debug host 自动退出；当系统仍有其他 Chrome 进程时，app 也能因为插件实例心跳消失而退出。

## 2026-05-03 Heartbeat 自恢复

- 插件侧 heartbeat 失败后不再只返回离线错误；现在会清空 native app 注册/health 缓存，调用 Native Messaging 唤醒本地 app，然后按 `250ms / 750ms / 1500ms` 短退避重新注册并补发 heartbeat。
- 新增诊断事件 `native-app.heartbeat.recovery-start`、`native-app.heartbeat.recovery-success`、`native-app.heartbeat.recovery-failed`，用于判断本地 app 被手动关闭后是否被插件重新拉起。

## 2026-05-03 Loading 预加载点击修复

- 修复点击时后台预加载标签页仍处于 `loading` 就被关闭并回退的问题。现在只要匹配的后台标签页存在，就会立即移动/激活到前台，未完成的加载继续在前台进行。
- 若被移动的标签页仍是空 `about:blank`，激活前会补一次目标 URL 导航，避免出现空白页被带到前台。
- 内容脚本给当前页替换点击增加 2.5 秒 deadline；后台超过 deadline 不再晚到激活，内容脚本会直接执行普通当前页跳转，避免用户点击后无响应。
- 新增诊断事件字段：`preload-activation.loading-promoted`、`preload-activation.success.activatedWhileLoading`、`preload-activation.success.preloadedTabStatus`。

## 2026-05-08 主要问题修复

- 移除本地 AI 测试配置入口：service worker 和设置页不再加载 `shared/local-ai-test-config.js`，`shared/settings.js` 不再读取 `aiTestConfigV1` 或全局测试配置，避免 release/default 设置被本地 key 污染。
- 删除忽略文件 `extansion/shared/local-ai-test-config.js`；默认配置仍保持 AI 预测关闭，API key 为空。
- 修复 MV3 service worker importScripts 全局声明冲突：删除 `window-manager/creation.js` 内重复的 `normalizePositiveFiniteNumber()`，复用 `background/shared/base.js` 的共享函数。
- Native Messaging 和插件安装扫描从只支持 Chrome 扩展为 Chrome + Edge：profile 扫描覆盖 `Google\Chrome\User Data` 和 `Microsoft\Edge\User Data`，Native Messaging 注册/卸载同时写入 Chrome 与 Edge registry path。
- 验证：`cargo check/test` app 通过，`cargo check/test` Wasm engine 通过，扩展 140 个 JS/MJS 文件 `node --check` 通过，service worker importScripts 零缩进顶层重复声明扫描通过，`cargo run -- --status` 能检测到当前安装插件 ID。

## 2026-05-03 跳转记录链路检查

- 真实普通跳转仍由 `webNavigation.onCommitted/onHistoryStateUpdated -> recordVisit/setCurrentPageFromVisit` 处理；只有 `transitionType=link` 写真实方向边，非 link 只维护当前页状态。
- 真实新标签页跳转由 `webNavigation.onCreatedNavigationTarget` 先写 `pendingSources[targetTabId]`，再由目标 tab 的后续 commit 写真实方向边。现在即使目标初始是 `about:blank` 也会锁 source，覆盖插件 `_blank` 兜底先开空白页再导航的路径。
- 后台真实预加载 tab 被用户点击命中后，由 `recordActivatedPreloadedTransition` 在 `chrome.tabs.move` 前写一条真实跳转消息；目标 URL 优先使用已加载 tab 的真实 URL，其次使用 entry loadedUrl，最后才回退到点击 URL。
- 原生 `prerender/instant` 一类 `webNavigation.onTabReplaced` 不再只迁移 tabState；现在会读取 replacement tab 当前 URL，并紧接着写一条 `eventType=tab-replaced` 的真实跳转。若后续 commit 再到，会被 self-transition 跳过，避免重复计数。
- 内容脚本托管当前页点击后，如果最终 fallback 到 `location.assign`，后台会先给当前 tab 写 `pendingSources[tabId]`。后续 commit 即使被 Chrome 标成 `generated` 而不是 `link`，也会因为存在 source-lock 写真实跳转；没有 source-lock 的非 link 导航仍只更新当前页状态。
