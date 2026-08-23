// 仓库里**允许存在什么**的不变量。
//
// .gitignore 只在「文件还没被跟踪」时起作用：`git add -f` 能绕过它，而在加规则之前就
// 已经进库的东西它一个字都管不着。所以真正的护栏在这里 —— 判据是 `git ls-files`
// （版本库里实际有什么），不是 .gitignore 里写了什么。
//
// 三条规则，各自的理由写在下面。任何一条挡住了你想提交的东西，先想清楚那个东西是不是
// 真的该进版本库；确实该进，就在这里显式加进允许名单，而不是把规则删掉。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const tracked = execFileSync("git", ["-C", repoRoot, "ls-files"], { encoding: "utf8" })
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

assert.ok(tracked.length > 100, `git ls-files 只返回 ${tracked.length} 条，这条检查没有在仓库里跑`);

const violations = [];

// ---- 规则 1：构建产物、压缩包、二进制、系统垃圾一律不进版本库 ------------------
//
// 例外只有一个：extension/wasm/pkg/ 下的 .wasm。它虽然是构建产物，但扩展要以
// unpacked 方式加载时必须现成可用（Chrome 不会替你跑 wasm-pack），且随扩展一起分发。
const FORBIDDEN = [
  { pattern: /^dist\//, why: "打包输出，由 scripts/package-release.ps1 生成" },
  { pattern: /(^|\/)target\//, why: "Rust 构建输出" },
  { pattern: /(^|\/)node_modules\//, why: "依赖目录" },
  { pattern: /^output\//, why: "本地调试输出" },
  { pattern: /^docs\//, why: "本地文档草稿目录（.gitignore 已排除）" },
  { pattern: /\.(zip|7z|tar|gz|rar)$/i, why: "压缩包：源码仓库里不放归档" },
  { pattern: /\.(exe|dll|pdb|obj|lib|so|dylib)$/i, why: "二进制产物" },
  { pattern: /\.(log|tmp|bak|orig|rej|swp)$/i, why: "临时/备份文件" },
  { pattern: /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i, why: "操作系统垃圾文件" },
  { pattern: /(^|\/)\.(vs|vscode|idea|claude)\//, why: "编辑器/工具的本地状态" },
];

// 规则自检：一条永远匹配不到东西的规则（比如正则写错了）等于不存在，而且会让人以为
// 有护栏。用一组一定该被拦下的样例路径验证匹配器本身是活的。
const CANARIES = [
  "dist/zero-latency-web-release-v9.9.9.zip",
  "app/target/release/zero-latency-web-app.exe",
  "node_modules/left-pad/index.js",
  "output/scratch.log",
  "docs/internal/invariants.md",
  "extension/.DS_Store",
  ".vscode/settings.json",
];
for (const canary of CANARIES) {
  assert.ok(
    FORBIDDEN.some((rule) => rule.pattern.test(canary)),
    `禁入规则连 ${canary} 都拦不住，匹配器已经失效`,
  );
}

const WASM_ARTIFACT_EXCEPTION = /^extension\/wasm\/pkg\//;

for (const file of tracked) {
  if (WASM_ARTIFACT_EXCEPTION.test(file)) continue;
  for (const rule of FORBIDDEN) {
    if (rule.pattern.test(file)) {
      violations.push(`${file}：不该进版本库 —— ${rule.why}`);
      break;
    }
  }
}

// ---- 规则 2：assets/ 下的图片必须有人引用 --------------------------------------
//
// 图片是最容易堆积的一类：换了一版设计，旧的那版没人删，也没人发现，因为它不报错。
// 实测 2026-08-20：三张商店图（合计 2.06 MB，占当时仓库的 10%）在改成分语言的
// out/<locale>/ 体系之后就再没人引用过，一直躺在仓库里。
const TEXT_EXTENSIONS = new Set([
  ".md", ".html", ".json", ".js", ".mjs", ".ps1", ".css", ".yml", ".yaml", ".rs", ".txt", ".cmd",
]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"]);

const corpus = tracked
  .filter((file) => TEXT_EXTENSIONS.has(path.extname(file).toLowerCase()))
  .map((file) => {
    try {
      return readFileSync(path.join(repoRoot, file), "utf8");
    } catch {
      return "";
    }
  })
  .join("\n");

const images = tracked.filter(
  (file) => file.startsWith("assets/") && IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()),
);
assert.ok(images.length > 0, "assets/ 下一张图片都没找到，这条规则形同虚设");

for (const image of images) {
  // 整路径或纯文件名，出现任一即算被引用。
  if (corpus.includes(image) || corpus.includes(path.basename(image))) continue;
  violations.push(
    `${image}：assets/ 下的图片但没有任何 tracked 文本文件引用它 —— 换代之后忘了删的旧素材`,
  );
}

// ---- 规则 3：单个文件体积上限 --------------------------------------------------
//
// 上限不是为了省空间，是为了让「往源码仓库里塞大文件」这件事必须过一次人的判断。
// 超限不代表错，代表要在下面写一行说明它为什么该在这儿。
const MAX_TRACKED_FILE_BYTES = 512 * 1024;
const OVERSIZE_ALLOWLIST = new Map([
  [
    "extension/background/security/local-threat-library.json",
    "本地威胁库快照，随扩展分发；inspectUrl 是 fail-closed 的，缺了它所有预加载都会被拦下",
  ],
]);

for (const [file] of OVERSIZE_ALLOWLIST) {
  assert.ok(
    tracked.includes(file),
    `体积允许名单里的 ${file} 已经不在版本库里了，这条名单已过期`,
  );
}

for (const file of tracked) {
  let size;
  try {
    size = statSync(path.join(repoRoot, file)).size;
  } catch {
    continue;
  }
  if (size <= MAX_TRACKED_FILE_BYTES) continue;
  if (OVERSIZE_ALLOWLIST.has(file)) continue;
  violations.push(
    `${file}：${(size / 1024).toFixed(1)} KB，超过 ${MAX_TRACKED_FILE_BYTES / 1024} KB 上限。` +
      `确实该进版本库的话，在 repository-contents.mjs 的 OVERSIZE_ALLOWLIST 里写明理由。`,
  );
}

assert.deepEqual(violations, [], `版本库内容不变量被破坏：\n  ${violations.join("\n  ")}`);

console.log(
  `repository-contents: ${tracked.length} 个 tracked 文件，` +
    `禁入规则 ${FORBIDDEN.length} 条、图片 ${images.length} 张全部有人引用、无超限文件`,
);
