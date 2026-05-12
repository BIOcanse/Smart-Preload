# Logic Sanity Review - Codex - 2026-04-30

Scope: extension service worker, content script click/candidate flow, preload prediction/runtime, settings/i18n, local app lifecycle, Native Messaging, and local HTTP API boundaries.

Verification run:

- `node --check extansion\service-worker.js`
- `node --check extansion\shared\i18n.js`
- `node --check extansion\shared\settings.js`
- `node --check extansion\popup\popup.js`
- `node --check extansion\settings\settings.js`
- `node --check extansion\scripts\navigation-interceptor.js`
- `cargo check` in `app`
- `cargo check` in `extansion\wasm\visit-graph-engine`
- `cargo run -- --status` in `app`

## Fix Pass - 2026-04-30

- Localized manifest detection: fixed in `app/src/lifecycle/host.rs`. The app now accepts `__MSG_appName__` / `__MSG_appDescription__`, the current literal description, and the legacy literal description. Chrome profile scanning also includes nonstandard profile directories that contain `Preferences` or `Secure Preferences`.
- API bootstrap registration: fixed in `app/src/api.rs`. `/api/v1/extension/register` no longer persists the first extension origin when `allowed-extension-origin.txt` is missing. It derives the expected origin from the portable origin file or the detected target extension ID, then rejects mismatches.
- System-hidden preload window creation: fixed in `extansion/background/preload/runtime/window-manager/creation.js`. New preload windows are created minimized first, then system-hidden, instead of being created as visible normal windows.
- Portable Ollama API ownership: fixed in `app/src/model/catalog.rs`, `app/src/model/runtime/process.rs`, and `app/src/model/status/models.rs`. The portable API now uses `127.0.0.1:45832`, and status only treats it as portable-owned after the listening PID resolves to the portable `ollama.exe` path.
- `_blank` placeholder fallback: fixed in `extansion/scripts/navigation-interceptor.js`, `extansion/background/navigation/manager.js`, and `extansion/background/preload/runtime/activation/flow.js`. Reserved `about:blank` tabs get a 500 ms client timeout, and background activation observes the same deadline to avoid late tab moves after fallback.
- Validation note: `cargo run -- --status` still reports `extensionId: null` in this local standard Chrome profile set because no matching extension entry is present in the scanned `Secure Preferences` files. The i18n manifest predicate itself has been updated; validating a non-null ID requires loading/installing the extension into a scanned Chrome profile.

## Original Findings

### P1 - Local app cannot detect the localized extension manifest

Files:

- `app/src/lifecycle/host.rs:6-8`
- `app/src/lifecycle/host.rs:233-252`
- `extansion/manifest.json:3-6`

The local app still identifies the target extension by literal manifest `name` and `description`, but the manifest now uses Chrome i18n tokens:

- `name: "__MSG_appName__"`
- `description: "__MSG_appDescription__"`

The app expects:

- `Zero-Latency Web`
- `Zero-Latency Web extension MVP for visit graph tracking.`

That means `target_extension_id()` returns `None` for the localized manifest. Confirmed by `cargo run -- --status`, which returned `extensionId: null` in the current dev environment. Impact:

- `--install` will skip or remove Native Messaging registration.
- auto/host mode will think the extension is missing and exit.
- extension wake through Native Messaging will not work after reinstall.
- extension-uninstall shutdown checks will be unreliable because the app cannot identify the installed extension.

Recommended fix: stop using localized display fields as identity. Prefer a stable identity predicate based on `background.service_worker`, `options_page`, required permissions, and possibly a dedicated extension marker file or manifest path check. At minimum, accept both raw `__MSG_*__` tokens and resolved legacy strings.

### P1 - System-hidden preload windows are still created as visible normal windows first

File:

- `extansion/background/preload/runtime/window-manager/creation.js:121-134`

When system-level hiding is usable, the code creates the preload window with:

```js
state: useSystemHiding ? "normal" : "minimized"
```

Then it hides the window after `chrome.windows.create()` returns. Chrome cannot create a truly hidden normal window through this API, so this design still has a visible gap and can explain the repeated preload-window flashing. The later `hidePreloadWindowBySystem()` call is a repair, not a prevention.

Recommended fix: create minimized/offscreen first even when system hiding is available, then resolve hwnd and apply system hide before creating or updating preload tabs. If hwnd detection needs a normal window, move that detection into the native app so the browser-level window is not intentionally shown first.

### P2 - First extension registration can still be claimed by the first chrome-extension origin if the portable origin file is missing

Files:

- `app/src/api.rs:55-71`
- `app/src/api.rs:246-248`
- `app/src/api/routes/extension.rs:13-22`

`/api/v1/extension/register` is intentionally the unprotected bootstrap route, but when `allowed-extension-origin.txt` is missing, `register_extension_origin()` persists the first valid `chrome-extension://<id>` origin that calls it. This is mostly safe after a correct `--install`, because install writes the allowed origin first. It is unsafe in these states:

- user runs the portable app before install finishes correctly,
- the portable directory is moved and the origin file is lost,
- install detection fails because of the P1 localized manifest bug,
- stale app binary is launched manually with no portable origin file.

Impact: another installed extension could claim the local app API boundary before the real extension registers.

Recommended fix: registration should derive the allowed extension ID from the app registry or target extension scan, and reject bootstrap origins that do not match. Do not use first-request-wins as an identity source.

### P2 - Portable Ollama ownership is inferred indirectly, not proven by the API endpoint

Files:

- `app/src/model/runtime/process.rs:3-18`
- `app/src/model/status/models.rs:95-101`

`try_get_portable_ollama_version()` checks whether a portable `ollama.exe` process exists, then queries `127.0.0.1:11434/api/version`. That proves a portable process exists and some Ollama API answered, but it does not prove the API port is owned by that portable process. If a system Ollama instance owns `11434` while a portable process is stale, starting, or failed to bind, status and availability can be misclassified.

The current code does reject the simple case where system Ollama is already up and no portable process is running, so this is narrower than the earlier bug. The remaining gap is port ownership proof.

Recommended fix: either bind portable Ollama to a managed non-default port, or verify the port owner PID/executable path before treating the API as portable-owned.

### P2 - `_blank` click interception can still expose an `about:blank` placeholder during slow background resolution

File:

- `extansion/scripts/navigation-interceptor.js:391-405`

For managed `_blank` clicks, the content script prevents default, opens a reserved `about:blank` window, then waits for background resolution. This preserves the user gesture, but if the service worker is slow, errors, or never responds, the user can see a blank tab until fallback runs. This matches the earlier observed `about:blank` white tab class of bug.

Recommended fix: keep this path only for cases where gesture preservation is required and the background can respond quickly. Add a short client-side timeout that immediately navigates the reserved tab to the target if the background does not respond, and record a debug event. For current-tab hard swap, avoid creating a placeholder because no popup gesture is needed.

### P3 - Some accessibility/static fallback strings are not fully localized

Files:

- `extansion/settings/index.html`
- `extansion/settings/settings.js`

The main visible UI is now localized, but a few non-primary strings remain as English fallbacks or attributes, for example the segmented control `aria-label="Preload mode"` and fallback strings in dynamic calls. These do not break runtime behavior, but they are not a fully clean localization boundary.

Recommended fix: add `data-i18n-aria-label` to remaining static labels and periodically scan extension UI files for visible hardcoded strings.

## Checks That Look Reasonable

- Service worker event routing is now centralized through router/intercept/judge/action modules.
- Tracking state load/save now normalizes graph, tab state, and pending source maps.
- Frequency scoring is no longer a base score; base score is `1`, and frequency/AI are multiplier bands.
- Native and real-tab preload groups are split before site allocation, with separate site limits and page slot limits.
- Settings schema and rule-card labels now use i18n at load time.
- Model status polling is passive; status does not start the portable runtime.
- Local HTTP API no longer exposes protected routes to arbitrary web origins without origin gating.

## Recommended Fix Order

1. Fix extension identity detection after i18n.
2. Re-run `--install` and verify Native Messaging status reports the real extension ID.
3. Fix preload window creation so system-hide mode does not create visible normal windows first.
4. Harden `/extension/register` against first-request-wins when the origin file is missing.
5. Add `_blank` placeholder timeout fallback and debug event.
6. Tighten portable Ollama port ownership proof.
