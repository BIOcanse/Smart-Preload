// Windows 脚本的编码不变量。
//
// 这些文件格式没有统一的编码协商方式，各自的读取者用各自的默认值，而那个默认值往往
// 是**当前机器的代码页**。于是同一份文件在作者机器上完好、换台机器就乱码甚至语法错误。
// 实测 2026-08-19：本机开了「Beta: 使用 Unicode UTF-8 提供全球语言支持」（ACP=65001），
// 而 GitHub windows-latest 是 1252，package-release.ps1 在那边直接解析失败。
//
// 每种格式的规则不同，因为可用的手段不同：
//
//   .ps1        —— Windows PowerShell 5.1：有 BOM 按 BOM，没 BOM 按系统 ANSI 代码页。
//                  BOM 是有效手段，所以允许中文，但必须带 UTF-8 BOM。
//   .cmd/.bat   —— cmd.exe 按控制台 OEM 代码页读，且**没有**任何编码声明手段；
//                  加 BOM 更糟，cmd.exe 会把它当命令执行。只能要求纯 ASCII。
//   .rc         —— windres 交给 C 预处理器，输入字符集取决于构建环境。这条链路失败会
//                  让 release 构建直接失败（build.rs 宁可构建不过也不发退化二进制），
//                  代价太高，同样要求纯 ASCII。
//
// 不在这里管的：.xml/.manifest 自带 `encoding=` 声明，是自描述的；.rs/.mjs/.js/.json
// 的读取者（rustc、Node、Chrome）一律按 UTF-8 读，与机器代码页无关。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

// 每条规则都带一句「为什么是这条规则」，报错时直接打给维护者。
const RULES = [
  {
    extensions: [".ps1"],
    rule: "bom-required-when-non-ascii",
    why: "Windows PowerShell 5.1 对无 BOM 的脚本按系统 ANSI 代码页解码，换台机器就是乱码或语法错误",
  },
  {
    extensions: [".cmd", ".bat"],
    rule: "ascii-only",
    why: "cmd.exe 没有编码声明手段，按控制台 OEM 代码页读；加 BOM 会被当成命令执行",
  },
  {
    extensions: [".rc"],
    rule: "ascii-only",
    why: "windres 交给 C 预处理器，输入字符集随构建环境变化；这条链路失败会让 release 构建失败",
  },
];

function ruleFor(relativePath) {
  const extension = path.extname(relativePath).toLowerCase();
  return RULES.find((candidate) => candidate.extensions.includes(extension)) ?? null;
}

const tracked = execFileSync("git", ["-C", repoRoot, "ls-files"], { encoding: "utf8" })
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

const violations = [];
const covered = new Map(RULES.map((rule) => [rule.rule, 0]));

for (const relativePath of tracked) {
  const rule = ruleFor(relativePath);
  if (!rule) continue;

  const raw = readFileSync(path.join(repoRoot, relativePath));
  const hasBom = raw.subarray(0, 3).equals(UTF8_BOM);
  const body = hasBom ? raw.subarray(3) : raw;

  // 前提：源文件本身是合法 UTF-8。存成了别的编码，下面的判断就没有意义。
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(body);
  const nonAscii = [...decoded].filter((character) => character.codePointAt(0) > 127);

  covered.set(rule.rule, covered.get(rule.rule) + 1);

  if (rule.rule === "ascii-only") {
    if (nonAscii.length > 0) {
      violations.push(
        `${relativePath}：含 ${nonAscii.length} 个非 ASCII 字符（首个是 ${JSON.stringify(nonAscii[0])}），` +
          `但该类型要求纯 ASCII —— ${rule.why}`,
      );
    }
    if (hasBom) {
      violations.push(`${relativePath}：带了 UTF-8 BOM，但该类型不允许 —— ${rule.why}`);
    }
    continue;
  }

  if (rule.rule === "bom-required-when-non-ascii" && nonAscii.length > 0 && !hasBom) {
    violations.push(
      `${relativePath}：含 ${nonAscii.length} 个非 ASCII 字符却没有 UTF-8 BOM —— ${rule.why}`,
    );
  }
}

// 每条规则都要真的匹配到文件。一条规则一个文件都没覆盖到，说明扩展名写错了或文件挪走了，
// 那它就是一条永远为真的空断言 —— 比没有更糟。
for (const [rule, count] of covered) {
  assert.ok(count > 0, `规则 ${rule} 没有匹配到任何文件，它已经形同虚设`);
}

assert.deepEqual(violations, [], `Windows 脚本编码不变量被破坏：\n  ${violations.join("\n  ")}`);

const summary = [...covered].map(([rule, count]) => `${rule}=${count}`).join("  ");
console.log(`windows-script-encoding: ${summary}，全部符合`);
