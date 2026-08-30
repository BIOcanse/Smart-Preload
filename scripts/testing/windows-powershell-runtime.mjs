import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createWindowsPowerShellEnv,
  requireWindowsPowerShell,
  WINDOWS_POWERSHELL_BASE_ARGS,
} from "./lib/windows-powershell.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const syntheticEnvironment = {
  SystemRoot: "C:\\Windows",
  ProgramFiles: "C:\\Program Files",
  PSMODULEPATH: [
    "C:\\Program Files\\PowerShell\\Modules",
    "C:\\Codex\\pwsh\\Modules",
    "C:\\Program Files\\WindowsPowerShell\\Modules",
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules",
  ].join(path.win32.delimiter),
  ZLW_ENV_SENTINEL: "preserved",
};
const normalizedEnvironment = createWindowsPowerShellEnv(syntheticEnvironment);
const moduleDirectories = normalizedEnvironment.PSModulePath.split(path.win32.delimiter).map(
  (entry) => path.win32.normalize(entry).toLowerCase(),
);

assert.equal(normalizedEnvironment.ZLW_ENV_SENTINEL, "preserved");
assert.equal(
  Object.keys(normalizedEnvironment).filter((key) => key.toLowerCase() === "psmodulepath").length,
  1,
  "环境里只能保留一个大小写归一的 PSModulePath",
);
assert.ok(
  moduleDirectories.includes("c:\\program files\\windowspowershell\\modules"),
  "必须保留 Windows PowerShell 的 Program Files 模块目录",
);
assert.ok(
  moduleDirectories.includes(
    "c:\\windows\\system32\\windowspowershell\\v1.0\\modules",
  ),
  "必须保留 Windows PowerShell 的系统模块目录",
);
assert.ok(
  !moduleDirectories.includes("c:\\program files\\powershell\\modules"),
  "不能把 PowerShell Core 模块目录交给 Windows PowerShell 5.1",
);
assert.ok(
  !moduleDirectories.includes("c:\\codex\\pwsh\\modules"),
  "不能把 Codex 的 pwsh 模块目录交给 Windows PowerShell 5.1",
);

if (process.platform === "win32") {
  const manifestPath = path.join(repoRoot, "extension", "manifest.json");
  const probe = spawnSync(
    requireWindowsPowerShell(),
    [
      ...WINDOWS_POWERSHELL_BASE_ARGS,
      "-Command",
      "$command = Get-Command Get-FileHash -ErrorAction Stop; " +
        "$hash = (Get-FileHash -LiteralPath $env:ZLW_HASH_FIXTURE -Algorithm SHA256).Hash; " +
        "if ($hash.Length -ne 64) { throw 'unexpected SHA-256 length' }; " +
        "Write-Output $command.Source",
    ],
    {
      encoding: "utf8",
      env: createWindowsPowerShellEnv({
        ...process.env,
        ZLW_HASH_FIXTURE: manifestPath,
      }),
      timeout: 10_000,
      windowsHide: true,
    },
  );

  assert.equal(probe.error, undefined, probe.error?.message);
  assert.equal(probe.status, 0, probe.stderr || probe.stdout);
  assert.match(probe.stdout, /Microsoft\.PowerShell\.Utility/u);
}

console.log("windows powershell runtime tests passed");
