// 配对确认流程的端到端测试：真实浏览器 + 真实扩展 + 真实 Win32 确认框，全程无人值守。
//
// 为什么值得做成自动化而不是留一份「手动步骤」文档：这条链路上的每一次回归都是
// **静默**的（2026-08-09 那天连踩三个：退避从未生效、冷却在弹窗开着时失效、
// 用户点了「连接」却不会被保存），而且没有一个能被单元测试发现——它们只在
// 真实的 HTTP 取消、真实的 MV3 生命周期、真实的模态窗口下才暴露。
//
// 隔离方式：
//   - 浏览器 profile 建在**临时目录里的 Chrome 形状路径**下，只给 app 进程改
//     LOCALAPPDATA 指过去。形状预筛（读 Secure Preferences 的 manifest 指纹）一点没绕过，
//     只是换了扫描根，完全不碰用户真实的浏览器目录。
//   - app 跑 --host，只绑回环端口 + 放托盘图标。会写注册表和 native messaging 清单的是
//     --install/--uninstall，本测试不碰那两条。
//   - app 的配对状态写在它自己 exe 旁边的 portable/ 里，测试前后都清空。
//
// 需要 Windows（Win32 确认框）与已构建的 app 二进制；缺任何一个都跳过而不是假装通过。
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { buildExtensionBrowserArgs, spawnBrowser } from "./lib/browser-process.mjs";
import {
  findFirstExistingExecutable,
  getSharedPlaywrightChromiumPathCandidates,
} from "./lib/browser-paths.mjs";
import { prepareExtensionUnderTest } from "./lib/extension-fixture.mjs";
import { CdpClient } from "./lib/cdp-client.mjs";
import { fetchJson, getFreePort, sleep } from "./lib/test-utils.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dialogScript = path.join(repoRoot, "scripts/testing/lib/win32-dialog.ps1");

// ⚠️ 这个测试会在用户的可见桌面上弹出几次确认框，无法后台化。
//
// 试过用独立的 Win32 桌面（CreateDesktop + STARTUPINFO.lpDesktop）把窗口挪出视线：
// 启动器本身可用（cmd.exe 在自定义桌面上能正常跑完并写文件），但**本 app 在自定义桌面上
// 活不下来** —— 连 `--status` 这种纯命令行模式都不写任何输出，死在初始化阶段，
// 运行日志里连 host-mode-entered 都没有（实测 2026-08-16）。
// 本机也没有可用的虚拟机（Hyper-V 未启用、无 Sandbox、无 VirtualBox/VMware）。
// 所以跑这个测试时请让出屏幕一分钟。

// 用绝对路径调 PowerShell。本机 PATH 长两万多字符，派生进程的查找已经被证明不可靠
// （install-register.cmd 就栽在这上面）。%SystemRoot% 永远可用。
const powershellPath = path.join(
  process.env.SystemRoot || "C:/Windows",
  "System32/WindowsPowerShell/v1.0/powershell.exe"
);

// app 的 target-dir 由 app/.cargo/config.toml 指定，不在仓库里。
const appTargetDir = readCargoTargetDir();
const appExecutable = appTargetDir
  ? path.join(appTargetDir, "debug", "zero-latency-web-app.exe")
  : "";
const portableDir = appExecutable ? path.join(path.dirname(appExecutable), "portable") : "";

// `app/.cargo/config.toml` 把 target-dir 指到一个无空格路径（本机的仓库路径带空格，
// 会让 dlltool/链接器出问题）。那个文件是机器相关的、按 .gitignore 不进版本库，
// 所以全新克隆上没有它 —— 那时 cargo 用的是默认的 app/target，这里必须跟着回退，
// 否则测试会去一个不存在的目录找二进制，然后以「先跑 cargo build」为由跳过，
// 而用户其实已经构建过了。
function readCargoTargetDir() {
  try {
    const config = readFileSync(path.join(repoRoot, "app/.cargo/config.toml"), "utf8");
    const configured = config.match(/target-dir\s*=\s*"([^"]+)"/)?.[1];

    if (configured) {
      return configured;
    }
  } catch (_error) {
    // 没有这个文件是正常的，走下面的默认值。
  }

  return path.join(repoRoot, "app", "target");
}

function skip(reason) {
  console.log(JSON.stringify({ ok: true, skipped: true, reason }, null, 2));
  process.exit(0);
}

if (process.platform !== "win32") {
  skip("配对确认框是 Win32 的，非 Windows 平台没有可测的东西");
}
if (!appExecutable || !existsSync(appExecutable)) {
  skip(`没有已构建的 app 二进制（${appExecutable || "未解析到 target-dir"}）；先运行 cargo build`);
}

// --- 小工具 ---

function runPowerShell(args) {
  return new Promise((resolve) => {
    const child = spawn(
      powershellPath,
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", dialogScript, ...args],
      { windowsHide: true }
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", () => {
      const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? "";
      try {
        resolve(JSON.parse(line));
      } catch (_error) {
        resolve({ ok: false, reason: "unparseable", stdout: stdout.slice(-400), stderr: stderr.slice(-400) });
      }
    });
  });
}

// 命令链接在 UIA 里不可激活，点击走 TaskDialog 的 TDM_CLICK_BUTTON，需要按钮的命令 ID。
// ID 从 Rust 源码里读，避免在测试里另抄一份 —— 改了那边这里会立刻炸，而不是默默点错按钮。
const buttonIds = readDialogButtonIds();

function readDialogButtonIds() {
  const source = readFileSync(path.join(repoRoot, "app/src/api/pairing/mod.rs"), "utf8");
  const confirm = Number(source.match(/const CONFIRM_BUTTON_ID: i32 = (\d+);/)?.[1]);
  const decline = Number(source.match(/const DECLINE_BUTTON_ID: i32 = (\d+);/)?.[1]);

  assert.ok(
    Number.isInteger(confirm) && Number.isInteger(decline),
    "没能从 app/src/api/pairing/mod.rs 解析出按钮命令 ID"
  );

  return { confirm, decline };
}

const clickDialogButton = (buttonName, buttonId, timeoutSeconds = 60) =>
  runPowerShell([
    "-Command",
    "click",
    "-ButtonName",
    buttonName,
    "-ButtonId",
    String(buttonId),
    "-TimeoutSeconds",
    String(timeoutSeconds),
  ]);
const expectNoDialog = (watchSeconds) =>
  runPowerShell(["-Command", "expect-none", "-TimeoutSeconds", String(watchSeconds)]);

function portableFile(name) {
  return path.join(portableDir, name);
}

function readPortable(name) {
  try {
    return readFileSync(portableFile(name), "utf8").trim();
  } catch (_error) {
    return null;
  }
}

function clearPortableState() {
  for (const name of [
    "allowed-extension-origins.txt",
    "allowed-extension-origin.txt",
    "pairing-decline-count.txt",
    "pairing-prompts-suppressed.txt",
    "ui-locale.txt",
  ]) {
    rmSync(portableFile(name), { force: true });
  }
}

function readRuntimeEvents() {
  try {
    return readFileSync(portableFile("app-runtime-events.jsonl"), "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (_error) {
          return null;
        }
      })
      .filter(Boolean);
  } catch (_error) {
    return [];
  }
}

function eventsSince(sinceMs, name) {
  return readRuntimeEvents().filter(
    (event) => event.recordedAtMs >= sinceMs && event.eventName === name
  );
}

// --- 实验台：临时 Chrome 形状 profile + 源码版扩展 ---

const labRoot = path.join(os.tmpdir(), `zlw-pairflow-${process.pid}`);
const fakeLocalAppData = path.join(labRoot, "LocalAppData");
const profileDir = path.join(fakeLocalAppData, "Google", "Chrome", "User Data");
const extensionDir = path.join(labRoot, "extension");

const cleanupHandles = { browser: null, app: null };
let appOutput = "";
let appExitInfo = "";

function stopEverything() {
  for (const child of [cleanupHandles.app, cleanupHandles.browser]) {
    try {
      child?.kill();
    } catch (_error) {
      // 关不掉就算了，下面还有按名字兜底。
    }
  }
  try {
    spawnSync("taskkill", ["/F", "/IM", "zero-latency-web-app.exe"], { windowsHide: true });
  } catch (_error) {
    // 进程可能已经退了。
  }
}

process.on("exit", stopEverything);
process.on("uncaughtException", (error) => {
  stopEverything();
  console.error(error);
  process.exit(1);
});

function startApp() {
  // ⚠️ 绝不能加 windowsHide。它会在 STARTUPINFO 里带上 SW_HIDE，而 Windows 会把这个
  // 启动显示命令**套用到进程的第一个顶层窗口**上 —— 正好就是配对确认框。
  // 结果是弹窗被创建成隐藏的：日志里 awaiting-confirmation 照常出现，屏幕上什么都没有，
  // 自动化也永远等不到它。app 本身是 windows_subsystem = "windows"，不加也不会闪控制台。
  //
  // stderr 也必须收着：正因为没有控制台，启动失败时输出无处可去，而运行日志可能只停在
  // host-mode-entered。丢掉 stderr 的话，测试只能报「app 没有起来」，查不出为什么
  // （实测 2026-08-11 就卡在这一步）。
  const child = spawn(appExecutable, ["--host"], {
    env: {
      ...process.env,
      LOCALAPPDATA: fakeLocalAppData,
      ZLW_DEBUG_FORCE_HOST: "1",
      RUST_BACKTRACE: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  appOutput = "";
  child.stdout?.on("data", (chunk) => (appOutput += chunk));
  child.stderr?.on("data", (chunk) => (appOutput += chunk));
  child.on("exit", (code, signal) => {
    appExitInfo = `code=${code} signal=${signal}`;
  });

  cleanupHandles.app = child;
  return child;
}

// app 起不来时把能拿到的线索都摆出来：进程输出、退出码、以及运行日志的尾巴。
function describeAppStartupFailure() {
  const tail = readRuntimeEvents()
    .slice(-6)
    .map((event) => `${event.eventName}${event.detail ? ` (${event.detail})` : ""}`)
    .join(" → ");

  return [
    "app 没有起来。",
    `退出信息：${appExitInfo || "(进程还在跑，只是没绑上端口)"}`,
    `进程输出：${appOutput.trim() || "(空)"}`,
    `运行日志尾部：${tail || "(空)"}`,
  ].join("\n  ");
}

async function stopApp() {
  try {
    cleanupHandles.app?.kill();
  } catch (_error) {
    // 忽略。
  }
  cleanupHandles.app = null;

  // 端口释放前起下一个实例会撞端口，等它真的没了。
  for (let waited = 0; waited < 15000; waited += 300) {
    const alive = await fetchJson("http://127.0.0.1:45831/health").catch(() => null);
    if (alive === null) {
      break;
    }
    await sleep(300);
  }
  await sleep(500);
}

async function waitForAppReady() {
  for (let waited = 0; waited < 30000; waited += 300) {
    // /health 受 origin 网关保护，未配对时返回 403 —— 拿到任何 HTTP 响应就说明起来了。
    const reachable = await fetch("http://127.0.0.1:45831/health")
      .then(() => true)
      .catch(() => false);
    if (reachable) {
      return true;
    }
    await sleep(300);
  }
  return false;
}


// 重载实验台扩展。用于把扩展侧的易变状态（配对退避存在 chrome.storage.session 里）
// 确定性地清掉，让断言只反映被测的那件事。
async function reloadExtension() {
  const targets = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`).catch(() => null);
  const worker = (targets || []).find(
    (target) => target.type === "service_worker" && String(target.url).endsWith("/service-worker.js")
  );

  if (!worker) {
    return false;
  }

  const client = await CdpClient.connect(worker.webSocketDebuggerUrl);
  await client.send("Runtime.evaluate", { expression: "chrome.runtime.reload()" }).catch(() => {});
  client.close();

  // 等新的 service worker 起来。
  for (let waited = 0; waited < 30_000; waited += 500) {
    const list = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`).catch(() => null);
    if ((list || []).some((t) => t.type === "service_worker" && String(t.url).endsWith("/service-worker.js"))) {
      await sleep(1500);
      return true;
    }
    await sleep(500);
  }

  return false;
}

// --- 场景 ---

const checked = [];

await mkdir(profileDir, { recursive: true });
await prepareExtensionUnderTest({
  extensionDir: path.join(repoRoot, "extension"),
  targetDir: extensionDir,
  preferPackaged: false,
});

const executablePath = findFirstExistingExecutable(getSharedPlaywrightChromiumPathCandidates());
const debugPort = await getFreePort();
cleanupHandles.browser = spawnBrowser(
  executablePath,
  buildExtensionBrowserArgs({
    profileDir,
    debugPort,
    extensionDir,
    startUrl: "about:blank",
    windowSize: "1100,800",
    // 界面语言必须由测试指定，不能跟着运行环境走：默认的 Chromium 是英文界面，
    // 断言就会随机地对上英文或中文。指定之后这条链路本身也被验了——
    // 浏览器语言 → 扩展 resolveLocaleId → X-ZLW-Extension-Locale → app 选文案。
    extraArgs: ["--lang=zh-CN"],
  })
);

let extensionId = "";
for (let waited = 0; waited < 45000; waited += 400) {
  const targets = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`).catch(() => null);
  const worker = (targets || []).find(
    (target) => target.type === "service_worker" && String(target.url).endsWith("/service-worker.js")
  );
  if (worker) {
    extensionId = new URL(worker.url).host;
    break;
  }
  await sleep(400);
}
assert.ok(extensionId, "实验台扩展没起来，拿不到 service worker");

// app 的形状预筛读的是 profile 里的 `Secure Preferences`，而 Chrome 是**惰性**写它的：
// 扩展已经在跑了，条目却可能还没落盘，这时起 app 会直接判 Rejected（连弹窗都不弹）。
// 这不是产品问题，是测试时序 —— 等条目出现再继续。
{
  const securePreferences = path.join(profileDir, "Default", "Secure Preferences");
  let visible = false;

  for (let waited = 0; waited < 90_000; waited += 1000) {
    try {
      if (readFileSync(securePreferences, "utf8").includes(extensionId)) {
        visible = true;
        break;
      }
    } catch (_error) {
      // 文件还没建出来。
    }
    await sleep(1000);
  }

  assert.ok(
    visible,
    `等了 90 秒，${extensionId} 仍未出现在 Secure Preferences —— app 的形状预筛看不到它，` +
      "整条流程都不会有弹窗"
  );
}

clearPortableState();

// --- 1. 拒绝一次：计数落盘，且弹的确实是配对框 ---
{
  startApp();
  assert.ok(await waitForAppReady(), describeAppStartupFailure());

  const clicked = await clickDialogButton("不连接", buttonIds.decline, 90);
  assert.ok(clicked.ok, `没能点掉配对确认框：${JSON.stringify(clicked)}`);

  // 按钮文字同时验了两件事：弹的是配对框（不是「不再提示」框），以及语言跟着扩展走。
  assert.ok(
    clicked.buttons.some((name) => name.includes("连接这个扩展")),
    `配对框的按钮不对：${JSON.stringify(clicked.buttons)}`
  );
  assert.ok(
    clicked.texts.some((text) => text.includes(extensionId)),
    "配对框正文里没有扩展 ID —— 用户核对的就是这一串"
  );

  await sleep(1500);
  assert.equal(
    readPortable("pairing-decline-count.txt"),
    "1",
    "拒绝之后计数没有落盘 —— app 由浏览器唤醒、一天起停很多次，只放内存的话阈值永远到不了"
  );

  // 语言链路：浏览器 --lang → 扩展 resolveLocaleId → 请求头 → app 选文案。
  // 上面按中文按钮名点成功了已经隐含了这条，这里再显式钉一下落盘的那一环。
  assert.equal(
    readPortable("ui-locale.txt"),
    "zh_CN",
    "app 没有记住扩展声明的界面语言 —— 托盘菜单会和弹窗不同语言"
  );

  checked.push("a decline is recorded and persisted, and the dialog is the pairing one");
  checked.push("the extension's UI language reaches the app and drives the dialog text");
  await stopApp();
}

// --- 2. 攒够阈值：紧接着弹「不再提示」，确认后开关落盘 ---
//
// 计数预置到 2 是为了跳过两次 5 分钟冷却的等待；累加逻辑本身由
// api/state.rs 的单元测试钉着，这里要验的是**到阈值那一下**的真实行为。
{
  writeFileSync(portableFile("pairing-decline-count.txt"), "2");
  startApp();
  assert.ok(await waitForAppReady(), describeAppStartupFailure());

  const declined = await clickDialogButton("不连接", buttonIds.decline, 90);
  assert.ok(declined.ok, `第二次配对框没点掉：${JSON.stringify(declined)}`);

  const offer = await clickDialogButton("不再提示", buttonIds.confirm, 30);
  assert.ok(
    offer.ok,
    `连续拒绝到阈值后没有弹出「不再提示」确认框：${JSON.stringify(offer)}`
  );
  assert.ok(
    offer.buttons.some((name) => name.includes("继续提示")),
    `「不再提示」框的按钮不对：${JSON.stringify(offer.buttons)}`
  );
  // 这里刻意**不**断言正文：紧跟在上一个确认框之后弹出的第二个框，其文本元素不进 UIA 树
  // （实测 2026-08-10：等满 30 秒 texts 仍为 []，buttons 却一直是全的）。
  // 「页脚必须写明怎么手动配对」这条性质由 Rust 侧的
  // every_supported_locale_has_stop_asking_text 与 pairing-dialog-locales.mjs 负责，
  // 这里只认按钮名 —— 别看到 texts 为空就以为是漏了断言而把它加回来。

  await sleep(1500);
  assert.equal(
    readPortable("pairing-prompts-suppressed.txt"),
    "1",
    "选了「不再提示」但开关没落盘"
  );
  assert.equal(
    readPortable("pairing-decline-count.txt"),
    "0",
    "弹过一次之后计数没清零 —— 之后每拒绝一次都会再追问一遍"
  );

  checked.push("three declines surface the stop-asking offer, and accepting it persists");
  await stopApp();
}

// --- 3. 关掉之后必须真的安静 ---
{
  const startedAt = Date.now();
  startApp();
  assert.ok(await waitForAppReady(), describeAppStartupFailure());

  // 扩展的心跳与唤醒重试各 30 秒一次，看 75 秒足以覆盖两轮。
  const silence = await expectNoDialog(75);
  assert.ok(silence.ok, `关掉提示后仍然弹了窗：${JSON.stringify(silence)}`);

  const suppressedEvents = eventsSince(startedAt, "extension-register-prompt-suppressed-by-user");
  assert.ok(
    suppressedEvents.length > 0,
    "没有看到 prompt-suppressed-by-user —— 那说明扩展压根没来注册，" +
      "上面的「没弹窗」就不能证明是抑制生效了"
  );

  checked.push("suppressed prompts stay silent while registrations keep arriving");
  await stopApp();
}

// --- 4. 抑制不影响已配对的扩展 ---
//
// 「不再提示」关的是**询问**，不是功能。已经配对过的扩展必须照常放行。
{
  writeFileSync(
    portableFile("allowed-extension-origins.txt"),
    `chrome-extension://${extensionId}`
  );
  // 上一步里扩展连吃 403，已经进了 10 分钟退避。产品上它会靠一次成功的健康探测解除
  // （见 native-app/health.js），但那依赖唤醒重试的定时器节奏，等多久不确定。
  //
  // 这一步要验的是「已配对的扩展能连上」，不该被退避的计时搅进来。重载扩展会重建
  // service worker 上下文并清掉 chrome.storage.session，退避随之归零 —— 于是这条断言
  // 只反映配对状态本身，不会时好时坏。
  await reloadExtension();

  const startedAt = Date.now();
  startApp();
  assert.ok(await waitForAppReady(), describeAppStartupFailure());

  for (let waited = 0; waited < 90_000; waited += 1000) {
    if (eventsSince(startedAt, "extension-register-succeeded").length > 0) {
      break;
    }
    await sleep(1000);
  }

  assert.ok(
    eventsSince(startedAt, "extension-register-succeeded").length > 0,
    "已配对的扩展在「不再提示」开启时连不上了 —— 那个开关关的是询问，不是功能"
  );

  checked.push("an already paired extension still connects while prompts are suppressed");
  await stopApp();
}

clearPortableState();
stopEverything();

console.log(JSON.stringify({ ok: true, extensionId, checked }, null, 2));
process.exit(0);
