// 用户输入的节流判定必须留在同步路径上，且 reportAttentionActivity 不再接受选项。
//
// mousemove / wheel / touchstart 注册在 document 捕获阶段
// （dom-observer/input-events.js:15-26），Chrome 把它们合并到每帧一次，事件率与刷新率同阶
// （60–144 次/秒）；上报间隔是 1000ms，于是 98%–99% 的调用只是为了走到那个 return。
// 此前判定在 async 的 reportAttentionActivity 内部——调用 async 函数无论多快返回，都要为
// 返回值分配一个 Promise 和一个协程帧，随后立刻被 void 丢弃。
//
// **怎么测「有没有进入 async 函数」**：数 Date.now() 的调用次数。旧实现在被节流时会调两次
// （recordUserInputForAttention 一次、reportAttentionActivity 在判定前一次），新实现只调
// 一次。这是代理指标，不是直接观测 Promise 分配——Promise 由 V8 内部 intrinsic 创建，
// 无法从沙箱里拦截。
//
// 同时钉住 force 选项的移除：它**从未被函数体读取过**，却写在 6 个调用点上，读起来像是在
// 绕过节流。留着它等于埋雷——若哪天节流改成默认行为，那 6 处会静默地开始被节流。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const moduleSources = await Promise.all(
  [
    "../../extension/scripts/navigation/shared.js",
    "../../extension/scripts/navigation/shared/focus.js",
  ].map(async (filePath) => ({
    filename: filePath.split("/").slice(-2).join("/"),
    source: await readFile(new URL(filePath, import.meta.url), "utf8"),
  }))
);
const attentionSource = await readFile(
  new URL("../../extension/scripts/navigation/attention.js", import.meta.url),
  "utf8"
);

let nowMs = 1_000_000;
let dateNowCalls = 0;
let reportedSnapshots = [];
let intervalCallbacks = [];
let sandboxDocument = null;

class ControlledDate extends Date {
  static now() {
    dateNowCalls += 1;
    return nowMs;
  }
}

// 每次都造一个全新的沙箱：shared.js 用 `globalThis.X = globalThis.X || {}` 建命名空间，
// 复用已经跑过的沙箱对象会连同上一轮注入的桩一起继承下来。
function createAttentionContext(options = {}) {
  const sandbox = {
    URL,
    console,
    Date: ControlledDate,
    location: { href: "https://attention.example/page" },
    document: {
      title: "Attention fixture",
      readyState: "complete",
      prerendering: false,
      visibilityState: "visible",
      hidden: false,
      activeElement: null,
      documentElement: { nodeType: 1, tagName: "HTML" },
      hasFocus: () => true,
      querySelectorAll: () => [],
    },
    window: {
      setTimeout,
      clearTimeout,
      // 捕获周期回调，便于手动驱动 —— 不能靠真实计时器等 15 秒。
      setInterval: (callback) => {
        intervalCallbacks.push(callback);
        return intervalCallbacks.length;
      },
      clearInterval: () => {},
    },
  };
  sandbox.globalThis = sandbox;

  const context = vm.createContext(sandbox);
  for (const { filename, source } of moduleSources) {
    vm.runInContext(source, context, { filename });
  }

  // attention.js 在 IIFE 里解构 reportAttentionActivityToBackground，桩必须先于它注入。
  if (options.withBackground !== false) {
    context.ZeroLatencyNavigationContent.reportAttentionActivityToBackground = (snapshot) => {
      reportedSnapshots.push(snapshot);
      return Promise.resolve();
    };
  }

  vm.runInContext(attentionSource, context, { filename: "attention.js" });
  // 最近一次创建的沙箱 document，供可见性相关的断言就地改写。
  sandboxDocument = sandbox.document;
  return context.ZeroLatencyNavigationContent;
}

const navigationContent = createAttentionContext();
const { state } = navigationContent;

// --- 1. 选项已彻底移除：传什么都不改变行为 ---
//
// 注意不能用 reportAttentionActivity.length 来钉这条 —— `function f(options = {})` 的
// length 同样是 0（默认参数不计入），那样的断言是空的。只能测行为：把时间戳设成「刚刚
// 上报过」，再带着旧的 throttle 选项调用，必须仍然上报。
{
  reportedSnapshots = [];
  state.lastAttentionActivityReportedAt = nowMs;
  void navigationContent.reportAttentionActivity({ throttle: true });

  assert.equal(
    reportedSnapshots.length,
    1,
    "reportAttentionActivity 仍在响应 throttle 选项 —— 它的语义应当是无条件「调用即上报」"
  );

  state.lastAttentionActivityReportedAt = 0;
}

// --- 2. 首次输入立即上报 ---
{
  reportedSnapshots = [];
  navigationContent.recordUserInputForAttention();

  assert.equal(reportedSnapshots.length, 1, "首次用户输入应当立即上报");
  assert.equal(
    state.lastAttentionActivityReportedAt,
    nowMs,
    "上报后应当记录时间戳"
  );
}

// --- 3. 节流窗口内：不进入 async 函数 ---
{
  // 一帧一次、持续一秒的 mousemove —— 这是被测的真实负载形态。
  const frameIntervalMs = 1000 / 144;
  reportedSnapshots = [];
  dateNowCalls = 0;
  let events = 0;

  for (let elapsed = frameIntervalMs; elapsed < 1000; elapsed += frameIntervalMs) {
    nowMs = 1_000_000 + Math.floor(elapsed);
    navigationContent.recordUserInputForAttention();
    events += 1;
  }

  assert.ok(events > 100, `夹具应当产生上百次事件，实际 ${events}`);
  assert.equal(
    reportedSnapshots.length,
    0,
    "节流窗口内不应有任何上报"
  );
  assert.equal(
    dateNowCalls,
    events,
    `${events} 次被节流的输入调用了 ${dateNowCalls} 次 Date.now() —— ` +
      "应当每次恰好一次。多出来的那次说明仍然进入了 async 的 reportAttentionActivity，" +
      "即每个被丢弃的事件仍在分配 Promise。"
  );
  assert.equal(
    state.lastAttentionActivityReportedAt,
    1_000_000,
    "被节流的调用不得推进上报时间戳（否则节流窗口会被无限延长）"
  );
  assert.equal(
    state.lastUserInputAt,
    nowMs,
    "被节流的调用仍然必须记录用户输入时间"
  );
}

// --- 4. 越过节流窗口后恢复上报 ---
{
  reportedSnapshots = [];
  nowMs = 1_000_000 + 1000;
  navigationContent.recordUserInputForAttention();

  assert.equal(reportedSnapshots.length, 1, "越过 1000ms 后应当恢复上报");
  assert.equal(state.lastAttentionActivityReportedAt, nowMs);

  nowMs += 1;
  navigationContent.recordUserInputForAttention();
  assert.equal(reportedSnapshots.length, 1, "刚上报完又上报了 —— 节流失效");
}

// --- 5. 链接交互与直接调用都不受节流 ---
{
  reportedSnapshots = [];
  navigationContent.recordLinkInteractionForAttention();
  navigationContent.recordLinkInteractionForAttention();

  assert.equal(
    reportedSnapshots.length,
    2,
    "链接交互被节流了 —— 只有 recordUserInputForAttention 应当节流"
  );
  assert.equal(state.lastLinkInteractionAt, nowMs, "链接交互时间没有记录");

  reportedSnapshots = [];
  void navigationContent.reportAttentionActivity();
  void navigationContent.reportAttentionActivity();

  assert.equal(
    reportedSnapshots.length,
    2,
    "直接调用 reportAttentionActivity 被节流了 —— 它的语义是「调用即上报」"
  );
}

// --- 6. 后台接口缺失时不推进时间戳（否则会静默吞掉后续上报窗口）---
{
  const isolated = createAttentionContext({ withBackground: false });
  nowMs += 10_000;
  reportedSnapshots = [];
  isolated.recordUserInputForAttention();

  assert.equal(
    isolated.state.lastAttentionActivityReportedAt,
    0,
    "后台上报接口不可用时推进了时间戳 —— 会白白吞掉一个节流窗口"
  );
  assert.equal(reportedSnapshots.length, 0, "没有后台桥时不应产生上报");
  assert.equal(
    isolated.state.lastUserInputAt,
    nowMs,
    "没有后台桥时仍然必须记录用户输入时间"
  );
}

// --- 7. 隐藏标签页跳过周期性上报 ---
//
// 后台的 resolveAttentionActivity（preload/scheduler/attention/activity.js:52-58）对
// documentVisible !== true 的观测一律返回 { kind: "hidden", weight: 0 }，所以隐藏标签的
// 这一发消息唯一的效果就是唤醒 service worker 来听一句「权重 0」。而 MV3 的 SW 约 30 秒
// 空闲被回收，每标签 15 秒一发意味着两个以上标签打开时 SW 永不回收。
{
  const isolated = createAttentionContext();
  intervalCallbacks = [];
  reportedSnapshots = [];

  isolated.startAttentionActivityReporter();
  assert.equal(reportedSnapshots.length, 1, "启动时应当立即上报一次");
  assert.equal(intervalCallbacks.length, 1, "应当注册了一个周期上报器");

  const tick = intervalCallbacks[0];

  // 可见：正常上报。
  reportedSnapshots = [];
  nowMs += 60_000;
  tick();
  assert.equal(reportedSnapshots.length, 1, "可见标签的周期上报被误跳过");

  // 隐藏：不得上报。
  sandboxDocument.visibilityState = "hidden";
  sandboxDocument.hidden = true;
  reportedSnapshots = [];

  for (let index = 0; index < 20; index += 1) {
    nowMs += 15_000;
    tick();
  }

  assert.equal(
    reportedSnapshots.length,
    0,
    `隐藏标签仍上报了 ${reportedSnapshots.length} 次 —— 每次都会白白唤醒 service worker，` +
      "而后台对隐藏观测一律判为权重 0"
  );

  // 切回可见：立即恢复。
  sandboxDocument.visibilityState = "visible";
  sandboxDocument.hidden = false;
  nowMs += 15_000;
  tick();
  assert.equal(reportedSnapshots.length, 1, "切回可见后周期上报没有恢复");
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "reportAttentionActivity ignores any options passed to it",
        "first user input reports immediately",
        "throttled input never enters the async reporter",
        "throttled input does not advance the report timestamp",
        "throttled input still records last user input time",
        "reporting resumes after the throttle window",
        "link interactions are never throttled",
        "direct reportAttentionActivity calls are never throttled",
        "missing background bridge does not advance the timestamp",
        "hidden tabs skip the periodic report that would wake the service worker",
      ],
    },
    null,
    2
  )
);
