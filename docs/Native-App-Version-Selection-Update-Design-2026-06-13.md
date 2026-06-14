# Native App Version Selection Update Design - 2026-06-13

## User Request

用户要求：“设置页中加上这个，这个更新只负责app更新，可以选择app版本然后升级。需要app绑定插件的情况下，选单页面选择版本然后发消息，本地app会自己更新。”

## Scope

This feature manages only the local Windows app. The Chrome Web Store extension package is not self-updated by this selector because store-managed extensions can only move to the store-published version.

## Update Source

No independent server is required for the version catalog. The settings page reads GitHub Releases from:

`https://api.github.com/repos/kingstonwang114514-cloud/zero-latency-web/releases`

Each release can provide the app asset:

`zero-latency-web-app-windows-x64-v{version}.zip`

## Behavior

- The settings page asks the native app for its current version.
- The settings page fetches GitHub releases and lists app versions from the current app version upward.
- Versions lower than the running app are hidden, so the UI cannot request a downgrade.
- Selecting the current version disables the upgrade action.
- Selecting a newer version sends one message to the background worker.
- The background worker forwards the request to the local app API.
- The native app validates the target version and asset name before starting its own updater.

## File Structure Plan

- `extansion/settings/app-updates.js`
  - Owns GitHub release catalog loading, dropdown rendering, and app update UI state.
- `extansion/settings/index.html`
  - Adds the native app version selector beside the existing GitHub release link.
- `extansion/background/core/messages/native-app-update.js`
  - Owns extension-to-app update status and update request forwarding.
- `app/src/api/routes/app_update.rs`
  - Owns local app version/status response and target update request handling.
- `_locales/*/messages.json`
  - Adds user-facing labels and status text.

## Safety Rules

- Target versions must be greater than or equal to the current app version.
- Update requests must use a GitHub Releases app zip asset matching the target version.
- The app validates the version string and asset filename again; UI filtering is not treated as trust.
- Downgrade requests are rejected by the app API.
