# Local App Lifecycle

## Goal

The local app keeps a portable install lifecycle:

- The tray/API app is the only long-running local process.
- `--install` writes HKCU registry entries that point to the current portable directory.
- The extension may wake the app through Chrome Native Messaging when the local HTTP API is offline.
- Extension load, install, startup, and settings application must immediately run one native-app liveness heartbeat before continuing with preload runtime work. This first heartbeat is awaited so the MV3 service worker cannot drop it as background fire-and-forget work.
- If heartbeat recovery cannot reach the app, the extension keeps a wake-retry alarm active and repeatedly probes the local API plus Native Messaging wake paths until the app responds or the extension has no normal browser window left.
- Native Messaging wake depends on browser registration and manifest `allowed_origins`; a plain app registry entry is not enough. If the extension ID cannot be discovered during `--install`, install must not delete an existing Native Messaging registration. Fresh installs still need the extension present at least once so the app can write the allowed origin.
- Native Messaging is a short-lived bootstrap process only; it starts the real tray/API host and exits.
- There is still no always-on watcher.
- The tray/API host exits when all top-level Google Chrome browser processes are gone.
- The tray/API host also exits when the registered extension disappears. This check must stay app-side because an uninstalled extension cannot notify the app after uninstall.
- Extension ownership for HTTP API access is enforced by the registered origin file and API authorization. Runtime extension-existence checks are lifecycle shutdown checks, not API trust discovery.

## Designated Entry Files

本地 app 高层入口仍然固定为：

- 本地 app 主程序文件：
  - `app/src/main.rs`
- 本地 app 后台维护总文件：
  - `app/src/lifecycle.rs`
- 本地 app host 单实例文件：
  - `app/src/lifecycle/host.rs`
- 本地 app 扩展发现与运行期存在性检测文件：
  - `app/src/lifecycle/extension/mod.rs`
- 本地 app Chrome 进程生命周期文件：
  - `app/src/lifecycle/chrome.rs`
- 本地 app 旧 watcher 清理文件：
  - `app/src/lifecycle/watcher.rs`

职责边界调整为：

- `main.rs`
  - 模式分发入口
  - install / uninstall / status 命令入口
  - host 生命周期入口
  - API / tray / host 运行时的总装配
- `host.rs`
  - host 单实例
  - 不承担插件安装检测、扩展卸载关闭监控或业务生命周期策略
- `extension.rs`
  - 安装 / status 阶段需要的扩展 ID 扫描工具
  - 运行期 extension shutdown monitor
  - 只回答“目标扩展是否仍存在”，不决定预测、预加载、AI 或窗口业务
- `chrome.rs`
  - Chrome 顶层浏览器进程检测
  - Chrome 关闭后的 host shutdown monitor
- `watcher.rs`
  - 不再负责 Chrome 跟随启动
  - 不再补拉 host
  - 旧 `--watcher` 入口只负责清理历史 Windows Run 自启动项后退出

## Process Model

The app now accepts these modes:

- `--install`
  - Writes `HKCU\Software\ZeroLatencyWeb`.
  - Detects the installed extension ID from Chrome / Edge profiles using a structural manifest fingerprint, not localized display name text.
  - Writes the Native Messaging manifest under the portable app directory when at least one extension ID is known.
  - Registers `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.zero_latency_web.app` and `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.zero_latency_web.app` when the manifest can be written.
  - If no extension ID is available, it leaves any existing Native Messaging registration in place and reports the missing extension state instead of deleting the wake bridge.
  - Writes `<app-dir>\portable\allowed-extension-origin.txt` for the local HTTP API authorization boundary.
  - `install-register.cmd` checks an existing registration before overwriting it. If the old
    app path points to a different directory and that directory contains the expected app package
    files and directories with matching file types, the script asks whether to stop and delete
    the old app directory after the new registration succeeds.
- `--uninstall`
  - Removes `HKCU\Software\ZeroLatencyWeb`.
  - Removes the Native Messaging registry entry and manifest file.
  - Removes the legacy watcher Windows Run entry.
- `--status`
  - Prints and writes install status without changing registry state.
- Normal launch / `--host`
  - Real tray application.
  - Owns the HTTP API and system tray icon.
  - Monitors top-level Chrome browser process count.
  - If all top-level Chrome browser processes stay gone for a short grace window, it exits.
  - Monitors whether the registered target extension still exists.
  - If the registered target extension disappears, it exits.
  - API access is allowed only for the origin written during `--install`.
- Native Messaging compatibility path
  - Chrome launches the executable as a Native Messaging host.
  - Detected by the `chrome-extension://...` origin argument.
  - Starts the real `--host` process in the background.
  - Writes a short Native Messaging response and exits.
- `--watcher`
  - Legacy compatibility only.
  - Removes the old Windows Run watcher registration and exits.

## Default Launch Behavior

Launching the executable without arguments does this:

1. Remove the old watcher Windows Run entry if it exists.
2. Exit without starting the tray/API host.

The tray/API host starts only through:

- Chrome Native Messaging wake from the extension
- explicit `--host`
- `ZLW_DEBUG_FORCE_HOST=1` for local debugging

Registry changes are explicit: normal launch does not rewrite or delete Native Messaging registration.

When the host is running, lifecycle monitoring remains bidirectional:

- Extension -> app: if the HTTP API is offline, the extension wakes the host through Native Messaging.
- Extension -> app: startup/runtime settings application sends an immediate awaited heartbeat; recurring heartbeat/wake retry use shorter local retry cadence for faster recovery after the app is closed.
- Extension -> app: if heartbeat fails after short recovery retries, the extension starts `native-app-wake-retry`, which keeps trying to find the HTTP API and wake the host.
- Extension -> app: heartbeat and wake retry are extension liveness responsibilities, not preload-runtime responsibilities. They must stay active while the extension service itself is online, even when predictive preloading is disabled.
- Extension -> app: each profile sends a persistent heartbeat `clientId` and the HWNDs of hidden preload windows owned by that profile. If that lease expires, the app closes those tracked hidden windows as a native cleanup fallback.
- App -> extension existence: if Chrome remains open but the target extension is removed, disabled in a way that removes its storage/manifest visibility, or no longer matches the registered extension ID, the host shuts itself down.
- App -> Chrome lifecycle: if all top-level Chrome browser processes are gone, the host shuts itself down after the grace window.
- App -> hidden-window cleanup: host shutdown closes any remaining tracked hidden preload windows before the API thread exits.

This runtime extension check is intentionally separate from API authorization. It must never become first-request-wins origin registration.

## Extension API Flow

The extension-side HTTP client owns wakeup after `--install` has registered the current portable app path:

1. On service worker bootstrap, install, startup, or settings application, create the heartbeat alarm and immediately send one awaited heartbeat.
2. Try `/api/v1/extension/register`.
3. If registration cannot connect, first call `chrome.runtime.sendNativeMessage("com.zero_latency_web.app", { type: "zlw:wake-host" })`.
4. If one-shot Native Messaging fails, fall back to `chrome.runtime.connectNative("com.zero_latency_web.app")` and send the same wake payload over the port.
5. The Native Messaging bootstrap starts `zero-latency-web-app.exe --host`.
6. The extension retries registration with short backoff.
7. If heartbeat recovery still fails, the extension enables the `native-app-wake-retry` alarm.
8. Each wake-retry cycle checks `/health`; if still offline, it retries the two Native Messaging wake strategies and then retries registration/heartbeat.
9. Wake retry stops once heartbeat succeeds, the extension service is paused, or the current extension profile has no normal browser window.
10. Normal API calls continue only after registration succeeds over `http://127.0.0.1:45831` with the extension-origin header.

User requirement captured on 2026-05-29: "心跳检测不通过就尝试拉起". Implementation interpretation: a missing/offline local app is handled by heartbeat recovery regardless of whether predictive preloading is currently enabled. The preloading toggle may stop preloading windows and AI lifecycle work, but it must not disable native app liveness heartbeat.

Native Messaging is only the launch bridge. The HTTP API remains the data/control channel between extension JS and local app.

The local HTTP API does not auto-discover or first-request-win any extension origin. It only accepts the origin in:

- `<app-dir>\portable\allowed-extension-origin.txt`

If that file is missing or stale, run `zero-latency-web-app.exe --install` again after the unpacked / installed extension is present.

## AI Runtime Boundary

The local app no longer manages AI runtimes or model files:

- Local app HTTP API: `http://127.0.0.1:45831`
- No portable Ollama installation
- No model download / uninstall endpoint
- No status polling that starts a model runtime
- No provider API key storage in the local app

AI inference is owned by extension JS through configured provider keys. Users who want local models should run a separate OpenAI-compatible tool such as LM Studio and configure that endpoint/key in the extension.

Prediction and ranking are not owned by the local app. The intended split is:

- Extension Rust/Wasm owns graph storage, frequency query, prediction scoring, and slot-allocation computation.
- Extension JS owns browser event orchestration, Chrome API calls, provider adapter calls, and moving the computed result into preload actions.
- Local app Rust owns OS permission surfaces only: system window control, Native Messaging bootstrap, API authorization, and host lifecycle monitoring.

## Registration

Native Messaging manifest path:

- `<app-dir>\portable\native-messaging\com.zero_latency_web.app.json`

Native Messaging registry path:

- `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.zero_latency_web.app`

Portable app registry path:

- `HKCU\Software\ZeroLatencyWeb`

Moving the portable app directory requires rerunning `zero-latency-web-app.exe --install`.

## Debug Force Host

Debug force startup is intentionally non-persistent:

- Supported switch: `ZLW_DEBUG_FORCE_HOST=1`
- Unsupported after the cleanup fix: portable `debug-force-host.txt`

The file-based backdoor was removed because a stale portable file can bypass extension-install
detection after uninstall and keep the local app/window manager active.

## Manual Exit Behavior

Clicking `Exit` from the tray shuts down the current host process.

Because there is no always-on watcher, manual exit is not undone by the local app itself. If the extension later needs the API again, heartbeat failure starts the extension-side wake retry loop and it will keep trying to wake the app while that extension profile still has a normal browser window.
