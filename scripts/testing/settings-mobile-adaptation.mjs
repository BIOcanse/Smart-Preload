import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const adaptationScriptPath = path.join(
  repoRoot,
  "extension",
  "settings",
  "platform-adaptation.js"
);
const indexHtml = readFileSync(
  path.join(repoRoot, "extension", "settings", "index.html"),
  "utf8"
);
const responsiveCss = readFileSync(
  path.join(
    repoRoot,
    "extension",
    "settings",
    "styles",
    "status-actions-responsive.css"
  ),
  "utf8"
);

assert.equal(runDetection({ userAgentData: { mobile: true } }).mobile, true);
assert.equal(
  runDetection({
    userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36",
  }).mobile,
  true
);
assert.equal(
  runDetection({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
  }).mobile,
  true
);
assert.equal(
  runDetection({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15",
    platform: "MacIntel",
    maxTouchPoints: 5,
  }).mobile,
  true
);
assert.equal(
  runDetection({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    platform: "Win32",
    maxTouchPoints: 10,
    innerWidth: 390,
  }).mobile,
  false,
  "a narrow or touch-capable desktop must not be treated as mobile"
);

const androidState = runDetection({
  userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Mobile",
});
assert.equal(androidState.rootAttributes["data-mobile-platform"], "true");
assert.equal(androidState.api.isMobilePlatform, true);

const desktopState = runDetection({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  platform: "Win32",
});
assert.equal(desktopState.rootAttributes["data-mobile-platform"], "false");
assert.equal(desktopState.api.isMobilePlatform, false);

assert.ok(
  indexHtml.indexOf('<script src="platform-adaptation.js"></script>') <
    indexHtml.indexOf('<link rel="stylesheet" href="settings.css" />'),
  "the platform marker must run before settings CSS to avoid a desktop-only flash"
);
assert.match(indexHtml, /settingsMobileRealPreloadEasterEgg/u);
assert.match(
  responsiveCss,
  /html\[data-mobile-platform="true"\] \[data-desktop-real-preload-only\]/u
);
assert.match(responsiveCss, /data-card-id="perPagePreloadLimit"/u);
assert.match(responsiveCss, /data-card-id="highWeightRankTab"/u);
assert.match(responsiveCss, /\.mobile-platform-easter-egg/u);

for (const controlId of [
  "real-preload-enabled",
  "side-effect-link-safety-guard",
  "dangerous-site-safety-guard",
  "watchdog-enabled",
  "watchdog-interval-seconds",
  "fullscreen-pressure-policy",
  "force-minimize",
  "cross-site-current-tab-swap",
  "diagnostics-logging-enabled",
]) {
  assert.equal(
    nearestContainerHasDesktopOnlyMarker(indexHtml, controlId),
    true,
    `${controlId} must belong to a mobile-hidden desktop-only container`
  );
}

for (const controlId of [
  "preloading-enabled",
  "interaction-preload-enabled",
  "scheduler-native-total-max",
  "scheduler-attention-pool-enabled",
]) {
  assert.equal(
    nearestContainerHasDesktopOnlyMarker(indexHtml, controlId),
    false,
    `${controlId} must remain visible on mobile`
  );
}

for (const className of ["native-app-download-item", "native-app-update-item"]) {
  assert.match(
    indexHtml,
    new RegExp(
      `<article[^>]*class="[^"]*${className}[^"]*"[^>]*data-desktop-real-preload-only`,
      "u"
    )
  );
}

assert.match(
  indexHtml,
  /<fieldset[^>]*id="scheduler-hidden-tabs-group"[^>]*data-desktop-real-preload-only/u
);
assert.match(
  indexHtml,
  /id="settings-performance-warning"[^>]*data-desktop-real-preload-only/u
);

for (const localeId of ["en", "zh_CN", "zh_TW", "ja", "ko", "de", "fr", "es", "pt_BR", "ru"]) {
  const messages = JSON.parse(
    readFileSync(
      path.join(repoRoot, "extension", "_locales", localeId, "messages.json"),
      "utf8"
    )
  );
  assert.ok(
    messages.settingsMobileRealPreloadEasterEgg?.message?.trim(),
    `${localeId} is missing the mobile Real Preload easter egg`
  );
}

console.log("settings mobile adaptation tests passed");

function runDetection(navigatorSnapshot) {
  const rootAttributes = {};
  const context = {
    navigator: navigatorSnapshot,
    document: {
      documentElement: {
        setAttribute(name, value) {
          rootAttributes[name] = value;
        },
      },
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(readFileSync(adaptationScriptPath, "utf8"), context, {
    filename: adaptationScriptPath,
  });

  return {
    mobile: context.ZeroLatencySettingsPlatformAdaptation.detectMobilePlatform(
      navigatorSnapshot
    ),
    api: context.ZeroLatencySettingsPlatformAdaptation,
    rootAttributes,
  };
}

function nearestContainerHasDesktopOnlyMarker(html, controlId) {
  const controlIndex = html.indexOf(`id="${controlId}"`);
  assert.notEqual(controlIndex, -1, `missing control ${controlId}`);
  const articleIndex = html.lastIndexOf("<article", controlIndex);
  const fieldsetIndex = html.lastIndexOf("<fieldset", controlIndex);
  const containerIndex = Math.max(articleIndex, fieldsetIndex);
  const containerEnd = html.indexOf(">", containerIndex);
  const openingTag = html.slice(containerIndex, containerEnd + 1);
  return openingTag.includes("data-desktop-real-preload-only");
}
