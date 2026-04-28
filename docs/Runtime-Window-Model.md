# Runtime Window Model

## Purpose

The preload runtime is organized around normal Chrome windows.
Each normal window owns one runtime object, and that object owns:

- the paired hidden preload window
- the source tabs that belong to the normal window
- the preload data generated for those source tabs

This keeps preload behavior window-scoped instead of mixing every source tab into one global state bag.

## Stored Shape

`preloadStateV1` now uses this structure:

```json
{
  "version": 2,
  "normalWindowsById": {
    "101": {
      "normalWindowId": 101,
      "preloadWindow": {
        "windowId": 202,
        "hwnd": 12345678,
        "hiddenBySystem": true,
        "updatedAt": "2026-04-15T21:30:00.000Z"
      },
      "sourceTabs": {
        "303": {
          "sourceTabId": 303,
          "hiddenTabEntriesByUrl": {},
          "prerenderEntriesByUrl": {},
          "prefetchEntriesByUrl": {},
          "updatedAt": "2026-04-15T21:30:00.000Z"
        }
      },
      "updatedAt": "2026-04-15T21:30:00.000Z"
    }
  },
  "updatedAt": "2026-04-15T21:30:00.000Z"
}
```

## Ownership Rules

- One normal window maps to one runtime object.
- One runtime object may own one hidden preload window.
- Source tabs are nested inside their normal window runtime.
- Hidden-tab preloads, prerender candidates, and prefetch candidates are nested inside the source tab runtime.
- Hidden preload tabs are only considered preload/container tabs while they remain registered inside `hiddenTabEntriesByUrl`.

## Runtime Flow

1. Content scripts collect candidate links for a normal source tab.
2. Prediction selects targets from the tracking graph.
3. The runtime writes those targets into the source tab runtime that belongs to the source tab's normal window.
4. Cross-site hidden-tab preloads are created inside the hidden preload window paired with that same normal window.
5. Same-origin prerender/prefetch targets stay as synthetic entries inside the same source tab runtime.
6. When a real click activates a hidden preloaded tab, the click is recorded first, then the real tab is moved into the normal window, and finally the source tab runtime is cleared.

This flow should be read together with the algorithm workflow:

- the hidden preload window is a real browser-layer container
- future visibility control belongs to the system layer via Native Messaging and Win32 `ShowWindow`
- the long-term target direction is full hidden control, not minimize-and-repair

## Cleanup Rules

- Closing a source tab clears that source tab runtime and its hidden preload tabs.
- Closing a normal window clears the whole normal-window runtime and any hidden preload tabs it owned.
- Closing a hidden preload window only clears the paired `preloadWindow.windowId`; the runtime object stays alive if source-tab data still exists.
- Error-state cleanup is applied per normal window runtime, not globally.

## Window Visibility Control

The preload window now supports two visibility control paths:

### System-level hiding (primary, when native app is available)

1. Extension creates the preload window with `state: "normal"` at off-screen coordinates.
2. Extension sends `POST /api/v1/windows/hide` to the native app with the window's bounds.
3. Native app finds the matching Chrome window via `EnumWindows` + `Chrome_WidgetWin_1` class name + bounds matching.
4. Native app calls `ShowWindow(hwnd, SW_HIDE)` to make it completely invisible at the OS level.
5. The HWND is stored in `preloadWindow.hwnd` and `hiddenBySystem` is set to `true`.
6. When this path is active, the watchdog and bounds-changed handler should prefer “按 HWND / 实际 bounds 再次执行系统级隐藏”，而不是直接退回普通最小化。

### Known fragility of the current HWND match

- Class-name matching against `Chrome_WidgetWin_1` is not unique: popups and some dialogs use `Chrome_WidgetWin_0`.
- Bounds matching is timing-sensitive: Chrome may shift the window by a few pixels between `windows.create` returning and the native app scanning.
- There is also a race: the target HWND may not yet be classed when the scan runs.

The planned upgrade path is:

1. Extension creates the preload window with a unique throwaway title (for example a random UUID).
2. Native app matches by `GetWindowText` equality, which is unique by construction.
3. Once the HWND is captured, extension clears the throwaway title back to empty (or Chrome's default).

This removes bounds matching from the identity path entirely and eliminates the class / timing ambiguity.

### Handling Chrome's automatic re-show

- Chrome may call `SW_SHOW` on its own windows in response to internal events (new tab created inside it, navigation commit, DevTools opened).
- A single `ShowWindow(SW_HIDE)` call is not sufficient for a long-lived preload window.
- The native app should also:
  - Apply `WS_EX_TOOLWINDOW` so the preload window is excluded from the taskbar and Alt+Tab.
  - Keep off-screen coordinates as a second safety net.
  - Subscribe to `SetWinEventHook(EVENT_OBJECT_SHOW)` for the tracked HWND and re-apply `SW_HIDE` whenever Chrome brings it back.
- Hiding must therefore be treated as a maintained policy, not a one-shot call.

当前代码已经做了两步：

- 创建后记录真实 `hwnd`
- 在 watchdog / bounds-changed 链里，优先按 `hwnd` 或实际 bounds 再次请求系统级隐藏

`SetWinEventHook(EVENT_OBJECT_SHOW)` 这条还属于后续增强目标，目前还没有落地。

### Detecting whether a hidden preload window flashed during a period

The native app now keeps a monitor record for every HWND it is currently hiding.

Current implementation:

1. The WindowManager monitor thread samples each tracked HWND every `100 ms`.
2. For each sample it records:
   - whether the HWND is visible at all
   - whether its rect intersects the current virtual desktop bounds
3. When a hidden window becomes visible, the monitor:
   - appends or updates a visibility episode
   - records the latest visible/on-screen timestamps
   - immediately re-applies tool-window mode and `SW_HIDE`
4. The extension/debug layer can query `GET /api/v1/windows/hidden-monitor` to inspect:
   - `wasVisibleSinceTracked`
   - `wasOnScreenSinceTracked`
   - `estimatedVisibleDurationMs`
   - `visibilityEpisodes[]`

Interpretation:

- If the question is “has this hidden preload window shown at all since we started hiding it?”, use `wasVisibleSinceTracked`.
- If the question is “did the user have a chance to actually see it on screen?”, use `wasOnScreenSinceTracked` and the episode list.
- If the question is “did it show during a specific period?”, test whether that period overlaps any `visibilityEpisodes` interval for the tracked HWND.

Known limit:

- This is a monitor-interval detector, not a true event hook.
- A flash shorter than the `100 ms` cadence can still be missed.
- If we later need near-lossless flash detection, replace or augment this with `SetWinEventHook(EVENT_OBJECT_SHOW / EVENT_OBJECT_HIDE)`.

### Minimize fallback (legacy, when native app is unavailable)

1. Extension creates the preload window with `state: "minimized"`.
2. Watchdog periodically re-minimizes the window if it gets restored.
3. `forceMinimize` setting controls whether bounds-changed events trigger re-minimize.

This document now treats minimize-based visibility as the fallback path, not the target architecture.

## Wasm Boundary

Rust/Wasm remains the calculation core for the visit graph.
It is intentionally not responsible for UI state or preload window orchestration.

The JS side owns:

- normal-window runtime objects
- source-tab runtime objects
- hidden preload windows and tabs
- page-level derived indexes
- popup/settings/debug presentation
- browser/runtime orchestration around `chrome.windows.*` and `chrome.tabs.*`

The Wasm side owns:

- transition message ingestion
- node/edge normalization
- transition count buckets
- transition message buckets
- compact query access into the site-level graph

The next internal split inside Wasm should be:

- database/index layer
- filter/scoring layer

The current query interface belongs to the database/index side.

## Wasm Query Interface

The current exported query entry point is `query_state_json`.

Supported query types:

- `get-transition-bucket`
- `get-transition-message-bucket`
- `get-transition-message`
- `get-recent-transition-messages`

These are intentionally low-level graph inspection APIs for visualization, debugging, and future history tools.
They are not meant to own preload policy or UI logic.
