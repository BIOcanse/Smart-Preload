# Zero-Latency Web Local App

Windows tray app that exposes local hardware and performance data for the Chrome extension.

## Current scope

- System tray resident app with an `Exit` menu item
- Local HTTP API on `127.0.0.1:45831`
- Portable local AI runtime management under the app directory:
  - portable runtime directory: `<app-dir>\\portable\\runtime\\ollama`
  - portable model directory: `<app-dir>\\portable\\models\\ollama`
- Single-process lifecycle:
  - the local app is launched directly as the tray/API host
  - the extension only probes the HTTP API and never starts a background helper process
  - tray/API host exits after all top-level Google Chrome browser processes are gone
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
- `GET /api/v1/ai/status`
- `POST /api/v1/ai/models/install`
- `POST /api/v1/ai/models/uninstall`
- `POST /api/v1/ai/infer`

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

## Lifecycle

- First launch removes any legacy watcher startup entry and stale Native Messaging host manifest.
- The extension does not wake the tray/API host; the app must already be running before local-only features are used.
- The tray/API host exits automatically when all top-level Google Chrome browser processes are closed.
- Running the executable without arguments is the normal entry point.

Detailed lifecycle notes are in [`docs/Local-App-Lifecycle.md`](../docs/Local-App-Lifecycle.md).

## AI runtime management

The local app now manages the local AI runtime and model files as portable assets inside the app
directory instead of installing them into system-level locations.

It also exposes a generic local model invocation API. Prompt composition, page/context business
logic, and result interpretation are owned by the extension JS layer, not by the local app.

Current runtime:

- `ollama-runtime`

Current managed models:

- `Qwen3 0.6B`
- `Qwen3 1.7B`
- `Qwen3 4B`
- `Gemma 4 E2B`
- `Gemma 4 E4B`

Download flow:

- If a selected model is requested and the portable runtime is missing, the app downloads and
  unpacks the portable runtime first.
- The app then starts the local runtime from its own directory and pulls the selected model into
  the local model directory.

Status flow:

- Reading model/runtime status is passive.
- A status read does not automatically boot the portable runtime.
- The app does not treat an arbitrary `127.0.0.1:11434` responder as usable.
- The Ollama API is considered ready only when the running process is the portable runtime owned by this app.
- If a system/default Ollama instance is already occupying `127.0.0.1:11434`, the app refuses to reuse it because that would break portable model path and lifecycle guarantees.
- The runtime is only started by install / uninstall / infer paths that actually need it.

Delete flow:

- When a selected model is removed, the app deletes that model from the portable model directory.
- If no managed models remain, the app removes the portable runtime and model directories.
