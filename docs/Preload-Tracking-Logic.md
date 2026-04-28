# Preload And Tracking Logic

## Purpose

This note freezes the current runtime rule set so preload behavior and visit tracking do not drift apart during iteration.

## Main-program rule

- Navigation-related signals should first pass through the extension's main program path.
- The main program should normalize the event, run the relevant judge/gate chain, and only then dispatch concrete actions.
- Tracking, preload activation, learning, and native-app side effects should not keep inventing separate direct-entry paths over time.

## Tracking scope

- The tracker continuously maintains the current page state for each normal top-level tab.
- A real transition message is only written when a real navigation is committed from that maintained source state.
- Browser-UI placeholder openings without an existing source context do not create transition messages by themselves.
  Example:
  opening a new tab that lands on a Google search page updates that tab's current-page state,
  but does not write a fake `previous -> google` jump.
- Extension-UI navigations also do not seed transition state.
  Example:
  opening the extension's own settings page from the popup must not create a pending source edge,
  and must not leak into later tracking for that tab.
- The tracker records normal top-level navigations for ordinary browser tabs.
- Cross-site jumps and same-site page changes both write real transition messages.
- That does not blacklist Google or any other start page:
  once such a page is actually the maintained current page, later user clicks from that page still write real outbound jumps.
- Google search result pages are intentionally normalized at both node level and page level.
  Different search terms do not create different tracked search-result pages;
  they all collapse to the same `/search` identity.
- The popup `Top` view is page-local:
  it shows the current page's outbound top destinations only.
- The underlying graph is global inside the active Chrome profile:
  any tracked top-level jump can feed the graph, even if it does not belong to the currently opened popup page.
- Site-level node counts only advance when the destination node changes.
  Same-site page changes still feed the raw message log and page-level transition indexes.

## Hidden preload container rule

- Pages inside the hidden preload container are not treated as real user visits.
- A preloaded hidden tab may be created, loaded, updated, or destroyed without adding graph messages by itself.
- This prevents speculative background work from polluting the visit graph.

## Source of truth for hidden-tab activation

- When a hidden preloaded tab is actually chosen by the user, the real click is the source of truth.
- At that moment the extension first locks the current source-page state, then records one directional transition message, and then moves the matched preloaded tab into the visible normal window.
- Because the message is written at click time, there is no need to separately count container-side navigation events for that jump.

## Why this stays simple

- The maintained current-page state prevents `null -> B` and `A -> A` style corruption.
- Unchosen speculative tabs never write fake history.
- Chosen speculative tabs still produce one real transition record.
- After activation, later user navigation continues through the normal tracking path.
- This keeps the graph deterministic and avoids special-case recovery logic for “tabs that used to be in the container”.

## Candidate-pool rule

- Prediction is applied only inside the current page's real collected candidate-link pool.
- The extension does not pull arbitrary high-weight targets straight out of the historical graph if
  those targets are not present in the current page's collected links.
- Example:
  if the current Google page does not contain a YouTube link, then a historically high YouTube
  weight still cannot make YouTube a preload target for that page.

## Link open-mode memory

- The extension separately records how a concrete link actually opens for a concrete source page.
- This memory is keyed by:
  - source page URL
  - target URL
- It stores whether the user historically opened that link in the current tab or a new tab.
- First encounter still falls back to the current quick heuristic:
  DOM `target` plus normal browser intent inference.
- Later encounters prefer the recorded behavior for that exact source-page / target pair.
- This is source-page-local on purpose:
  the same destination can behave differently depending on where it was clicked from.
- Example:
  a target seen on a Google results page may usually replace the current tab,
  while the same target seen on another page may usually open as a new tab.

## Current hidden-tab cases

- Cross-site plus `_blank`:
  use the hidden preload container and record the jump on actual activation.
- Cross-site plus current tab:
  default path is `prefetch`;
  if the experimental hard-swap switch is enabled, it uses the hidden preload container and still records on actual activation.
- Same-origin navigations:
  use Chrome `prerender`, not hidden-tab swapping.

## Source-lock TTL

- The current-page lock taken on click intent must not be permanent.
- Some click paths never produce a real navigation:
  - JavaScript handlers that `preventDefault` after the click
  - `location.href = ...` assignments that are cancelled or fail
  - Middle-click and modifier-click where the browser may open nothing
- A source lock that is never released will poison the next real navigation from the same tab, because the stale locked state will be mistaken for the fresh source.
- The tracker must apply a short TTL to any source lock (example target: 2 seconds).
- When the TTL expires without a committed navigation, the lock is cleared and the tab falls back to its maintained current-page state.
- SPA-internal `history.pushState` navigations do not go through this lock at all; they should be handled by the same-site page-change path, not the click-time lock.
