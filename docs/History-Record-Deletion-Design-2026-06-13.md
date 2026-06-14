# History Record Deletion Design - 2026-06-13

## User Request

用户要求：“加上删除历史记录的能力，能够删除任意时间区间的记录，删除前需要确认。”

## Scope

This feature deletes locally stored extension learning/history records whose timestamps fall inside a user-selected time range. It is exposed from the settings page under Tracking because it changes the stored visit graph, not runtime preload state.

## Storage Reality

The visit graph is stored in `chrome.storage.local` through `GRAPH_KEY`. The authoritative event source for navigation frequency is `graph.transitionMessages`; these messages rebuild:

- `graph.edges`
- `graph.transitionBuckets`
- `graph.transitionMessagesByDay`
- `graph.transitionMessageBuckets`
- `graph.externalPageTransitionBuckets`
- `graph.intraSitePageTransitionBuckets`
- `graph.pageTransitionMessageBuckets`

Other learning records are partially event-like:

- `graph.recentForegroundPages`: timestamped by `activatedAt` / `leftForegroundAt`.
- `graph.pageKeywordStore`: timestamped by `generatedAt`.
- `graph.linkBehaviorStore`: aggregated per source-target pair with only `lastSeenAt`; it cannot partially subtract historical counts by arbitrary interval.
- `graph.historyPageTitles` / `historyPageUrls` / `historyPageTexts`: compact prompt pool with no timestamp; after deletion it should be rebuilt only from remaining `recentForegroundPages`.
- `graph.bookmarkPreloadBuckets`: aggregate counters without timestamp, so arbitrary time-range deletion cannot safely modify them.

## Behavior

Input:

- `startDate`: UTC date in `YYYY-MM-DD`.
- `endDate`: UTC date in `YYYY-MM-DD`.

Rules:

- Both dates are required.
- The effective interval is `[startDate 00:00:00.000Z, endDate 00:00:00.000Z)`.
- The start date is included and the end date is excluded.
- If `startDate >= endDate`, the request is rejected.
- The settings page displays the current UTC time beside the controls so the user does not need to infer timezone conversion.
- UI date inputs and background validation both use UTC date semantics.

Deletion:

- Remove `transitionMessages` where `occurredAt` is inside the interval.
- Remove `recentForegroundPages` where `activatedAt` or `leftForegroundAt` is inside the interval.
- Remove `pageKeywordStore` entries where `generatedAt` is inside the interval.
- Remove `linkBehaviorStore` source-target records where `lastSeenAt` is inside the interval. This deletes the whole aggregate record because older per-event counts are not stored.
- Rebuild derived transition indexes and edges from the remaining `transitionMessages`.
- Rebuild `pageKeywordBuckets` from the remaining `pageKeywordStore`.
- Rebuild the history page prompt pool from remaining `recentForegroundPages`.
- Keep current `tabState`, `pendingSources`, and preload runtime state.

Confirmation:

- Settings UI must show a confirmation before sending the deletion message.
- Background still validates the range; UI confirmation is not trusted as validation.

## File Structure Plan

- `extansion/background/tracking/history-deletion.js`
  - Range parsing.
  - Timestamp membership checks.
  - Graph rebuilding after deletion.
  - Public API `deleteTrackingHistoryRange(trackingState, range)`.
- `extansion/background/core/messages/debug.js`
  - Adds `handleDeleteHistoryRange`.
- `extansion/background/judge/messages.js`
  - Allows `visit-graph:delete-history-range`.
- `extansion/background/actions/messages.js`
  - Routes the action to core messages.
- `extansion/background/core/router/messages.js`
  - Keeps the action on the mutation queue.
- `extansion/settings/index.html`
  - Tracking data management controls.
- `extansion/settings/settings.js`
  - UTC date parsing, current UTC display, confirmation, sendMessage, status rendering.
- `_locales/*/messages.json`
  - User-facing labels and confirmation text.
- `scripts/testing/history-deletion.mjs`
  - Unit checks for range deletion and index rebuild behavior.
