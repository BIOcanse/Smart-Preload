// 跨源 `_blank` 点击的两条失效路径。
//
// (1) **弹窗被拦时点击彻底静默失效**。window.open 只能在用户激活态内调用，所以 `_blank`
//     的接管必须先占一个窗口，等后台决议回来再导航过去。若这一步返回 null（被弹窗拦截器
//     挡住），那么 await 之后再调 window.open 同样会被挡——那时早已脱离用户激活态。
//     此前 preventDefault 已经生效，于是点击什么都不做，而浏览器自己的 `_blank` 导航
//     本来能正常工作（用户发起的链接点击不受弹窗拦截）。
//
// (2) **rel="noreferrer" 被丢弃**。作者显式要求不发 Referer，而接管后的两条执行路径都
//     违背它：`_self` 走 location.assign() 必带 Referer；`_blank` 走
//     window.open(url, "_blank", "noopener") 特性串里没有 noreferrer。
//     relTokens 由 shared/safety.js 采集，但 preload-safety-rules/candidate.js 只取
//     downloadAttribute 和 typeAttr——这个字段此前从未被任何代码消费过。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const moduleSources = await Promise.all(
  [
    "../../extension/shared/preload-safety-rules/constants.js",
    "../../extension/shared/preload-safety-rules/url.js",
    "../../extension/shared/preload-safety-rules/decision.js",
    "../../extension/shared/preload-safety-rules/candidate.js",
    "../../extension/shared/preload-safety-rules.js",
    "../../extension/shared/sensitive-site-rules/constants.js",
    "../../extension/shared/sensitive-site-rules/url.js",
    "../../extension/shared/sensitive-site-rules/match.js",
    "../../extension/shared/sensitive-site-rules.js",
    "../../extension/scripts/navigation/shared.js",
    "../../extension/scripts/navigation/shared/text.js",
    "../../extension/scripts/navigation/shared/url.js",
    "../../extension/scripts/navigation/shared/focus.js",
    "../../extension/scripts/navigation/shared/safety.js",
    "../../extension/scripts/navigation/candidate-scan/links.js",
    "../../extension/scripts/navigation/click-edge/anchor.js",
    "../../extension/scripts/navigation/fallbacks.js",
  ].map(async (filePath) => ({
    filename: filePath.split("/").slice(-2).join("/"),
    source: await readFile(new URL(filePath, import.meta.url), "utf8"),
  }))
);
const clicksSource = await readFile(
  new URL("../../extension/scripts/navigation/click-edge/clicks.js", import.meta.url),
  "utf8"
);

class HTMLAnchorElementStub {}

let openedWindows = [];
let blockPopups = false;
let resolutionResponse = { action: "navigate-reserved-tab" };
let resolutionRequests = [];

const sandbox = {
  URL,
  console,
  Date,
  Node: class NodeStub {},
  HTMLAnchorElement: HTMLAnchorElementStub,
  location: { href: "https://source.test/page", assign: () => {} },
  document: {
    title: "Click fixture",
    readyState: "complete",
    prerendering: false,
    visibilityState: "visible",
    activeElement: null,
    documentElement: { nodeType: 1, tagName: "HTML" },
    hasFocus: () => true,
  },
  window: {
    innerWidth: 1280,
    innerHeight: 800,
    setTimeout,
    clearTimeout,
    getSelection: () => ({ isCollapsed: true, toString: () => "" }),
    getComputedStyle: () => ({ display: "inline", visibility: "visible" }),
    open(url, target, features) {
      if (blockPopups) {
        return null;
      }

      const openedWindow = { url, target, features, closed: false, location: { replace() {} } };
      openedWindow.close = () => {
        openedWindow.closed = true;
      };
      openedWindows.push(openedWindow);
      return openedWindow;
    },
  },
  IntersectionObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
};
sandbox.globalThis = sandbox;

const context = vm.createContext(sandbox);
for (const { filename, source } of moduleSources) {
  vm.runInContext(source, context, { filename });
}

// clicks.js 在 IIFE 里解构这些依赖，桩必须先于它注入。
Object.assign(context.ZeroLatencyNavigationContent, {
  sendNavigationPrimeSource: async () => {},
  sendNavigationLinkIntent: async () => {},
  requestClickNavigationResolutionWithTimeout: async (payload) => {
    resolutionRequests.push(payload);
    return resolutionResponse;
  },
  recordLinkInteractionForAttention: () => {},
});
vm.runInContext(clicksSource, context, { filename: "click-edge/clicks.js" });

const navigation = context.ZeroLatencyNavigationContent;
assert.equal(typeof navigation.handleClick, "function");
assert.equal(typeof navigation.anchorSuppressesReferrer, "function");

function makeAnchor(href, options = {}) {
  const attributes = new Map(Object.entries(options.attributes || {}));
  const anchor = new HTMLAnchorElementStub();

  Object.assign(anchor, {
    nodeType: 1,
    tagName: "A",
    isConnected: true,
    href,
    target: options.target || "",
    rel: options.rel || "",
    innerText: options.text || "link",
    textContent: options.text || "link",
    parentElement: { innerText: "" },
    closest: () => null,
    querySelector: () => null,
    getAttribute: (name) => (name === "href" ? href : (attributes.get(name) ?? null)),
    hasAttribute: (name) => attributes.has(name),
    getBoundingClientRect: () => ({
      top: 20,
      bottom: 40,
      left: 10,
      right: 210,
      width: 200,
      height: 20,
    }),
  });

  return anchor;
}

function makeClickEvent(anchor) {
  const event = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    preventDefaultCalls: 0,
    stopPropagationCalls: 0,
    composedPath: () => [anchor],
    preventDefault() {
      event.preventDefaultCalls += 1;
      event.defaultPrevented = true;
    },
    stopPropagation() {
      event.stopPropagationCalls += 1;
    },
  };
  return event;
}

function reset() {
  openedWindows = [];
  resolutionRequests = [];
  blockPopups = false;
  resolutionResponse = { action: "navigate-reserved-tab" };
}

// --- 1. 正常的跨源 _blank 点击：预留窗口 + 接管 ---
{
  reset();
  const anchor = makeAnchor("https://target.test/article", { target: "_blank" });
  const event = makeClickEvent(anchor);
  await navigation.handleClick(event);

  assert.equal(event.preventDefaultCalls, 1, "跨源 _blank 点击应当被接管");
  assert.equal(event.stopPropagationCalls, 0, "不得阻断传播（invariants 第 5 条）");
  assert.equal(openedWindows.length, 1, "应当预留一个窗口");
  assert.equal(openedWindows[0].url, "about:blank");
  assert.equal(resolutionRequests.length, 1, "应当向后台请求决议");
}

// --- 2. 弹窗被拦：必须交还浏览器，而不是 preventDefault 后什么都不做 ---
{
  reset();
  blockPopups = true;
  const anchor = makeAnchor("https://target.test/article", { target: "_blank" });
  const event = makeClickEvent(anchor);
  await navigation.handleClick(event);

  assert.equal(
    event.preventDefaultCalls,
    0,
    "window.open 被拦时仍然 preventDefault —— 点击会彻底静默失效，" +
      "而浏览器自己的 _blank 导航本来能正常工作（用户发起的链接点击不受弹窗拦截）"
  );
  assert.equal(openedWindows.length, 0, "被拦时不应有窗口被打开");
  assert.equal(
    resolutionRequests.length,
    0,
    "既然交还浏览器，就不该再向后台请求决议"
  );
}

// --- 3. rel="noreferrer"：整条不接管 ---
{
  for (const target of ["_blank", ""]) {
    reset();
    const anchor = makeAnchor("https://target.test/article", {
      target,
      rel: "noopener noreferrer",
    });
    const event = makeClickEvent(anchor);
    await navigation.handleClick(event);

    assert.equal(
      event.preventDefaultCalls,
      0,
      `rel="noreferrer" 的 target="${target || "_self"}" 链接被接管了 —— ` +
        "接管后 location.assign 必带 Referer、window.open 特性串也没有 noreferrer，" +
        "会把作者显式抑制掉的 referrer 发出去"
    );
    assert.equal(openedWindows.length, 0, "不接管就不该预留窗口");
    assert.equal(resolutionRequests.length, 0, "不接管就不该请求决议");
  }

  // 只有 noopener（没有 noreferrer）不受影响：它不涉及 referrer。
  reset();
  const anchor = makeAnchor("https://target.test/article", {
    target: "_blank",
    rel: "noopener",
  });
  const event = makeClickEvent(anchor);
  await navigation.handleClick(event);

  assert.equal(
    event.preventDefaultCalls,
    1,
    "只有 noopener 的链接被误判成 noreferrer —— 它不涉及 referrer"
  );
}

// --- 4. 同源点击不得被拦截（invariants 第 5 条的回归护栏）---
{
  reset();
  const anchor = makeAnchor("https://source.test/other", { target: "" });
  const event = makeClickEvent(anchor);
  await navigation.handleClick(event);

  assert.equal(event.preventDefaultCalls, 0, "同源导航不得被拦截");
  assert.equal(openedWindows.length, 0);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "normal cross-origin _blank click reserves a window and takes over",
        "blocked popup hands the click back to the browser instead of dying silently",
        "rel=noreferrer links are never intercepted (_blank and _self)",
        "rel=noopener alone is not mistaken for noreferrer",
        "same-origin clicks are still not intercepted",
      ],
    },
    null,
    2
  )
);
