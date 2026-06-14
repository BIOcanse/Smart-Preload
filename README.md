<p align="center">
  <img src="extansion/images/icon-128.png" width="96" alt="Smart Preload logo">
</p>

# Smart Preload / Zero Latency Web

English | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [Русский](README.ru.md)

Smart Preload prepares pages you are likely to open next, so repeated browsing, research, comparison, and documentation reading feel less interrupted.

It is most useful when you keep many tabs open, move through search results, compare pages, or repeatedly jump between related sites.

![Popup ranking](assets/readme/popup-ranking.png)

## What The Ranking Means

The popup shows the top preload candidates for the current tab. It is not a global popularity chart.

- `Top` shows the pages Smart Preload is currently most likely to prepare for this tab.
- `Weight` is the current priority score.
- `Freq` shows learned navigation frequency from this page or site.
- `prerender`, `prefetch`, and `hidden-tab` show how the page is being prepared.
- The status tells you whether the candidate is ready, loaded, or still waiting.

Use this list to understand what the extension is preparing and to check why a link was or was not selected.

## When To Pause It

Pause Smart Preload before online exams, proctored sessions, locked-down corporate browsers, banking flows, or other pages that may object to extensions, background tabs, or preloaded pages.

Use the popup `Stop` button for a quick pause. You can also turn off `Enable preloading` in Settings. If a test or secure tool also checks background apps, exit the Windows companion app from the tray before starting.

![Settings controls](assets/readme/settings-preload-controls.png)

## History Data And Migration

Smart Preload's learned history is stored in browser extension storage, not in the Windows app folder.

Typical paths:

- Chrome: `%LOCALAPPDATA%\Google\Chrome\User Data\<Profile>\Local Extension Settings\<extension-id>\`
- Edge: `%LOCALAPPDATA%\Microsoft\Edge\User Data\<Profile>\Local Extension Settings\<extension-id>\`

`<Profile>` is often `Default` or `Profile 1`. The extension ID is visible on `chrome://extensions` or `edge://extensions` after enabling developer details.

To move history to another computer or profile:

1. Install or load the extension once on the target browser.
2. Close that browser completely.
3. Copy the old `<extension-id>` folder contents into the target browser's matching extension storage folder.
4. If the extension ID changed, copy the contents into the new extension ID folder instead.
5. Start the browser again.

The Windows app's `portable` folder stores app binding files and logs. It is not the browsing history store. In Settings, you can delete learned records by UTC date range.

## Install

Download the latest version from [GitHub Releases](https://github.com/kingstonwang114514-cloud/zero-latency-web/releases/latest).

1. Install or load the extension in Chrome or Edge.
2. Optional: extract the Windows companion app.
3. Run `install-register.cmd` from the app folder, or start the app once.
4. Keep the app folder in its final location.

The extension can run without the Windows app. The app is Windows-only and is useful when you want stronger local browser integration.

## Browser Support

- Google Chrome
- Microsoft Edge
- Other Chromium-based browsers may work, but Chrome and Edge are the intended targets.
