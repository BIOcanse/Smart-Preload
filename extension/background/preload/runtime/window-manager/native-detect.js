const PRELOAD_WINDOW_HWND_POLL_MS = 50;
const PRELOAD_WINDOW_HWND_WAIT_MS = 1000;

async function captureNativeChromeWindowHwnds() {
  if (typeof globalThis.nativeAppListChromeWindows !== "function") {
    return null;
  }

  const windows = await nativeAppListChromeWindows();

  if (!Array.isArray(windows)) {
    return null;
  }

  return new Set(
    windows
      .map((window) => normalizePositiveFiniteNumber(window?.hwnd))
      .filter((hwnd) => Number.isFinite(hwnd))
  );
}

async function detectCreatedPreloadWindowHwnd(previousChromeWindowHwnds, actualWindow) {
  if (!(previousChromeWindowHwnds instanceof Set)) {
    return null;
  }

  const deadline = Date.now() + PRELOAD_WINDOW_HWND_WAIT_MS;

  while (Date.now() <= deadline) {
    const windows = await getNativeChromeWindows();
    const createdWindowCandidates = windows.filter((window) => {
      const hwnd = normalizePositiveFiniteNumber(window?.hwnd);

      return Number.isFinite(hwnd) && !previousChromeWindowHwnds.has(hwnd);
    });
    const bestCandidate = pickBestChromeWindowByBounds(
      createdWindowCandidates,
      actualWindow
    );
    const bestCandidateHwnd = normalizePositiveFiniteNumber(bestCandidate?.hwnd);

    if (Number.isFinite(bestCandidateHwnd)) {
      return bestCandidateHwnd;
    }

    await sleepPreloadWindowHwndPoll();
  }

  return null;
}

async function detectChromeWindowHwndByBounds(actualWindow) {
  const windows = await getNativeChromeWindows();
  const bestCandidate = pickBestChromeWindowByBounds(windows, actualWindow);

  return normalizePositiveFiniteNumber(bestCandidate?.hwnd);
}

async function detectChromeWindowHwndByPreloadSentinel(actualWindow = null) {
  const windows = await getNativeChromeWindows();
  const candidates = windows.filter((window) => isNativePreloadWindowByTitle(window));
  const bestCandidate =
    pickBestChromeWindowByBounds(candidates, actualWindow) ??
    pickBestPreloadSentinelWindow(candidates);

  return normalizePositiveFiniteNumber(bestCandidate?.hwnd);
}

async function getNativeChromeWindows() {
  if (typeof globalThis.nativeAppListChromeWindows !== "function") {
    return [];
  }

  try {
    const windows = await nativeAppListChromeWindows();
    return (Array.isArray(windows) ? windows : []).filter(
      matchesCurrentNativeBrowserFamily
    );
  } catch (_error) {
    return [];
  }
}

function matchesCurrentNativeBrowserFamily(window) {
  const browserKind = String(window?.browserKind || "").trim().toLowerCase();

  if (!browserKind) {
    return true;
  }

  const browserFamily =
    typeof getNativeAppBrowserFamily === "function"
      ? getNativeAppBrowserFamily()
      : "chromium";
  return browserFamily === "edge" ? browserKind === "edge" : browserKind !== "edge";
}

function pickBestChromeWindowByBounds(windows, actualWindow) {
  const liveWindow = actualWindow ?? {};
  const matches = [...(Array.isArray(windows) ? windows : [])].filter((window) =>
    matchesChromeWindowBounds(window, liveWindow)
  );

  if (matches.length !== 1) {
    return null;
  }

  return matches[0];
}

function pickBestPreloadSentinelWindow(windows) {
  const candidates = [...(Array.isArray(windows) ? windows : [])];

  if (candidates.length !== 1) {
    return null;
  }

  return candidates
    .sort((left, right) => {
      if (Boolean(left?.toolWindow) !== Boolean(right?.toolWindow)) {
        return Number(Boolean(right?.toolWindow)) - Number(Boolean(left?.toolWindow));
      }

      if (Boolean(left?.minimized) !== Boolean(right?.minimized)) {
        return Number(Boolean(right?.minimized)) - Number(Boolean(left?.minimized));
      }

      if (Boolean(left?.visible) !== Boolean(right?.visible)) {
        return Number(Boolean(left?.visible)) - Number(Boolean(right?.visible));
      }

      return 0;
    })[0] ?? null;
}

function isNativePreloadWindowByTitle(window) {
  const title = typeof window?.title === "string" ? window.title : "";
  const sentinelUrl =
    typeof PRELOAD_WINDOW_SENTINEL_URL === "string"
      ? PRELOAD_WINDOW_SENTINEL_URL
      : "about:blank#zero-latency-preload-window";

  return title.includes(sentinelUrl) || title.includes("zero-latency-preload-window");
}

function matchesChromeWindowBounds(window, actualWindow) {
  const actualLeft = normalizeFiniteNumber(actualWindow?.left);
  const actualTop = normalizeFiniteNumber(actualWindow?.top);
  const actualWidth = normalizeFiniteNumber(actualWindow?.width);
  const actualHeight = normalizeFiniteNumber(actualWindow?.height);
  const candidateLeft = normalizeFiniteNumber(window?.left);
  const candidateTop = normalizeFiniteNumber(window?.top);
  const candidateWidth = normalizeFiniteNumber(window?.width);
  const candidateHeight = normalizeFiniteNumber(window?.height);

  if (
    !Number.isFinite(actualLeft) ||
    !Number.isFinite(actualTop) ||
    !Number.isFinite(actualWidth) ||
    !Number.isFinite(actualHeight) ||
    !Number.isFinite(candidateLeft) ||
    !Number.isFinite(candidateTop) ||
    !Number.isFinite(candidateWidth) ||
    !Number.isFinite(candidateHeight)
  ) {
    return false;
  }

  return (
    Math.abs(candidateLeft - actualLeft) <= 10 &&
    Math.abs(candidateTop - actualTop) <= 10 &&
    Math.abs(candidateWidth - actualWidth) <= 10 &&
    Math.abs(candidateHeight - actualHeight) <= 10
  );
}

async function sleepPreloadWindowHwndPoll() {
  await new Promise((resolve) => {
    setTimeout(resolve, PRELOAD_WINDOW_HWND_POLL_MS);
  });
}

function normalizeFiniteNumber(value) {
  const numericValue = Number(value);

  return Number.isFinite(numericValue) ? numericValue : null;
}
