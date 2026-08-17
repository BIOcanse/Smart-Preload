# 驱动本地 app 弹出的 Win32 确认框，供自动化测试使用。
#
# 读与点用两套机制，各挑各擅长的：
#   - **读**用 UI Automation：拿到按钮名与正文，于是「弹的是哪个框」「文案对不对」
#     这两件事一起被断言掉，不用另外造证据。
#   - **点**用 TaskDialog 的 TDM_CLICK_BUTTON 消息：命令链接在 UIA 里是 Pane，
#     不支持任何激活模式（实测 2026-08-10），Invoke 与 DoDefaultAction 都拿不到。
#
# 输出一律是单行 JSON，给 Node 侧解析。任何失败都以 JSON 形式返回，不抛异常出去，
# 免得调用方只能看到一段 PowerShell 堆栈。
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("wait", "click", "expect-none")]
  [string]$Command,

  [string]$ProcessName = "zero-latency-web-app",
  [int]$TimeoutSeconds = 60,
  [string]$ButtonName = "",
  [int]$ButtonId = 0,
  # 给了就把结果写到这个文件（独立桌面上的进程没有 stdout 通道）。
  [string]$OutFile = ""
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

# CharSet.Unicode 是必须的：不写的话 StringBuilder 按 ANSI 解，宽字符串会在第一个字符
# 后面的 \0 处被截断，类名 "#32770" 读出来只有 "#"。
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class DialogFinder {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumWindows(EnumProc callback, IntPtr param);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr window, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr window, StringBuilder text, int count);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out RECT rect);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessageW(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);

  // TDM_CLICK_BUTTON = WM_USER + 102。TaskDialog 专门为「程序化按下某个按钮」提供的消息。
  const uint TDM_CLICK_BUTTON = 0x0400 + 102;

  public static void ClickButton(IntPtr dialog, int buttonId) {
    SendMessageW(dialog, TDM_CLICK_BUTTON, new IntPtr(buttonId), IntPtr.Zero);
  }

  delegate bool EnumProc(IntPtr window, IntPtr param);
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }

  public static IntPtr Handle;
  public static string Title;
  static EnumProc keepAlive;

  public static bool Find(uint targetProcessId) {
    Handle = IntPtr.Zero;
    Title = "";
    keepAlive = delegate(IntPtr window, IntPtr param) {
      if (!IsWindowVisible(window)) return true;
      uint processId; GetWindowThreadProcessId(window, out processId);
      if (processId != targetProcessId) return true;

      StringBuilder className = new StringBuilder(256);
      GetClassNameW(window, className, className.Capacity);
      StringBuilder title = new StringBuilder(512);
      GetWindowTextW(window, title, title.Capacity);

      RECT rect; GetWindowRect(window, out rect);

      // TaskDialog 与 MessageBox 都是 #32770。托盘/winit 的辅助窗口要么没标题、
      // 要么只有几个像素宽，用尺寸再筛一道。
      if (className.ToString() == "#32770" && title.Length > 0 && (rect.Right - rect.Left) > 200) {
        Handle = window;
        Title = title.ToString();
        return false;
      }
      return true;
    };
    EnumWindows(keepAlive, IntPtr.Zero);
    return Handle != IntPtr.Zero;
  }
}
'@

function Get-TargetProcessId {
  $process = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $process) { return 0 }
  return [uint32]$process.Id
}

function Find-DialogHandle {
  $processId = Get-TargetProcessId
  if ($processId -eq 0) { return [IntPtr]::Zero }
  if ([DialogFinder]::Find($processId)) { return [DialogFinder]::Handle }
  return [IntPtr]::Zero
}

# TaskDialog 的命令链接（TDF_USE_COMMAND_LINKS）在 UIA 里暴露成 **Pane** 而不是 Button，
# 而普通通用按钮（TDCBF_OK_BUTTON）才是 Button。按 ControlType 过滤会漏掉前者，
# 表现是「窗口找到了但一个按钮都没有」，然后 Wait-Dialog 一直空转到超时。
# 所以这里遍历全部后代，按控件类型分类，不预设按钮长什么样。
function Get-DialogElements([IntPtr]$handle) {
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
  $all = $root.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition)

  $clickable = @()
  $texts = @()

  foreach ($element in $all) {
    $name = $element.Current.Name
    if ([string]::IsNullOrWhiteSpace($name)) { continue }

    $controlType = $element.Current.ControlType.ProgrammaticName
    if ($controlType -eq "ControlType.Text") {
      $texts += $name
    } else {
      $clickable += [pscustomobject]@{ name = $name; element = $element }
    }
  }

  return [pscustomobject]@{ clickable = $clickable; texts = $texts }
}

function Get-DialogSnapshot([IntPtr]$handle) {
  $elements = Get-DialogElements $handle

  return [pscustomobject]@{
    ok      = $true
    hwnd    = [int64]$handle
    title   = [DialogFinder]::Title
    buttons = @($elements.clickable | ForEach-Object { $_.name })
    texts   = @($elements.texts)
  }
}

# 命令链接（TDF_USE_COMMAND_LINKS）在 UIA 里是 Pane，**不支持任何激活模式**——
# InvokePattern 和 LegacyIAccessible 的 DoDefaultAction 都拿不到（实测 2026-08-10）。
# 所以点击走 TaskDialog 自己的 TDM_CLICK_BUTTON：这正是微软为程序化按下按钮提供的消息，
# 比合成鼠标事件可靠，也不会去动用户的真实光标。
#
# UIA 仍然负责**读**：按钮名与正文用于断言「弹的是哪个框、文案对不对」。
# 于是名字校验与点击动作各用各的机制，互不牵连。

function Wait-Dialog([int]$timeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $handle = Find-DialogHandle
    if ($handle -ne [IntPtr]::Zero) {
      # 就绪信号只看按钮。
      #
      # 不能同时要求正文：紧跟在上一个确认框之后弹出的第二个框，其文本元素**根本不进
      # UIA 树**（实测 2026-08-10：等满 30 秒 texts 仍为 []，而 buttons 一直是全的）。
      # 把正文也当成就绪条件的话，那种框永远等不到。
      # 于是「弹的是哪个框」靠按钮名判定，正文内容由 Rust 侧的文案单元测试负责。
      $snapshot = Get-DialogSnapshot $handle
      if ($snapshot.buttons.Count -gt 0) { return $snapshot }
    }
    Start-Sleep -Milliseconds 300
  }
  # 超时了就把最后看到的现场一起带回去，否则调用方只知道「没等到」，
  # 分不清是窗口没出现、还是出现了但控件树读不出来。
  $lastHandle = Find-DialogHandle
  $lastSeen = $null
  if ($lastHandle -ne [IntPtr]::Zero) { $lastSeen = Get-DialogSnapshot $lastHandle }

  return [pscustomobject]@{
    ok            = $false
    reason        = "timeout"
    waitedSeconds = $timeoutSeconds
    lastSeen      = $lastSeen
  }
}

# 结果先收进变量，最后统一输出。
#
# 这个脚本可能被启动在**独立桌面**上（见 win32-desktop.ps1），那种启动方式没有重定向
# stdio 的通道，所以结果得落到 -OutFile 让调用方去读；不给 -OutFile 时仍走 stdout。
$result = & {
switch ($Command) {
  "wait" {
    Wait-Dialog $TimeoutSeconds | ConvertTo-Json -Depth 4 -Compress
  }

  "expect-none" {
    # 反向断言：这段时间里**不应该**出现弹窗。
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $appeared = $null
    while ((Get-Date) -lt $deadline) {
      $handle = Find-DialogHandle
      if ($handle -ne [IntPtr]::Zero) { $appeared = Get-DialogSnapshot $handle; break }
      Start-Sleep -Milliseconds 500
    }
    if ($null -eq $appeared) {
      [pscustomobject]@{ ok = $true; sawDialog = $false; watchedSeconds = $TimeoutSeconds } |
        ConvertTo-Json -Compress
    } else {
      [pscustomobject]@{ ok = $false; sawDialog = $true; dialog = $appeared } |
        ConvertTo-Json -Depth 4 -Compress
    }
  }

  "click" {
    $snapshot = Wait-Dialog $TimeoutSeconds
    if (-not $snapshot.ok) { $snapshot | ConvertTo-Json -Compress; break }

    $elements = Get-DialogElements ([IntPtr]$snapshot.hwnd)

    $target = $null
    foreach ($candidate in $elements.clickable) {
      if ($candidate.name -like "*$ButtonName*") { $target = $candidate; break }
    }

    if ($null -eq $target) {
      [pscustomobject]@{
        ok      = $false
        reason  = "button-not-found"
        wanted  = $ButtonName
        buttons = $snapshot.buttons
      } | ConvertTo-Json -Depth 4 -Compress
      break
    }

    $clickedName = $target.name

    if ($ButtonId -le 0) {
      [pscustomobject]@{
        ok     = $false
        reason = "missing-button-id"
        wanted = $clickedName
      } | ConvertTo-Json -Compress
      break
    }

    [DialogFinder]::ClickButton([IntPtr]$snapshot.hwnd, $ButtonId)

    # 确认窗口真的关掉了 —— Invoke 成功不等于对话框结束（比如按钮被禁用）。
    # ⚠️ 函数调用必须加括号。`Find-DialogHandle -eq [IntPtr]::Zero` 会被解析成
    # 「调用 Find-DialogHandle 并把 -eq 与后面的值当参数传进去」——PowerShell 的函数
    # 默认吃掉多余参数不报错，于是整个条件退化成「把返回的 IntPtr 当布尔」，恒为真。
    # 这个检查因此一直是空的（实测 2026-08-10）。
    $closed = $false
    $deadline = (Get-Date).AddSeconds(10)
    while ((Get-Date) -lt $deadline) {
      if ((Find-DialogHandle) -eq [IntPtr]::Zero) { $closed = $true; break }
      Start-Sleep -Milliseconds 200
    }

    [pscustomobject]@{
      ok       = $closed
      clicked  = $clickedName
      buttonId = $ButtonId
      closed  = $closed
      title   = $snapshot.title
      buttons = $snapshot.buttons
      texts   = $snapshot.texts
    } | ConvertTo-Json -Depth 4 -Compress
  }
}
}

if ([string]::IsNullOrWhiteSpace($OutFile)) {
  Write-Output $result
} else {
  # 独立桌面上的进程没法把 stdout 传回来，落文件让调用方轮询。
  $directory = Split-Path -Parent $OutFile
  if ($directory -and -not (Test-Path $directory)) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
  Set-Content -Path $OutFile -Value $result -Encoding utf8
}
