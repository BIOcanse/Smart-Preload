# Smart Preload v1.0.10

## Downloads

- Chrome Web Store upload package: `zero-latency-web-extension-chrome-web-store-v1.0.10.zip`
- Manual extension package: `zero-latency-web-extension-v1.0.10.zip`
- Windows native app package: `zero-latency-web-app-windows-x64-v1.0.10.zip`
- Reviewer bundle: `zero-latency-web-chrome-review-bundle-v1.0.10.zip`
- Internal test bundle: `zero-latency-web-test-bundle-v1.0.10.zip`

## Important Native App Setup Order

For the first binding, install or enable the browser extension first, then run the native app installer (`install-register.cmd`) or start the native app from the extracted app folder.

The native app needs the installed extension ID before it can write the Native Messaging manifest that allows the extension to wake it.

After binding succeeds, you do not need to repeat this order for normal use. When the extension is online and the native app is offline, the extension can wake the native app automatically through Native Messaging.

## Notes

- Extension logic owns visit graph learning, scoring, scheduling, and navigation interception.
- The Windows app is a local tray/API helper for Native Messaging wake, liveness, system-level hidden window support, and local performance signals.
- No remote hosted extension code is used.
