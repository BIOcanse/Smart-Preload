// 打包脚本的「版本号是否已发布」护栏。
//
// 背景：复用一个已发布过的版本号，Chrome 商店直接拒收，已装用户永远收不到更新。
// 护栏的第一版只查 `git tag --list`（本地标签），而已发布记录在远端 —— 实测
// 2026-08-19：v1.0.17 已于 2026-07-16 发布、远端标签在，本机一条标签都没 fetch，
// 护栏对它完全不响。所以这里的核心用例是「远端有、本地没有」。
//
// 整个测试自带一个真 git 仓库（bare 仓库当 remote），不联网、不依赖本机 fetch 状态。
import assert from "node:assert/strict";
import { WINDOWS_POWERSHELL } from "./lib/windows-powershell.mjs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const packageScript = path.join(repoRoot, "scripts", "package-release.ps1");
const probeScript = path.join(__dirname, "lib", "release-version-guard-probe.ps1");
const POWERSHELL = WINDOWS_POWERSHELL;
const REPO_SLUG = "BIOcanse/Smart-Preload";

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

function runGuard({ repoRoot: target, version, remote = "", skipRemote = false }) {
  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-File", probeScript,
    "-ScriptPath", packageScript,
    "-RepoRoot", target,
    "-Version", version,
    "-RepoSlug", REPO_SLUG,
  ];
  if (remote) args.push("-Remote", remote);
  if (skipRemote) args.push("-SkipRemote");
  const output = execFileSync(WINDOWS_POWERSHELL, args, { encoding: "utf8" });
  // 护栏放行时会用 Write-Host 打一行说明，捕获时也落在 stdout 里。裁掉判定行之前的
  // 内容，但保留判定行之后的所有行 —— 拒绝理由本身可能是多行的。
  const lines = output.split(/\r?\n/);
  const verdict = lines.findIndex((line) => /^(ALLOWED|REFUSED:|MISSING-FUNCTION)/.test(line));
  assert.notEqual(verdict, -1, `探针没有给出判定，原始输出：${output}`);
  return lines.slice(verdict).join("\n").trim();
}

// ---- 固件：remote 上有 v1.0.16 与 v1.0.17，本地只有 v1.0.16 ----------------
const workspace = mkdtempSync(path.join(tmpdir(), "release-guard-"));
// remote 的 URL 里必须含仓库 slug，顺带覆盖「自动认出发布 remote」这条路径。
const upstream = path.join(workspace, "BIOcanse", "Smart-Preload.git");
const checkout = path.join(workspace, "work");
const upstreamUrl = upstream.split(path.sep).join("/");

try {
  await mkdir(path.dirname(upstream), { recursive: true });
  await mkdir(checkout, { recursive: true });
  execFileSync("git", ["init", "--bare", "--initial-branch=main", upstream], { stdio: "ignore" });

  execFileSync("git", ["init", "--initial-branch=main", checkout], { stdio: "ignore" });
  git(checkout, "config", "core.autocrlf", "false");
  git(checkout, "config", "user.email", "test@example.invalid");
  git(checkout, "config", "user.name", "release guard test");
  writeFileSync(path.join(checkout, "README.md"), "fixture\n");
  git(checkout, "add", "README.md");
  git(checkout, "commit", "-m", "fixture");
  git(checkout, "remote", "add", "developer", upstreamUrl);
  git(checkout, "tag", "v1.0.16");
  git(checkout, "tag", "v1.0.17");
  git(checkout, "push", "--quiet", "developer", "main", "--tags");
  // 模拟本机现状：远端标签齐全，本地漏了一个（从没 fetch 过）。
  git(checkout, "tag", "-d", "v1.0.17");

  assert.equal(git(checkout, "tag", "--list").split("\n").sort().join(","), "v1.0.16");

  // ---- 1. 核心用例：远端有、本地没有 —— 旧护栏就是在这里放行的 --------------
  const remoteOnly = runGuard({ repoRoot: checkout, version: "1.0.17" });
  assert.match(
    remoteOnly,
    /^REFUSED:/,
    `远端已存在 v1.0.17，护栏必须拒绝打包，实际：${remoteOnly}`,
  );
  assert.match(
    remoteOnly,
    /remote/,
    `拒绝理由要说清是远端已存在（否则维护者会以为本地删个标签就能继续），实际：${remoteOnly}`,
  );

  // ---- 2. 本地就有标签时同样拒绝（离线也要拦住最常见的那一类）---------------
  const localTag = runGuard({ repoRoot: checkout, version: "1.0.16" });
  assert.match(localTag, /^REFUSED:/, `本地已有 v1.0.16 标签，必须拒绝，实际：${localTag}`);

  // ---- 3. 全新版本号放行，且不需要显式指定 remote（slug 自动匹配）-----------
  const fresh = runGuard({ repoRoot: checkout, version: "9.9.9" });
  assert.equal(fresh, "ALLOWED", `v9.9.9 从未发布，应放行，实际：${fresh}`);

  // ---- 4. 查不动远端时必须报错，不能当成「没有标签」---------------------------
  // 「不知道」不等于「没有」。这条如果退化成放行，护栏在任何网络故障下都会静默失效。
  const unreachable = runGuard({ repoRoot: checkout, version: "9.9.9", remote: "no-such-remote" });
  assert.match(
    unreachable,
    /^REFUSED:/,
    `remote 查询失败时不能放行（「不知道」≠「没有」），实际：${unreachable}`,
  );
  assert.match(
    unreachable,
    /SkipRemoteTagCheck/,
    `报错要指明离线打包的正确出口，实际：${unreachable}`,
  );

  // ---- 5. -SkipRemoteTagCheck 是显式降级，行为要和文档一致 -------------------
  const skipped = runGuard({ repoRoot: checkout, version: "1.0.17", skipRemote: true });
  assert.equal(
    skipped,
    "ALLOWED",
    `显式跳过远端校验后只查本地标签，v1.0.17 本地没有 → 放行，实际：${skipped}`,
  );

  // ---- 6. 多个 remote 指向同一个发布仓库时不猜 -------------------------------
  git(checkout, "remote", "add", "mirror", upstreamUrl);
  const ambiguous = runGuard({ repoRoot: checkout, version: "9.9.9" });
  assert.match(ambiguous, /^REFUSED:/, `多个 remote 命中发布仓库时不应该猜，实际：${ambiguous}`);
  git(checkout, "remote", "remove", "mirror");

  // ---- 7. 定义了函数还不够：打包脚本必须真的在顶层调用它 ---------------------
  // 只测函数本身的话，把调用点删掉测试依然全绿，而护栏实际上一次都不会跑。
  const packageSource = readFileSync(packageScript, "utf8");
  const callSites = packageSource
    .split("\n")
    .filter((line) => /^\s*Assert-VersionNotReleased\b/.test(line));
  assert.equal(
    callSites.length,
    1,
    `package-release.ps1 必须在顶层调用 Assert-VersionNotReleased 恰好一次，实际 ${callSites.length} 处`,
  );
  assert.match(
    packageSource,
    /-SkipRemote:\$SkipRemoteTagCheck/,
    "调用点必须把 -SkipRemoteTagCheck 开关透传下去，否则参数是摆设",
  );

  console.log("release-version-guard: 7 项断言通过");
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
