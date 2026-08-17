// service-worker 打包产物的结构性不变量。
//
// 背景：发布时 scripts/build-service-worker-bundle.mjs 会把 service-worker-scripts.js
// 里列出的文件**拼接成同一个 classic script**；开发态则由 service-worker.js 用
// importScripts 逐个加载 —— 两者共享同一个全局词法环境，因此约束完全相同。这意味着每个
// 没有 IIFE 包裹的顶层声明都落在同一个作用域里，而加载顺序是一份手工维护的数组。
//
// 这个文件把几条一直靠人记住的约束变成机器检查：
//   1. 不得有重复的顶层绑定名。
//   2. 清单里列出的文件必须存在，且不得是零可执行代码的空壳。
//   3. 拼接产物必须能通过语法检查（打包脚本已做，这里保证不依赖发布流程也能发现）。
//   4. 拼接产物必须能被求值（语法合法但悬空引用会在启动第一毫秒炸掉整个扩展）。
//
// 第 1 条不是理论问题：审查时发现 buildSchedulerLinkScoreSignal 在
// selection-targets/group.js 和 strategy/signals.js 里各有一份**逐字节相同**的顶层
// function 定义。因为都是 `function` 声明，后加载的静默覆盖先加载的，所以没出事——
// 但只要其中一个改用 `const` / `class`，拼接后就是
// "Identifier has already been declared"，**service worker 直接起不来，整个扩展死掉**。
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const extensionRoot = path.join(repoRoot, "extension");
const manifestPath = path.join(extensionRoot, "service-worker-scripts.js");

// 读出打包清单，用的正是 build-service-worker-bundle.mjs 的办法。
const manifestContext = vm.createContext({ globalThis: {} });
vm.runInContext(readFileSync(manifestPath, "utf8"), manifestContext, { filename: manifestPath });
const rawScriptPaths = manifestContext.globalThis.ZERO_LATENCY_SERVICE_WORKER_SCRIPTS;

assert.ok(
  rawScriptPaths && typeof rawScriptPaths.length === "number" && rawScriptPaths.length > 0,
  "打包清单为空或无效"
);

// 清单来自 vm context，它的数组原型属于那个 realm；直接拿去 deepStrictEqual 会因为
// 原型不同而误报。先搬回宿主 realm。
const scriptPaths = Array.from(rawScriptPaths, String);

// --- 2. 清单里的文件都存在 ---
const missingFiles = scriptPaths.filter(
  (relativePath) => !existsSync(path.join(extensionRoot, relativePath))
);
assert.deepEqual(missingFiles, [], `打包清单引用了不存在的文件：${missingFiles.join(", ")}`);

// --- 2b. 清单里不得有零可执行代码的文件 ---
//
// 曾有 10 个「薄导出边界」文件（内容只有一行注释，其中 transitions/query.js 是 0 字节）
// 留在清单里：每次 service worker 冷启动都要多 10 次 importScripts，而且占着这份手工维护
// 的加载顺序数组。它们的注释只说「实现已搬走」，活代码里零引用，已删除。
const commentOnlyFiles = scriptPaths.filter((relativePath) => {
  const source = readFileSync(path.join(extensionRoot, relativePath), "utf8");
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .trim();
  return stripped === "";
});

assert.deepEqual(
  commentOnlyFiles,
  [],
  `打包清单里有零可执行代码的文件（每次冷启动白跑一次 importScripts）：\n  ${commentOnlyFiles.join("\n  ")}`
);

// --- 1. 无重复顶层绑定 ---
// 只看第 0 列的声明：本仓库的 IIFE 包裹模块一律缩进，所以顶格声明就等价于
// “拼接后进入全局作用域”。
const TOP_LEVEL_DECLARATION = /^(?:(?:async\s+)?function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/;
const bindings = new Map();

scriptPaths.forEach((relativePath, loadIndex) => {
  const source = readFileSync(path.join(extensionRoot, relativePath), "utf8");

  source.split("\n").forEach((line, lineIndex) => {
    const match = line.match(TOP_LEVEL_DECLARATION);

    if (!match) {
      return;
    }

    const name = match[1];
    const kind = line.trim().split(/\s+/)[0];

    if (!bindings.has(name)) {
      bindings.set(name, []);
    }

    bindings.get(name).push({
      name,
      kind,
      loadIndex,
      location: `${relativePath}:${lineIndex + 1}`,
    });
  });
});

const duplicates = [...bindings.values()].filter((sites) => sites.length > 1);

if (duplicates.length > 0) {
  const report = duplicates
    .map((sites) => {
      const fatal = sites.some((site) => ["const", "let", "class"].includes(site.kind));
      const severity = fatal
        ? "致命：拼接后会抛 Identifier has already been declared，service worker 无法启动"
        : "静默覆盖：后加载的定义会赢，先加载的那份永远不执行";
      const detail = sites
        .map((site) => `      load#${site.loadIndex} ${site.location} (${site.kind})`)
        .join("\n");
      return `  ${sites[0].name}\n    ${severity}\n${detail}`;
    })
    .join("\n\n");

  assert.fail(`service-worker 打包清单存在重复顶层绑定：\n\n${report}\n`);
}

// --- 3. 拼接产物语法有效 ---
const bundle = scriptPaths
  .map((relativePath) => readFileSync(path.join(extensionRoot, relativePath), "utf8").trimEnd())
  .join("\n\n");

new vm.Script(bundle, { filename: "service-worker-runtime.js" });

// --- 4. 拼接产物能被求值 ---
//
// 语法检查挡不住悬空引用：`{ someName }` 这样的对象字面量简写在语法上完全合法，
// 只有**求值时**才抛 ReferenceError —— 而那发生在 service worker 启动的第一毫秒，
// 结果是整个扩展起不来。删除一个函数却漏改它的导出面，就是这个形状。
//
// 这里用最小桩把 bundle 真跑一遍。bundle 本身只做定义（真正的事件注册在
// service-worker.js 里），所以不需要完整的 chrome API，只要不抛即可。
const evaluationSandbox = {
  console,
  TextEncoder,
  TextDecoder,
  URL,
  URLSearchParams,
  structuredClone,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  crypto,
  fetch: () => {},
  // 任意 chrome.* 访问都返回一个既可调用又可继续取属性的占位物。
  chrome: new Proxy(
    {},
    {
      get: () =>
        new Proxy(function () {}, {
          get: () => () => {},
          apply: () => {},
        }),
    }
  ),
};
evaluationSandbox.globalThis = evaluationSandbox;
evaluationSandbox.self = evaluationSandbox;
vm.createContext(evaluationSandbox);

try {
  vm.runInContext(bundle, evaluationSandbox, { filename: "service-worker-runtime.js" });
} catch (error) {
  assert.fail(
    `service-worker bundle 求值失败 —— service worker 会在启动时直接崩溃：\n` +
      `  ${error.constructor.name}: ${error.message}\n` +
      `  常见原因：删了某个函数但漏改引用它的导出面。`
  );
}

// 顺带把规模报出来，便于观察冷启动成本的变化趋势。
// MV3 的 service worker 大约空闲 30 秒就被回收，这份产物在每次冷启动都要重新执行。
const bundleBytes = Buffer.byteLength(bundle, "utf8");
const iifeWrapped = scriptPaths.filter((relativePath) => {
  const firstLine = readFileSync(path.join(extensionRoot, relativePath), "utf8")
    .split("\n")
    .find((line) => line.trim() && !line.trim().startsWith("//"));
  return firstLine !== undefined && /^\s*\((?:function|\(\))/.test(firstLine);
}).length;

console.log(
  JSON.stringify(
    {
      ok: true,
      scriptCount: scriptPaths.length,
      topLevelBindings: bindings.size,
      duplicateBindings: 0,
      iifeWrappedFiles: iifeWrapped,
      globalScopeFiles: scriptPaths.length - iifeWrapped,
      bundleKiB: Number((bundleBytes / 1024).toFixed(1)),
    },
    null,
    2
  )
);
