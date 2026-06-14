<p align="center">
  <img src="extansion/images/icon-128.png" width="96" alt="Smart Preload logo">
</p>

# Smart Preload / Zero Latency Web

English | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [Русский](README.ru.md)

Smart Preload is a Chrome and Edge extension that preloads likely next pages more proactively. It combines link scoring, tab activity history, hover preloading, and a Windows helper app for stronger background-window control.

## Download

Download the latest package from [GitHub Releases](https://github.com/kingstonwang114514-cloud/zero-latency-web/releases/latest).

The Windows app is optional but recommended. It is Windows-only and is used for native messaging, watchdog recovery, performance snapshots, and background-window handling.

## Install

1. Install or enable the extension in Chrome or Edge first.
2. Extract the Windows app package.
3. Run `install-register.cmd` from the extracted app folder, or start the app once.
4. After the first successful binding, the extension can wake the local app automatically.

If the app cannot be detected for about one minute, the extension can prompt you to download the app or enable the full native preload mode.

## Features

- Global preload scheduling across visible tabs instead of only the current tab.
- Separate budgets for normal preloads and real background-tab preloads.
- Hover and context-menu preloading for links that are likely to be opened next.
- Exclusions for local pages, private-network pages, Google pages, incognito windows, and proxy-related browsing where configured.
- Manual UI language selection in addition to automatic browser-language detection.
- Local history data stored in a portable folder so it can be copied to a new computer or a new version.

## Notes

- Supported browsers: Google Chrome and Microsoft Edge, Chromium-based versions.
- Native app package: Windows only.
- First binding order matters: install or enable the extension before running the app registration.
- Extension prediction logic stays in the extension; the app does not run local AI models or store AI provider keys.
