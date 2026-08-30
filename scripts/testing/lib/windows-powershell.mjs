// 测试统一从这里拿 Windows PowerShell 5.1 的路径。
//
// 不用裸名字 `powershell.exe` 交给 PATH 解析：本仓库已经在这上面栽过一次 ——
// 本机 PATH 长 20361 字符，派生出去的 cmd.exe 只拿到 11 个字符，`powershell` 直接
// 9009 not recognized（见 app/install-register.cmd 的注释）。PATH 是继承来的、
// 会被上游任意改写的东西，而这个可执行文件的位置是固定的。
//
// 也不用 pwsh 7：仓库统一口径是 Windows PowerShell 5.1（install-register.cmd 写死了
// 它的绝对路径，win32-dialog.ps1 依赖它自带的 UIAutomation 程序集），两者的行为差异
// 不小（编码默认值、$ErrorActionPreference 对原生命令的影响等），混用只会制造
// 「在我这儿是好的」。
import { existsSync } from "node:fs";
import path from "node:path";

const systemRoot = process.env.SystemRoot ?? "C:\\Windows";

/** Windows PowerShell 5.1 的绝对路径。 */
export const WINDOWS_POWERSHELL = path.join(
  systemRoot,
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);

/** 每次调用都该带上的参数：不读用户配置、不等交互、不受执行策略阻挡。 */
export const WINDOWS_POWERSHELL_BASE_ARGS = Object.freeze([
  "-NoLogo",
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
]);

function getEnvironmentValue(environment, name, fallback = "") {
  const matchingKey = Object.keys(environment).find(
    (key) => key.toLowerCase() === name.toLowerCase(),
  );
  return matchingKey ? environment[matchingKey] : fallback;
}

function isWindowsPowerShellModuleDirectory(moduleDirectory) {
  const normalized = path.win32
    .normalize(moduleDirectory)
    .replace(/[\\/]+$/u, "")
    .toLowerCase();

  return (
    normalized.endsWith("\\windowspowershell\\modules") ||
    normalized.endsWith("\\windowspowershell\\v1.0\\modules")
  );
}

/**
 * 构造适合从 Node 启动 Windows PowerShell 5.1 的环境。
 *
 * 当前进程可能运行在 pwsh 7 下；它的 PSModulePath 会把 PowerShell Core 模块目录
 * 放在 Windows PowerShell 目录前面。Node 原样转交后，5.1 的自动模块发现可能先命中
 * 不兼容的 Utility 模块，表现为连 Get-FileHash 都不存在。这里只收窄子进程环境，
 * 不修改父进程或系统环境。
 */
export function createWindowsPowerShellEnv(baseEnvironment = process.env) {
  const environment = {};
  for (const [key, value] of Object.entries(baseEnvironment)) {
    if (key.toLowerCase() !== "psmodulepath") {
      environment[key] = value;
    }
  }

  const systemRoot = getEnvironmentValue(baseEnvironment, "SystemRoot", "C:\\Windows");
  const programFiles = getEnvironmentValue(
    baseEnvironment,
    "ProgramFiles",
    "C:\\Program Files",
  );
  const inheritedModulePath = getEnvironmentValue(baseEnvironment, "PSModulePath");
  const moduleDirectories = [
    path.win32.join(programFiles, "WindowsPowerShell", "Modules"),
    path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "Modules"),
    ...inheritedModulePath
      .split(path.win32.delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .filter(isWindowsPowerShellModuleDirectory),
  ];

  const seen = new Set();
  environment.PSModulePath = moduleDirectories
    .filter((entry) => {
      const identity = path.win32.normalize(entry).toLowerCase();
      if (seen.has(identity)) {
        return false;
      }
      seen.add(identity);
      return true;
    })
    .join(path.win32.delimiter);

  return environment;
}

/**
 * 确认 Windows PowerShell 存在，不存在就明确报错。
 *
 * 不做「找不到就退回裸名字」这类回退：回退会把一个清楚的环境问题，变成后面某处
 * 语焉不详的失败。
 */
export function requireWindowsPowerShell() {
  if (!existsSync(WINDOWS_POWERSHELL)) {
    throw new Error(
      `找不到 Windows PowerShell：${WINDOWS_POWERSHELL}。` +
        `本仓库的测试依赖 5.1（不是 pwsh 7），请确认这是一台 Windows 机器。`,
    );
  }
  return WINDOWS_POWERSHELL;
}
