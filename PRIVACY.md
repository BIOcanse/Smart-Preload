# Smart Preload Privacy Policy

Last updated: June 23, 2026

English | [简体中文](PRIVACY.zh-CN.md) | [繁體中文](PRIVACY.zh-TW.md) | [日本語](PRIVACY.ja.md) | [한국어](PRIVACY.ko.md) | [Deutsch](PRIVACY.de.md) | [Français](PRIVACY.fr.md) | [Español](PRIVACY.es.md) | [Português (Brasil)](PRIVACY.pt-BR.md) | [Русский](PRIVACY.ru.md)

This policy applies to the Smart Preload browser extension and the optional Windows companion app.

Smart Preload uses intelligent preloading algorithms to reduce perceived loading wait times. To do that, it processes browsing-related signals in your browser profile and on your device. The developer does not operate a server that collects your browsing history, does not sell user data, and does not share user data with advertisers, analytics brokers, or data brokers.

## Data processed locally

Smart Preload may process and store the following data locally:

- Page URLs, hosts, titles, and navigation transitions.
- Link candidates found on pages, including link URLs, anchor text, and nearby text used for ranking.
- Tab, window, preload, and prefetch state needed to manage prepared pages.
- Interaction signals such as link hover, context-menu preload intent, foreground tab activity, recent active time, and media/activity state used by scheduling.
- Bookmark titles and URLs when bookmark-based preload features are enabled.
- Extension settings, preload limits, safety settings, local history statistics, API provider settings, and diagnostic logs when diagnostics are enabled.

This local data is used only to provide Smart Preload features: prediction, ranking, preload scheduling, safety filtering, local history deletion, diagnostics, and optional AI-assisted scoring.

## Data sent outside your device

Smart Preload does not send browsing history or preload history to the developer.

Data may leave your device only in these cases:

- If you enable an external AI provider and enter an API key or endpoint, the extension may send the selected page/link context needed for keyword or relevance scoring to that provider. The provider's own privacy policy applies to those requests.
- If you use a local AI endpoint such as LM Studio, requests are sent to the endpoint you configured.
- If you check for or download native app updates, the extension or the Windows companion app may contact GitHub release pages or GitHub-hosted files.
- When you actually visit a page, or when a preload feature loads a page in the browser, normal browser networking occurs. The destination website may receive ordinary requests, cookies, and session information just as it would during a normal page load.

## Optional Windows companion app

The optional Windows companion app helps keep real preload windows hidden and supports local system integration. It communicates with the extension through Chrome/Edge native messaging on the same device. It may process local browser window metadata and local system performance/activity information to manage preload behavior. It does not send browsing history to the developer.

## Storage and deletion

Smart Preload stores its data in local browser extension storage and related local files used by the extension or the companion app. You can delete selected local history ranges from the extension settings page. You can also remove stored extension data by uninstalling the extension or clearing the browser profile's extension data.

## Permissions

Smart Preload requests browser permissions only to support its features, including tab and navigation event handling, local storage, bookmark-based preload features, native messaging with the optional companion app, and scheduled maintenance checks.

## No sale or advertising use

The developer does not sell, rent, or share user data with advertisers, analytics brokers, or other third parties for tracking, profiling, or advertising.

## Chrome Web Store Limited Use

Smart Preload's use of information received from Chrome extension APIs is limited to providing and improving its single purpose: reducing perceived page loading wait times through local prediction and preloading. Smart Preload's use of this information adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Children's privacy

Smart Preload is not directed to children and does not knowingly collect personal information from children.

## Changes

This policy may be updated when Smart Preload changes its data handling behavior. The latest version will be published in this repository.

## Contact

For privacy questions, contact: biocanse@gmail.com
