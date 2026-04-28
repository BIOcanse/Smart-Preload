# Debug Runbook 2026-04-20

## Confirmed bugs

1. `preload/rules.js` treated `maxTargets === null` as `0`
   - Root cause: `Number.isFinite(Number(maxTargets))` returns `true` for `null` because `Number(null) === 0`.
   - Impact:
     - JS fallback path sliced candidates with `slice(0, 0)`.
     - Wasm filter input also received `maxTargets: 0` instead of `null`.
   - Symptom:
     - `candidatePool` contained valid GitHub entries.
     - `applyOrderedPreloadRules*` returned an empty array.

2. Windows path spaces repeatedly broke debug browser startup
   - Paths under `D:\Code\Chrome extension\...` are unsafe in ad-hoc browser launch commands.
   - Broken launches produced misleading states:
     - remote debug browser started but extension path was parsed incorrectly
     - bogus targets like `http://extension/...`
     - wrong conclusion that extension/runtime logic had failed

5. App-side Rust builds do not emit to `app\target\...` in this repo
   - `.cargo/config.toml` redirects the real target dir to `D:\tmp\zlw-build`.
   - `app\target\debug\zero-latency-web-app.exe` can be stale and must not be trusted for host testing.
   - Before validating local-app changes, confirm the running host path from `Get-NetTCPConnection` + `Get-Process`.

3. Google search results expose outbound anchors as DOM `target="_blank"`
   - Root cause:
     - Google result anchors often declare `_blank` in the DOM even when the intended primary-click UX is effectively "leave search results and view the result page".
     - Our content script previously trusted raw anchor `target` for both prediction and click interception.
   - Impact:
     - candidate strategy was downgraded from `hidden-tab` to `prefetch`
     - click handling reserved a blank window too early, producing stray `about:blank` flashes/tabs

4. User override new-tab actions polluted default link-behavior learning
   - Root cause:
     - `Ctrl`/`Shift`/middle-click paths were recorded as normal `_blank` behavior
     - `onCreatedNavigationTarget` then reinforced the same `_blank` learning
   - Impact:
     - later plain left-clicks were misclassified as "open new tab"
     - Google search -> GitHub became stuck on the prefetch/new-tab path instead of current-tab replacement

## Confirmed debugging facts

1. Google search page candidate extraction is not the main blocker
   - Content script already filters same-query Google search mode links like `AI 模式`, `图片`, `视频`.
   - Real outbound result links such as `https://github.com/` do enter the candidate message.

2. Tracking graph learning works on the Google -> GitHub path
   - Edge counts increased correctly for:
     - `https://www.google.com/search -> https://github.com`
     - `https://github.com -> https://www.google.com/search`

3. Current failure point is in preload candidate selection / extension reload behavior
   - Candidate scoring works.
   - Preload runtime still ends with empty `preloadState`.
   - Need to distinguish:
     - extension worker still running old cached code
     - unpacked extension reload not consistently picking latest disk files
     - service worker cold-start / registration failure after reload

## Stable local debug setup

Use no-space junction paths for repeatable browser startup:

- Extension junction: `D:\Code\ChromeExtExt`
- Profile junction: `D:\Code\ChromeExtProfile`

Recommended browser launch pattern:

```powershell
$exe = 'C:\Users\kings\AppData\Local\ms-playwright\chromium-1217\chrome-win64\chrome.exe'
$profile = 'D:\Code\ChromeExtProfile'
$ext = 'D:\Code\ChromeExtExt'
Start-Process -FilePath $exe -ArgumentList @(
  "--user-data-dir=$profile",
  '--remote-debugging-port=9444',
  '--no-first-run',
  '--no-default-browser-check',
  "--disable-extensions-except=$ext",
  "--load-extension=$ext",
  'https://www.google.com/search?q=github'
)
```

## Rules for future debugging in this repo

1. Do not trust a browser restart alone to prove the unpacked extension picked up disk changes.
   - Always verify by reading `functionName.toString()` from the live service worker.

2. Do not use spaced paths in Chrome launch arguments.
   - Use junctions or another no-space path alias first.

3. When preload targets are empty, inspect the chain in this order:
   - content script `links`
   - `candidatePool`
   - `applyOrderedPreloadRulesWithWasm`
   - `applyOrderedPreloadRulesFallback`
   - `applySiteSelectionToPreloadCandidatePool`
   - `buildCurrentPreloads(preloadState, tabId)`

4. When a service worker disappears after `chrome.runtime.reload()`, do not keep poking the dead worker.
   - Wake it from a page reload or restart the isolated browser cleanly.

5. When debugging click behavior, always separate three concepts:
   - raw DOM anchor target
   - managed target used by the extension for preload/intercept decisions
   - learned default target behavior stored from real navigations

6. Do not let modifier-managed new-tab actions update default link behavior.
   - They are user overrides, not the page's default navigation contract.

7. Hidden-window visibility debugging now has an app-side source of truth.
   - Query `GET /api/v1/windows/hidden-monitor`.
   - The snapshot records:
     - whether a tracked hidden window was ever visible since tracking started
     - whether it was ever visible on-screen
     - the estimated visible duration based on the 100 ms monitor cadence
     - recent visibility episodes with start/end timestamps
   - Current limitation:
     - flashes shorter than the 100 ms monitor interval can still be missed.
     - if we later need near-lossless detection, upgrade to `SetWinEventHook(EVENT_OBJECT_SHOW/_HIDE)`.

## 2026-04-20 Evening follow-up

### Newly confirmed root causes that were fixed

1. `tabs.create({ index: -1 })` is invalid for preload priming
   - Location:
     - `extansion/background/preload/runtime/window-manager/priming.js`
   - Symptom:
     - `registerCandidates()` returned `ok: true` and `preloadedCount > 0`
     - `preloadState` stayed empty
   - Root cause:
     - The real exception was swallowed by `queueMutation()`
     - Chrome rejected `tabs.create` because `createProperties.index` must be `>= 0`
   - Fix:
     - Removed `index: -1` from `chrome.tabs.create(...)`

2. Chrome rejected preload-window off-screen creation bounds
   - Location:
     - `extansion/background/preload/runtime/window-manager/creation.js`
   - Symptom:
     - `Zero-Latency mutation failed. Error: Invalid value for bounds. Bounds must be at least 50% within visible screen space.`
   - Root cause:
     - The current Chrome build no longer accepts the old `left/top = -32000` create-time trick
   - Fix:
     - System-hide path now creates the window as normal and lets the native app hide it immediately
     - It no longer relies on invalid create-time off-screen bounds

3. Stored preload HWND value `0` short-circuited real HWND detection
   - Location:
     - `extansion/background/preload/runtime/window-manager/creation.js`
   - Symptom:
     - preload window existed
     - native hide did not attach
     - `hiddenBySystem` stayed `false`
     - app hide request effectively tried `hwnd: 0`
   - Root cause:
     - `normalizeFiniteNumber(0)` treated `0` as a valid HWND and prevented the newer-window detection path from running
   - Fix:
     - Added positive-HWND normalization for the native-hide path
     - `0` is now treated as “no HWND yet”, which allows real HWND discovery to proceed

### Controlled test results after the fixes

1. Hidden-tab preload now lands correctly
   - In the isolated test browser:
     - Google search candidate registration produced hidden-tab targets
     - `preloadStateV1` persisted a paired preload window plus loaded hidden tabs

2. Native hide now attaches correctly
   - Result:
     - `preloadWindow.hiddenBySystem === true`
     - a real positive HWND is stored
     - app snapshot shows `hookInstalled === true`
     - app snapshot tracks the preload HWND

3. During controlled preload creation and controlled activation, no show/hide flash was detected
   - Test path A:
     - create preload window
     - hide via native app
     - load hidden tabs
   - Test path B:
     - activate a ready preloaded GitHub tab via `activateIfReady(...)`
   - Observed result in both:
     - `wasVisibleSinceTracked === false`
     - `wasOnScreenSinceTracked === false`
     - no `visibilityEpisodes`
     - no hook events recorded for the tracked preload HWND
   - Current interpretation:
     - in this controlled profile, the preload window did not visibly flash during create or activation

### Still-open debugging note

1. Synthetic CDP mouse click on the Google result did not reproduce the preload activation path
   - The direct background activation path works
   - The DOM-click reproduction under CDP did not switch the foreground tab in the same way
   - Treat this as a reproduction-path gap for now, not proof that the runtime activation path is broken

## 2026-04-20 Late-night follow-up

### Newly fixed state / error propagation bugs

1. Preload state no longer turns `null` IDs into `0`
   - Locations:
     - `extansion/background/shared/base.js`
     - `extansion/background/preload/state/model.js`
     - `extansion/background/preload/state/normalize/*.js`
     - `extansion/background/preload/state/view.js`
     - `extansion/background/shared/native-app/windows.js`
     - `extansion/background/preload/runtime/window-manager/hiding.js`
   - Root cause:
     - multiple preload-state paths used `Number.isFinite(Number(value))`
     - `Number(null) === 0`, so cleared `windowId` / `tabId` / `hwnd` fields silently came back as fake valid values
   - Impact:
     - cleared preload windows could look like `windowId: 0`, `hwnd: 0`
     - native hide/show calls and state-derived UI/debug views could make decisions from bogus IDs
   - Fix:
     - added positive-only normalization helpers
     - preload IDs now accept only positive integers
     - HWNDs now accept only positive finite numbers

2. `queueMutation()` and `queueSideEffect()` no longer hide failures from callers
   - Location:
     - `extansion/background/core/state/container.js`
   - Root cause:
     - the queue stored only the `.catch(...)` chain
     - caller-facing promises always resolved after logging
   - Impact:
     - operations like invalid `tabs.create(...)` appeared to succeed
     - higher-level flows kept running with partially applied state
   - Fix:
     - returned promise now preserves the original rejection
     - internal queue still catches and logs so later tasks can continue

### Re-test after reloading the unpacked extension

1. Google search -> hidden preload window creation still works after the normalization + queue fix
   - Observed state before click:
     - foreground Google result tab stayed in the normal window
     - preload window had a real positive `windowId`
     - tracked preload window had a real positive `hwnd`
     - GitHub targets were loaded as hidden tabs, not downgraded to prefetch/prerender

2. Real click on the first GitHub result still performs current-tab replacement
   - Observed state after click:
     - only one foreground tab remained in the user window
     - that tab was the preloaded GitHub tab moved into the foreground window
     - the original Google tab was removed
     - no stray `about:blank` or duplicate GitHub tab remained

3. Hidden-window monitor still showed no visibility episode in the isolated test browser
   - During the above end-to-end run:
     - `recentHookEvents` stayed empty
     - tracked hidden window list was empty after cleanup
   - Current interpretation:
     - in the isolated debug profile, preload create/hide/activate/cleanup did not surface a visible hidden-window flash

## 2026-04-21 Clean Edge follow-up

### Newly confirmed runtime pollution paths

1. Hidden-tab preload tabs can beat `preloadState` persistence and send page messages too early
   - Symptom:
     - freshly created hidden-tab preload pages were treated as normal source pages
     - they started candidate registration before their `tabId` was durably stored
   - Fix:
     - added an in-memory preload runtime registry
     - preload windows / preload tabs are marked immediately on creation
     - background message interception and candidate registration now ignore sender tabs/windows already known to be preload runtime

2. Native `prerender` pages reused the visible tab id during content-script messaging
   - Symptom:
     - the prerendered `docs.html` page on Site A sent `preload:register-candidates`
     - background treated that message as if it came from the visible `index.html` tab
     - valid hidden-tab target `Site B` was removed and replaced by a bogus self-target
   - Fix:
     - page-side content script now suppresses candidate scans, page digests, and click priming while `document.prerendering === true`
     - it reschedules normal reporting after `prerenderingchange`

### Current clean-instance result after the fixes

1. Site A now keeps the expected mixed candidate set before click
   - `preTop` shows:
     - native `prerender`: `http://127.0.0.1:8000/docs.html`
     - real-tab `hidden-tab`: `http://127.0.0.1:8001/dest.html`
   - `knownPreloadRuntime` shows exactly:
     - one preload window id
     - one preload tab id

2. Cross-site current-tab replacement now hits in the isolated Edge profile
   - Debug events show:
     - `navigation.click.cross-site-current-tab.activation-attempt`
     - `preload-activation.success`
     - `navigation.click.cross-site-current-tab.activation-hit`

3. Window state after click matches the intended architecture
   - foreground normal window:
     - one active `Site B Destination` tab
   - preload window:
     - minimized
     - sentinel `about:blank#zero-latency-preload-window`
     - one hidden-tab preload for return path `Site A Home`
   - no duplicate destination tab remained in the validated run

### App instrumentation update

1. Local app monitor routes are now reachable again
   - Confirmed live routes:
     - `GET /api/v1/windows/hidden-monitor`
     - `GET /api/v1/windows/monitor-snapshot`
     - `POST /api/v1/windows/monitor-snapshot-read`
   - Current result on a fresh host:
     - `hookInstalled === false` until the first real hidden-window tracking session starts
     - route no longer returns `404`

2. Local app now persists cross-process runtime events under the portable directory
   - File:
     - `D:\tmp\zlw-build\debug\portable\app-runtime-events.jsonl`
   - Scope coverage now includes:
     - `watcher`
     - `host`
     - `api`
     - `hidden-window`
   - The monitor snapshot now exposes `recentRuntimeEvents` in addition to the per-window hook / lifecycle data.

3. Extension-side native-app traffic is now visible in the debug event stream
   - Added event families:
     - `native-app.registration.*`
     - `native-app.request.*`
     - `native-app.windows.hide.*`
     - `native-app.windows.show.*`
     - `native-app.windows.monitor.*`
   - Use this together with `recentRuntimeEvents` to correlate:
     - extension registration
     - native request start/fail/success
     - app-side hide/show handling

## 2026-04-21 System-hide isolated regression

1. System-level hidden-tab preload now works end-to-end in the clean Edge profile
   - Verified from `output/playwright/edge-live-system-hide.json`:
     - `systemLevelWindowHidingUsable === true`
     - `pageContext.preloadWindowHiddenBySystem === true`
     - `currentPreloadWindowMonitor !== null`
     - click path records:
       - `navigation.click.cross-site-current-tab.activation-attempt`
       - `preload-activation.success`
       - `navigation.click.cross-site-current-tab.activation-hit`

2. The hidden preload window still was not observed on-screen
   - App-side monitor for the tracked preload HWND shows:
     - `wasVisibleSinceTracked === false`
     - `wasOnScreenSinceTracked === false`
     - empty `hookEvents`
     - empty `visibilityEpisodes`

3. Repeated native hide calls were being caused by runtime maintenance, not by Win32 failure
   - Before the fix:
     - watchdog / ensure / maintain paths kept reissuing `/api/v1/windows/hide` against an already hidden HWND
   - Fixes:
     - `creation.js` now skips system re-hide when the preload window is already known hidden and still has a live HWND
     - `hiding.js` now treats system-hidden maintenance as a no-op unless the caller explicitly requests `forceRefresh`
     - window-bounds change remains the only explicit forced refresh path

4. Settings-page AI model status polling was a false lead, but still hardened
   - `ai-models.js` now avoids writing model-manager settings back to storage when native status did not actually change.
   - This removes unnecessary storage churn even though the main repeated-hide loop turned out to be watchdog/maintenance driven.

5. App-side monitor logs are now less noisy
   - `track_hidden_window()` records `track` only when a HWND enters monitoring for the first time.

## 2026-04-21 Bounds-change hide dedupe

1. Remaining duplicate system-hide requests came from Edge firing two early `windows.onBoundsChanged` events per preload window
   - Captured in `output/playwright/edge-live-system-hide-trace.json`
   - Per new preload window the event sequence was:
     - first bounds event at `1296x1020`
     - immediate second bounds event at `1296x1034`
     - both previously forced `/api/v1/windows/hide`
   - This explained the residual `3 hides per created preload window` pattern:
     - initial system hide during create
     - first bounds-change refresh
     - second bounds-change refresh

2. System-hidden bounds refresh is now debounced and deduped per bounds signature
   - `background/preload/runtime/lifecycle/windows.js` now:
     - schedules system-hidden bounds refreshes with a `75ms` debounce
     - collapses the two startup bounds changes into one refresh
     - avoids repeating refresh for the same applied bounds signature
   - Trigger label for the surviving refresh is now:
     - `bounds-changed-debounced`

3. Isolated Edge regression after the debounce reduced native hide traffic again
   - Latest clean run result:
     - `native-app.windows.hide.result`: `4`
     - `preload-window.hide.system-refresh-attempt`: `2`
     - one debounced refresh per created preload window instead of two
   - App-side runtime events now show:
     - initial hide on sentinel window creation
     - one later hide after the window settles with the real tab count in the title

4. Hidden-window visibility result stayed clean after the debounce
   - In the same isolated run:
     - `systemLevelWindowHidingUsable === true`
     - `preloadWindowHiddenBySystem === true`
     - `wasVisibleSinceTracked === false`
     - `wasOnScreenSinceTracked === false`
     - `hookEvents.length === 0`
     - `visibilityEpisodes.length === 0`

## 2026-04-22 Hidden-window stability test

1. App-side monitor snapshot now exposes structured tool-window stability fields
   - Added per tracked window:
     - `currentlyToolWindow`
     - `wasToolWindowMissingSinceTracked`
     - `toolWindowMissingObservationCount`
     - `estimatedToolWindowMissingDurationMs`
     - `lastSeenToolWindowMissingAtMs`
   - Added per hook event:
     - `currentlyToolWindow`
   - This removes the need to infer tool-window loss from free-form lifecycle detail strings.

2. Stability harness now combines event monitoring with external polling
   - Artifact:
     - `output/playwright/edge-hidden-window-stability.json`
   - Method:
     - clean isolated Edge profile
     - extension reset before run
     - `8` alternating cross-site replacement cycles between Site A and Site B
     - app monitor snapshot polled every `100ms`
     - each tracked hidden HWND aggregated across:
       - visible / on-screen state
       - tool-window state
       - hook events
       - lifecycle rehide events

3. Latest stability run stayed clean across all tracked hidden preload windows
   - Aggregate result:
     - `trackedWindowCount = 8`
     - `hiddenStateEscapeCount = 0`
     - `visibleEscapeCount = 0`
     - `toolWindowLossCount = 0`
     - `lifecycleRehideCount = 0`
     - `hookRehideCount = 0`
     - `pollSampleCount = 197`
     - `pollErrorCount = 0`

4. Current interpretation
   - With the current debounce on bounds-change refresh and the new structured monitor fields, this run did not observe any case where a hidden preload window:
     - became visible after creation
     - appeared on-screen after creation
     - lost `WS_EX_TOOLWINDOW` after creation
     - triggered a hook-driven or monitor-driven rehide repair after creation

## 2026-04-22 Pre-hide visibility root cause

1. The earlier monitor still missed one critical interval
   - Previous tracking began only after `/api/v1/windows/hide` succeeded.
   - That meant the monitor could prove:
     - the window stayed hidden after the hide request completed
   - But it could not prove:
     - whether the newly created preload window was already visible before the first hide request landed

2. App-side monitor now records first-match pre-hide state
   - Added per tracked window:
     - `firstHideRequestedAtMs`
     - `lastHideRequestedAtMs`
     - `hideRequestCount`
     - `firstHideMatchVisible`
     - `firstHideMatchOnScreen`
     - `firstHideMatchToolWindow`
   - This captures the Chrome window state at the moment the native helper first matches that window for hiding.

3. Root cause confirmed in the stability trace
   - Artifact:
     - `output/playwright/edge-hidden-window-stability.json`
   - Result before warm-window retention:
     - `trackedWindowCount = 8`
     - `preHideVisibleCount = 8`
     - `preHideToolWindowMissingCount = 8`
     - `hiddenStateEscapeCount = 0`
   - Interpretation:
     - every newly created preload window was first matched while still visible and on-screen
     - after the hide request completed, it stayed hidden cleanly
   - This explains the user-visible flash while still being consistent with the earlier post-hide monitor showing no later visibility episodes.

4. Warm-window retention materially reduces visible flashes
   - Change:
     - `background/preload/runtime/policy/watchdog.js`
     - `shouldKeepWarmPreloadWindow()` now keeps the preload window alive instead of closing it whenever the current hidden-tab set becomes empty.
   - Re-run result after enabling warm-window retention:
     - `trackedWindowCount = 1`
     - `preHideVisibleCount = 1`
     - `preHideToolWindowMissingCount = 1`
     - no post-hide visibility/tool-window regressions observed
   - Interpretation:
     - the repeated flash is reduced to the first warm-window creation
     - subsequent navigations reuse the same hidden window instead of creating a new visible one every cycle
