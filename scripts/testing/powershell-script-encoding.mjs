// 含非 ASCII 的 .ps1 必须带 UTF-8 BOM。
//
// Windows PowerShell 5.1 读取脚本文件时：有 BOM 就按 BOM 指定的编码，没有 BOM 就按
// **系统 ANSI 代码页**（不是 UTF-8）。于是一个 BOM-less 的 UTF-8 脚本，在 ACP 是
// UTF-8 的机器上一切正常，换台机器就整片乱码 —— 注释乱码无所谓，字符串里的中文
// 会掺进引号类字符，直接把脚本打成语法错误。
//
// 实测 2026-08-19：本机开了「Beta: 使用 Unicode UTF-8 提供全球语言支持」，ACP=65001，
// 所以 package-release.ps1 一直好好的；同一份文件在 GitHub windows-latest（ACP=1252）
// 上解析失败，报 `Unexpected token 'è¿‡æ'`。也就是说这条路在任何一台普通中文 Windows
// （ACP=936）上同样是坏的 —— 那是**发布打包脚本**，不是只影响 CI。
//
// 仓库统一走 Windows PowerShell 5.1（install-register.cmd 写死了它的绝对路径），
// 所以不能靠「换 pwsh 7 就默认 UTF-8」绕过去，只能加 BOM。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

const scripts = execFileSync("git", ["-C", repoRoot, "ls-files", "*.ps1"], { encoding: "utf8" })
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

assert.ok(scripts.length > 0, "仓库里应该有 .ps1，一个都没找到说明这条检查失效了");

const offenders = [];
let checkedWithNonAscii = 0;

for (const relativePath of scripts) {
  const raw = readFileSync(path.join(repoRoot, relativePath));
  const hasBom = raw.subarray(0, 3).equals(UTF8_BOM);
  const body = hasBom ? raw.subarray(3) : raw;

  // 顺带确认文件本身是合法 UTF-8：这条检查的前提是「源文件是 UTF-8」，
  // 如果哪天有人存成了 GBK，下面的判断就没有意义了。
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(body);

  const nonAsciiCount = [...decoded].filter((character) => character.codePointAt(0) > 127).length;
  if (nonAsciiCount === 0) continue;

  checkedWithNonAscii += 1;
  if (!hasBom) offenders.push(`${relativePath}（${nonAsciiCount} 个非 ASCII 字符）`);
}

assert.ok(
  checkedWithNonAscii > 0,
  "没有任何 .ps1 含非 ASCII —— 要么仓库变了，要么这条检查读错了文件",
);

assert.deepEqual(
  offenders,
  [],
  `以下 .ps1 含非 ASCII 却没有 UTF-8 BOM，在 ANSI 代码页不是 65001 的机器上会乱码或解析失败：\n  ${offenders.join("\n  ")}`,
);

console.log(`powershell-script-encoding: ${scripts.length} 个 .ps1，其中 ${checkedWithNonAscii} 个含非 ASCII，均带 BOM`);
