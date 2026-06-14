# Local And Private Network Page Preload Exclusion Design - 2026-06-13

## User Request

用户要求：“加上一个规避本地网页的功能，就是本地网页不会预加载，和规避google页面一样也是可以开关的。”

后续追加：“内网排除也加上，跟前面几个类似。”

## Scope

Add a Tracking setting that prevents locally hosted pages from being tracked as active source pages or used as preload targets. This mirrors the existing Google internal page exclusion switch.

Add a second independent Tracking setting for private-network pages. Local-machine pages and private-network pages are separate switches so the user can keep one excluded while allowing the other.

## Local Page Definition

The exclusion covers local-machine web pages:

- `localhost`
- `*.localhost`
- `127.0.0.0/8`
- `0.0.0.0`
- `[::1]`

It does not include private LAN addresses such as `192.168.x.x`, `10.x.x.x`, or `172.16-31.x.x`, because those may be router/admin/intranet pages and are not necessarily local-machine pages.

`file://` is already outside the current tracked/preloaded URL model because only `http:` and `https:` are trackable.

## Private Network Page Definition

The private-network exclusion covers non-local private or link-local network addresses:

- IPv4 private ranges:
  - `10.0.0.0/8`
  - `172.16.0.0/12`
  - `192.168.0.0/16`
- IPv4 link-local:
  - `169.254.0.0/16`
- IPv6 unique-local:
  - `fc00::/7`
- IPv6 link-local:
  - `fe80::/10`

It intentionally does not classify all single-label hostnames as private network pages. A name like `intranet` may resolve internally, but classifying it without DNS/proxy context would be too broad. That can be added later as a visible user-controlled pattern list if needed.

## Behavior

- Defaults: both local-page and private-network exclusions are enabled, matching the conservative posture of `excludeGoogleInternalPages`.
- When local-page exclusion is enabled:
  - local pages are not tracked as source pages;
  - local target links are not registered as preload candidates;
  - hover and context-menu interaction preloads skip local targets;
  - activation paths do not treat local targets as preload-ready candidates.
- When private-network exclusion is enabled, the same behavior applies to private-network pages.
- When a switch is disabled:
  - that page class follows the same tracking and preloading rules as other normal `http(s)` pages.

## File Structure Plan

- `extansion/shared/settings.js`
  - Add `tracking.excludeLocalPages`.
  - Add `tracking.excludePrivateNetworkPages`.
- `extansion/background/tracking/url/model.js`
  - Add `isLocalPageUrl`, `isPrivateNetworkPageUrl`, `isExcludedLocalPage`, `isExcludedPrivateNetworkPage`, and `isExcludedTrackingPage`.
  - Route `isTrackableAndAllowedUrl` through Google, local, and private-network exclusions.
- Existing call sites that only checked `isExcludedGooglePage` for preload filtering are updated to use `isExcludedTrackingPage`.
- `extansion/settings/index.html` / `settings.js`
  - Add the switch in Tracking.
- `_locales/*/messages.json`
  - Add labels and descriptions.
- Tests:
  - Add URL exclusion coverage for local and private-network addresses and setting normalization.
