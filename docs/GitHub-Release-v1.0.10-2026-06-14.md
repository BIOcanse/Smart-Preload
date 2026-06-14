# GitHub Release v1.0.10

## 用户原话

- “首先先在github发布，请在114514那个账户建立新库然后发布”
- “之后的话改下包让链接指向正确的”
- “并且页面中要提示（gtihub的app下载页面，扩展设置页面中都加上提示）需要先安装插件再运行app才能绑定成功，后续都可以自动拉起。”

## 目标

- 使用开发者账号 `kingstonwang114514-cloud` 创建或复用公开仓库 `zero-latency-web`。
- 推送当前 `main` 代码到 `developer` remote。
- 发布 GitHub Release `v1.0.10`，上传 v1.0.10 的扩展、Windows App、审核包、测试包和校验文件。
- 设置页 GitHub 下载入口继续指向：
  - `https://github.com/kingstonwang114514-cloud/zero-latency-web/releases`
- 设置页和 GitHub Release 说明都必须明确：
  - 首次绑定时，先安装或启用插件，再运行本地 App 安装脚本或启动 App。
  - 绑定成功后，插件后续可以在 App 离线时自动拉起 App。

## 文件结构规划

- `extansion/_locales/*/messages.json`
  - 更新 `settingsNativeAppBindingOrder` 文案，覆盖设置页提示。
- `app/README.md`
  - 更新本地 App 安装说明，作为 GitHub App 包内说明。
- `scripts/package-release.ps1`
  - 更新生成的 release README、review instructions、test guide。
- `docs/GitHub-Release-v1.0.10-2026-06-14.md`
  - 保存本次发布动作和 GitHub Release 正文。
- `dist/*v1.0.10*`
  - 重新生成发布包并作为 GitHub Release assets 上传。

## GitHub Release 正文

```md
# Smart Preload v1.0.10

## Downloads

- Chrome Web Store upload package: `zero-latency-web-extension-chrome-web-store-v1.0.10.zip`
- Manual extension package: `zero-latency-web-extension-v1.0.10.zip`
- Windows native app package: `zero-latency-web-app-windows-x64-v1.0.10.zip`
- Reviewer bundle: `zero-latency-web-chrome-review-bundle-v1.0.10.zip`
- Internal test bundle: `zero-latency-web-test-bundle-v1.0.10.zip`

## Important native app setup order

For the first binding, install or enable the browser extension first, then run the native app installer (`install-register.cmd`) or start the native app from the extracted app folder.

The native app needs the installed extension ID before it can write the Native Messaging manifest that allows the extension to wake it.

After binding succeeds, you do not need to repeat this order for normal use. When the extension is online and the native app is offline, the extension can wake the native app automatically through Native Messaging.

## Notes

- Extension logic owns visit graph learning, scoring, scheduling, and navigation interception.
- The Windows app is a local tray/API helper for Native Messaging wake, liveness, system-level hidden window support, and local performance signals.
- No remote hosted extension code is used.
```

## 进度

- 已完成：文案更新、重新打包、GitHub 仓库创建/推送、Release 发布。
