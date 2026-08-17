// 统一测试入口。
//
// 在此之前，scripts/testing/ 下的每个测试都必须手工逐个 `node` 调用，没有清单、没有
// 聚合，因此无法确认整套是不是绿的。测试本身的退出码契约是对的（顶层 node:assert 断言
// 失败会以未处理拒绝让 Node 非零退出），缺的只是聚合。
//
//   node scripts/testing/run-all.mjs              仅单元测试（默认，无需浏览器）
//   node scripts/testing/run-all.mjs --all        单元 + 浏览器
//   node scripts/testing/run-all.mjs --browser    仅浏览器测试
//   node scripts/testing/run-all.mjs --filter click
//   node scripts/testing/run-all.mjs --list       只打印分类，不执行
//
// 分类是从文件内容推出来的，不是硬编码名单，这样新增测试会被自动归类。用 --list 可以
// 随时查看判定结果；判错了就改下面的规则，而不是维护一份会过期的名单。
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

const SELF = path.basename(__filename);
const DEFAULT_TIMEOUT_MS = 120_000;
const BROWSER_TIMEOUT_MS = 900_000;

// 需要真实 Chromium/Edge：直接或间接用到浏览器启动与 CDP 的公共库。
const BROWSER_LIB_PATTERN =
  /from "\.\/lib\/(browser-process|cdp-client|cdp-discovery|extension-fixture|extension-service-worker|browser-paths)\.mjs"/;
// 需要外部服务（本机 LM Studio），没起服务时会失败，不算回归。
const EXTERNAL_SERVICE_PATTERN = /lmstudio/i;
// 诊断工具，不是通过/失败形式的测试。
const DIAGNOSTIC_SCRIPTS = new Set(["diagnose-extension-load.mjs"]);

function classify(fileName, source) {
  if (fileName === SELF) return "self";
  if (DIAGNOSTIC_SCRIPTS.has(fileName)) return "diagnostic";
  // 顶层有 export 的是被别的测试 import 的库，不能独立运行。
  if (/^export /m.test(source)) return "helper";
  if (EXTERNAL_SERVICE_PATTERN.test(fileName)) return "external";
  if (BROWSER_LIB_PATTERN.test(source)) return "browser";
  return "unit";
}

function collectScripts() {
  return readdirSync(__dirname)
    .filter((name) => name.endsWith(".mjs"))
    .sort()
    .map((name) => {
      const filePath = path.join(__dirname, name);
      return { name, filePath, kind: classify(name, readFileSync(filePath, "utf8")) };
    });
}

function parseArguments(argv) {
  const options = {
    unit: true,
    browser: false,
    external: false,
    list: false,
    filter: null,
    timeoutMs: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--all") {
      options.browser = true;
    } else if (argument === "--browser") {
      options.browser = true;
      options.unit = false;
    } else if (argument === "--external") {
      options.external = true;
    } else if (argument === "--list") {
      options.list = true;
    } else if (argument === "--filter") {
      options.filter = argv[index + 1] ?? null;
      index += 1;
    } else if (argument.startsWith("--timeout=")) {
      options.timeoutMs = Number(argument.slice("--timeout=".length));
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

function runScript(script, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [script.filePath], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
    let timedOut = false;
    timer.unref?.();
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      timedOut = signal === "SIGKILL";
      resolve({
        ...script,
        ok: code === 0 && !timedOut,
        code,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
      });
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({
        ...script,
        ok: false,
        code: null,
        timedOut: false,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr: String(error),
      });
    });
  });
}

function formatDuration(durationMs) {
  return durationMs >= 1000 ? `${(durationMs / 1000).toFixed(1)}s` : `${durationMs}ms`;
}

const options = parseArguments(process.argv.slice(2));
const scripts = collectScripts();

if (options.list) {
  const byKind = new Map();
  for (const script of scripts) {
    if (!byKind.has(script.kind)) byKind.set(script.kind, []);
    byKind.get(script.kind).push(script.name);
  }
  for (const kind of ["unit", "browser", "external", "helper", "diagnostic"]) {
    const names = byKind.get(kind) || [];
    console.log(`\n${kind} (${names.length})`);
    for (const name of names) console.log(`  ${name}`);
  }
  process.exit(0);
}

const selected = scripts.filter((script) => {
  if (script.kind === "unit" && !options.unit) return false;
  if (script.kind === "browser" && !options.browser) return false;
  if (script.kind === "external" && !options.external) return false;
  if (!["unit", "browser", "external"].includes(script.kind)) return false;
  if (options.filter && !script.name.includes(options.filter)) return false;
  return true;
});

if (selected.length === 0) {
  console.error("No tests matched.");
  process.exit(1);
}

const skipped = scripts.filter(
  (script) => ["unit", "browser", "external"].includes(script.kind) && !selected.includes(script)
);

console.log(`Running ${selected.length} test(s)${options.filter ? ` matching "${options.filter}"` : ""}.`);
if (skipped.length > 0) {
  const skippedKinds = [...new Set(skipped.map((script) => script.kind))].join(", ");
  console.log(`Skipping ${skipped.length} (${skippedKinds}). Use --all / --external to include.`);
}
console.log("");

const results = [];

for (const script of selected) {
  const timeoutMs =
    options.timeoutMs ?? (script.kind === "browser" ? BROWSER_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
  process.stdout.write(`  ${script.name} ... `);
  const result = await runScript(script, timeoutMs);
  results.push(result);
  const status = result.ok ? "PASS" : result.timedOut ? "TIMEOUT" : `FAIL(${result.code})`;
  console.log(`${status} ${formatDuration(result.durationMs)}`);
}

const failures = results.filter((result) => !result.ok);

if (failures.length > 0) {
  console.log("\n--- failures ---");
  for (const failure of failures) {
    console.log(`\n### ${failure.name}`);
    const output = `${failure.stdout}\n${failure.stderr}`.trim().split("\n");
    // 断言信息在尾部，头部通常是进度噪音。
    console.log(output.slice(-25).join("\n"));
  }
}

const totalMs = results.reduce((sum, result) => sum + result.durationMs, 0);
console.log(
  `\n${results.length - failures.length}/${results.length} passed in ${formatDuration(totalMs)}.`
);

process.exit(failures.length > 0 ? 1 : 0);
