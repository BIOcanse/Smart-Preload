# Local App Lifecycle

## Goal

The local app now uses a single-process lifecycle:

- The tray/API app is the only long-running local process.
- The extension probes the HTTP API only; it does not wake the app through Native Messaging.
- The legacy watcher and Native Messaging bootstrap are cleanup-only compatibility paths.
- The tray/API host exits when all top-level Google Chrome browser processes are gone.
- If the target extension disappears while the tray/API host is already running, the tray/API host shuts down.

## Designated Entry Files

本地 app 高层入口仍然固定为：

- 本地 app 主程序文件：
  - `app/src/main.rs`
- 本地 app 后台维护文件：
  - `app/src/lifecycle/host.rs`
- 本地 app 旧 watcher 清理文件：
  - `app/src/lifecycle/watcher.rs`

职责边界调整为：

- `main.rs`
  - 模式分发入口
  - host 生命周期入口
  - API / tray / host 运行时的总装配
- `host.rs`
  - host 单实例
  - 扩展安装检测
  - host 运行期间的扩展卸载关闭监控
- `watcher.rs`
  - 不再负责 Chrome 跟随启动
  - 不再补拉 host
  - 旧 `--watcher` 入口只负责清理历史 Windows Run 自启动项后退出

## Process Model

The app now accepts these modes:

- Normal launch / `--host`
  - Real tray application.
  - Owns the HTTP API and system tray icon.
  - Monitors top-level Chrome browser process count.
  - Re-checks extension installation state while running.
  - If all top-level Chrome browser processes stay gone for a short grace window, it exits.
  - If the extension is no longer installed, it exits.
- Native Messaging compatibility path
  - Chrome launches the executable as a Native Messaging host.
  - Detected by the `chrome-extension://...` origin argument.
  - Cleans stale Native Messaging registration.
  - Writes a disabled response and exits.
  - It never starts `--host` or any other background child process.
- `--watcher`
  - Legacy compatibility only.
  - Removes the old Windows Run watcher registration and exits.

## Default Launch Behavior

Launching the executable without arguments does this:

1. Remove the old watcher Windows Run entry if it exists.
2. Remove the old Native Messaging registration and portable manifest if they exist.
3. If Chrome is already running and the extension is installed, continue as the tray/API host.
4. If Chrome is not running, or the extension is not installed, exit.

Uninstalling the extension must leave no wake path behind.

## Extension API Flow

The extension-side HTTP client does not own wakeup:

1. Try `/api/v1/extension/register`.
2. If registration cannot connect, mark the local app as unavailable for this probe.
3. Normal API calls continue only after registration succeeds over `http://127.0.0.1:45831` with the extension-origin header.

The existing HTTP API is the only data/control channel between extension JS and local app.

## Registration

Legacy Native Messaging state is removed from:

- `<app-dir>\portable\native-messaging\com.zero_latency_web.app.json`

Legacy registry state is removed from:

- `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.zero_latency_web.app`

On app startup, or if Chrome invokes the legacy Native Messaging path:

- `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.zero_latency_web.app` is removed.
- `<app-dir>\portable\native-messaging\com.zero_latency_web.app.json` is removed if present.
- A Native Messaging wake request is rejected instead of spawning `--host`.

## Debug Force Host

Debug force startup is intentionally non-persistent:

- Supported switch: `ZLW_DEBUG_FORCE_HOST=1`
- Unsupported after the cleanup fix: portable `debug-force-host.txt`

The file-based backdoor was removed because a stale portable file can bypass extension-install
detection after uninstall and keep the local app/window manager active.

## Manual Exit Behavior

Clicking `Exit` from the tray shuts down the current host process.

Because there is no always-on watcher and no extension wake path anymore, manual exit is not immediately undone by the local app.
