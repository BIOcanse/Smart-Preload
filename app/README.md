# Zero-Latency Web Local App

Windows tray app that exposes local hardware and performance data for the Chrome extension.

## Current scope

- System tray resident app with an `Exit` menu item
- Local HTTP API on `127.0.0.1:45831`
- No local AI runtime/model management. AI provider keys and inference calls are owned by the extension.
- Portable install lifecycle:
  - `zero-latency-web-app.exe --install` writes HKCU registry entries that point to the current portable directory
  - the extension can wake the app through Chrome Native Messaging when the HTTP API is offline
  - Native Messaging is only a short-lived launch bridge; the tray/API host remains the only long-running app process
  - tray/API host exits after all top-level Google Chrome browser processes are gone
  - tray/API host also exits if the registered target extension disappears while Chrome remains open
- Hardware snapshot:
  - CPU model, manufacturer, cores, clock
  - Memory size, module count, per-module speed and DDR generation
  - GPU list
  - Disk list
- Performance snapshot:
  - Overall CPU usage
  - Overall memory usage ratio and free bytes
  - Overall GPU usage when the Windows GPU performance counters are available
  - Chrome process count, CPU usage, memory usage, GPU usage

## Endpoints

- `GET /health`
- `GET /api/v1/system/hardware`
- `GET /api/v1/system/performance`
- `GET /api/v1/system/snapshot`
- `GET /api/v1/system/activity`
- `GET /api/v1/windows/chrome`
- `POST /api/v1/windows/hide`
- `POST /api/v1/windows/show`

The API is intended for the extension bridge on `chrome-extension://...` origins.
Normal web-page origins are not permitted to call these endpoints.

## Local debug access

For local debugging, you can opt in to a token-protected backdoor:

1. Create:
   - `<app-dir>\\portable\\debug-api-token.txt`
2. Put a non-empty token string in that file
3. Restart the local app
4. Send requests with:
   - header: `X-ZLW-Debug-Token: <your-token>`

Behavior:

- Requests with a valid debug token are accepted even without a `chrome-extension://...` origin
- Local browser-based debugging is also allowed from:
  - `http://127.0.0.1:<port>`
  - `http://localhost:<port>`
- If the token file does not exist, this debug path is disabled

## Build

This app currently targets Windows and uses the Rust GNU toolchain plus MinGW/WinLibs.

Example:

```powershell
winget install --id BrechtSanders.WinLibs.MCF.UCRT --accept-package-agreements --accept-source-agreements --disable-interactivity
$env:PATH = "$env:USERPROFILE\.cargo\bin;C:\Users\$env:USERNAME\AppData\Local\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.MCF.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin;$env:PATH"
$env:CARGO_TARGET_DIR = 'D:\cargo-target\zero-latency-web-app'
cargo build
```

## Run

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;C:\Users\$env:USERNAME\AppData\Local\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.MCF.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin;$env:PATH"
$env:CARGO_TARGET_DIR = 'D:\cargo-target\zero-latency-web-app'
cargo run
```

## Portable install

The app stays portable: files remain in the extracted directory. Install and uninstall only update
per-user registry state under HKCU.

```powershell
zero-latency-web-app.exe --install
zero-latency-web-app.exe --status
zero-latency-web-app.exe --uninstall
```

Install writes:

- `HKCU\Software\ZeroLatencyWeb`
- `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.zero_latency_web.app`
- `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.zero_latency_web.app`
- `<app-dir>\portable\native-messaging\com.zero_latency_web.app.json`
- `<app-dir>\portable\allowed-extension-origin.txt`
- `<app-dir>\portable\allowed-extension-origins.txt`

If Native Messaging is not registered in the status output, install or enable the browser
extension first, then run `install-register.cmd` again. The extension cannot wake the local app
until the browser has a registered Native Messaging host whose manifest allows that extension ID.

`install-register.cmd` also checks whether the existing registry registration points to a
different portable app directory. If the old directory looks like a Zero-Latency Web app package
by filename and file type, the script can stop the old tray process and delete that old directory
after the new registration succeeds.

Run `--install` again after moving the portable app directory or after reinstalling the extension
with a different Chrome extension ID.

## Lifecycle

- First launch removes any legacy watcher startup entry.
- The extension wakes the tray/API host through Native Messaging when installed registration exists.
- The tray/API host exits automatically when all top-level Google Chrome browser processes are closed.
- The tray/API host exits automatically if the registered extension is removed while Chrome is still running.
- Running the executable without arguments is a cleanup-compatible entry point; the active host normally starts through Native Messaging wake or explicit `--host`.

Detailed lifecycle notes are in [`docs/Local-App-Lifecycle.md`](../docs/Local-App-Lifecycle.md).

## AI provider boundary

The local app does not download models, install runtimes, store API keys, or expose AI inference
routes. The extension service worker owns prompt composition and provider calls. Prediction scoring
and ranking remain extension-side, with the Rust/Wasm engine owning the compute-heavy graph and
prediction core.

For local models, run an external OpenAI-compatible tool such as LM Studio and configure its
endpoint/key in the extension settings.
