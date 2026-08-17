// 三道安全纵深闸门。
//
// M24 本地威胁库 fail-open：inspectUrl 是**同步**的，而调用方（preload/safety-policy.js:46）
//     不等 bootstrap 完成，所以 service worker 冷启动的头几毫秒里它会先被调用。此前那种情况
//     与「库已加载但没命中」返回同一个 blocked: false —— 每次冷启动都有一段窗口，全部危险
//     站点检查静默放行且无人知晓。而内容脚本那侧的同类检查本来就是 fail-closed
//     （scripts/navigation/shared/safety.js:32-41），两边策略此前不一致。
//     代价可量化：库是 2.25 MB 打包内资源，实测 JSON.parse 约 5-7 ms。
//
// M5  四个特权消息缺 fromExtensionUi 门禁，而同一个 switch 里所有同级消息都有。
//     其中 visit-graph:reset 会清空整张学习图 —— 按 invariants 第 7 条那正是产品价值本体。
//
// M4  native-app:update-to-version 把调用方给的 assetUrl 原样交给本地更新器去下载并执行。
//     Rust 侧有前缀校验兜底，但扩展侧必须独立校验，不能把「对方会检查」当成自己的控制措施。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// --- M24：库未就绪时必须 fail closed ---
{
  const bundleSource = [
    "../../extension/background/security/threat-database/fingerprint.js",
    "../../extension/background/security/threat-database/sources.js",
    "../../extension/background/security/threat-database.js",
  ]
    .map((filePath) => readFileSync(new URL(filePath, import.meta.url), "utf8"))
    .join("\n");

  const sandbox = { console, URL, TextEncoder, Set, Map, Object, Array, String, Number, Math, JSON };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(bundleSource, context, { filename: "threat-database-bundle.js" });

  const database = context.ZeroLatencyLocalThreatDatabase;

  // 库还没到（冷启动窗口）。
  assert.equal(database.isLibraryReady(), false, "前置条件：库尚未加载");

  const pendingDecision = database.inspectUrl("https://anything.example/page");
  assert.equal(
    pendingDecision.blocked,
    true,
    "库未就绪时返回 blocked: false —— 每次 SW 冷启动都有一段窗口全部危险站点检查静默放行"
  );
  assert.equal(pendingDecision.unavailable, true, "应当标明是「不可用」而非「命中威胁」");
  assert.equal(
    pendingDecision.reason,
    "dangerous-site-local-threat-library-unavailable",
    "拦截原因必须与真实命中区分开，否则无法诊断"
  );
  assert.equal(pendingDecision.evidence.verdict, "unknown");
  assert.equal(pendingDecision.evidence.libraryState, "pending");

  // 非法 URL 仍然直接放行（那是「没有可查的东西」，不是「查不了」）。
  assert.equal(database.inspectUrl("").blocked, false, "空 URL 不该被当成危险站点");

  // 库到位后恢复正常判定。
  context.ZeroLatencyLocalThreatLibrary = {
    version: 1,
    generatedAt: "2026-06-16T05:36:38.487Z",
    sources: [{ id: "test-source", name: "Test", threatTypes: ["malware"], fingerprintCount: 0 }],
    urlFingerprintsBySource: { "test-source": [] },
    hostFingerprintsBySource: { "test-source": [] },
  };

  assert.equal(database.isLibraryReady(), true);
  assert.equal(
    database.inspectUrl("https://anything.example/page").blocked,
    false,
    "库就绪且未命中时应当放行"
  );

  const status = database.getLibraryLoadStatus();
  assert.equal(status.generatedAt, "2026-06-16T05:36:38.487Z", "快照日期必须可查询");
  assert.deepEqual(Array.from(status.sourceIds, String), ["test-source"]);
}

// --- M5：四个特权消息必须门控 fromExtensionUi ---
{
  const judgeSource = readFileSync(
    new URL("../../extension/background/judge/messages.js", import.meta.url),
    "utf8"
  );
  const sandbox = { console, Object, Array, String, Boolean };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(judgeSource, context, { filename: "judge/messages.js" });

  const judge = context.ZeroLatencyMessageJudge?.judgeMessageEnvelope;
  assert.equal(typeof judge, "function", "没能取到 judgeMessageEnvelope");

  const privilegedTypes = [
    "visit-graph:reset",
    "extension:set-service-paused",
    "extension:open-settings",
    "extension:get-service-state",
  ];

  for (const messageType of privilegedTypes) {
    const withoutUi = judge({
      kind: "runtime-message",
      messageType,
      context: {},
    });
    assert.equal(
      withoutUi?.disposition,
      "ignore",
      `${messageType} 在没有 fromExtensionUi 时仍被放行 —— ` +
        "同一 switch 里所有同级特权消息都要求这个门禁"
    );

    const withUi = judge({
      kind: "runtime-message",
      messageType,
      context: { fromExtensionUi: true },
    });
    assert.notEqual(
      withUi?.disposition,
      "ignore",
      `${messageType} 带 fromExtensionUi 时也被拦了 —— 扩展 UI 自己用不了`
    );
  }
}

// --- M4：assetUrl 必须限定在官方 release 前缀 ---
{
  const updateSource = readFileSync(
    new URL("../../extension/background/core/messages/native-app-update.js", import.meta.url),
    "utf8"
  );
  const submittedTasks = [];
  const sandbox = {
    console,
    URL,
    String,
    Object,
    Error,
    ZeroLatencyBackgroundTasks: {
      submitTask: (task) => {
        submittedTasks.push(task);
        return { id: "task-1" };
      },
    },
    fetchNativeApp: async () => ({ ok: true }),
  };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(updateSource, context, { filename: "native-app-update.js" });

  const handler =
    context.ZeroLatencyCoreNativeAppUpdateMessages?.handleNativeAppUpdateToVersion;
  assert.equal(typeof handler, "function", "没能取到 handleNativeAppUpdateToVersion");

  const OFFICIAL =
    "https://github.com/BIOcanse/Smart-Preload/releases/download/v1.2.3/app-v1.2.3.zip";

  async function expectRejected(assetUrl, note) {
    submittedTasks.length = 0;
    await assert.rejects(
      () => handler({ targetVersion: "1.2.3", assetName: "app.zip", assetUrl }),
      undefined,
      `${assetUrl} 未被拒绝 —— ${note}`
    );
    assert.equal(submittedTasks.length, 0, `${assetUrl} 被拒绝了却仍然提交了下载任务`);
  }

  await expectRejected("https://evil.test/payload.zip", "完全不同的主机");
  await expectRejected("http://github.com/BIOcanse/Smart-Preload/releases/download/v1/a.zip", "明文 http");
  await expectRejected(
    "https://github.com.evil.test/BIOcanse/Smart-Preload/releases/download/v1/a.zip",
    "后缀伪装主机名"
  );
  await expectRejected(
    "https://user@github.com/BIOcanse/Smart-Preload/releases/download/v1/a.zip",
    "userinfo 混淆"
  );
  await expectRejected(
    "https://github.com/BIOcanse/Other-Repo/releases/download/v1/a.zip",
    "同主机但不同仓库"
  );
  await expectRejected("not a url", "非法 URL");

  // 官方地址必须放行。
  submittedTasks.length = 0;
  await handler({ targetVersion: "1.2.3", assetName: "app.zip", assetUrl: OFFICIAL });
  assert.equal(submittedTasks.length, 1, "官方 release 地址被误拒");

  // releaseUrl 给了就要校验，没给则可选。
  await expectRejected2();

  async function expectRejected2() {
    submittedTasks.length = 0;
    await assert.rejects(() =>
      handler({
        targetVersion: "1.2.3",
        assetName: "app.zip",
        assetUrl: OFFICIAL,
        releaseUrl: "https://evil.test/tag/v1.2.3",
      })
    );
    assert.equal(submittedTasks.length, 0);
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "threat library fails closed while unloaded, with a distinguishable reason",
        "threat library load status (generatedAt / sources) is queryable",
        "empty URLs are still allowed through",
        "four privileged messages now require fromExtensionUi",
        "extension UI can still use those messages",
        "native app update asset URL must be an official release asset",
        "host-suffix, userinfo, plain-http and wrong-repo spoofs are rejected",
        "release URL is validated when supplied",
      ],
    },
    null,
    2
  )
);
