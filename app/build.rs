// TaskDialogIndirect 需要 ComCtl32 v6 的激活上下文；没有它调用会直接失败，
// 配对弹窗会退回到旧的 MessageBoxW（按钮文字受系统语言控制，正是要摆脱的东西）。
//
// 两条工具链的做法不同，这里都覆盖，且**不引入任何构建期依赖**：
//   - MSVC：`/MANIFESTDEPENDENCY` 链接器指令，链接器会把依赖写进生成的清单。
//   - GNU ：用 windres 把 resources/app.rc 编成对象文件再链进去。
//
// 找不到 windres 时**不让构建失败**，只打警告：运行时还有 MessageBoxW 兜底，
// 为了一个弹窗样式挡住整个构建不划算。警告让这件事是可见的，而不是静默降级。

use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=resources/app.rc");
    println!("cargo:rerun-if-changed=resources/app.manifest");

    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }

    match env::var("CARGO_CFG_TARGET_ENV").as_deref() {
        Ok("msvc") => emit_msvc_manifest_dependency(),
        Ok("gnu") => embed_manifest_resource_with_windres(),
        _ => println!("cargo:warning=未知的 Windows target env，配对弹窗将退回 MessageBoxW"),
    }
}

fn emit_msvc_manifest_dependency() {
    println!(
        "cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' \
         name='Microsoft.Windows.Common-Controls' version='6.0.0.0' \
         processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"
    );
}

fn embed_manifest_resource_with_windres() {
    let manifest_dir =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("缺少 CARGO_MANIFEST_DIR"));
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("缺少 OUT_DIR"));
    let resources_dir = manifest_dir.join("resources");
    let object_path = out_dir.join("app-manifest.o");

    // 仓库路径里可能有空格（本机就是 `D:\Code\Chrome extension`），而 windres 会把
    // 输入路径透传给 cc1 预处理器，那一层不做引号处理，空格直接把参数切两半。
    // 所以工作目录切到 resources/ 再用相对文件名 —— 输入侧就不出现任何带空格的路径。
    // 输出走 OUT_DIR（cargo 的 target-dir 已按 .cargo/config.toml 配到无空格路径）。
    let windres = env::var("WINDRES").unwrap_or_else(|_| "windres".to_string());
    let mut command = Command::new(&windres);
    command
        .current_dir(&resources_dir)
        .arg("--input-format=rc")
        .arg("--output-format=coff")
        .arg("app.rc")
        .arg(&object_path);

    // windres 默认通过 cmd.exe 调 `gcc` 做预处理，而 cmd 解析的是 Windows 形态的 PATH。
    // 从 Git Bash 之类的环境里构建时，gcc 明明和 windres 同目录、`Command::new` 也能
    // 直接把 windres 拉起来，cmd 那一层却找不到 gcc：`'gcc' is not recognized`
    // （实测 2026-08-14，release 构建因此静默丢掉了清单）。
    //
    // 所以不依赖 PATH：直接把预处理器的**绝对路径**告诉 windres。
    // app.rc 里没有任何宏，预处理只是走个过场，参数照 windres 的默认口径给。
    if let Some(preprocessor) = resolve_sibling_tool(&windres, "gcc") {
        command
            .arg(format!("--preprocessor={preprocessor}"))
            .arg("--preprocessor-arg=-E")
            .arg("--preprocessor-arg=-xc")
            .arg("--preprocessor-arg=-DRC_INVOKED");
    }

    match command.output() {
        Ok(result) if result.status.success() => {
            println!("cargo:rustc-link-arg={}", object_path.display());
        }
        Ok(result) => fail_or_warn(&format!(
            "{windres} 失败（{}）：{}",
            result.status,
            String::from_utf8_lossy(&result.stderr).trim()
        )),
        Err(error) => fail_or_warn(&format!(
            "找不到 {windres}（{error}）。装了 mingw-w64 工具链后重新构建即可。"
        )),
    }
}

/// 找同一套工具链里的另一个程序（windres 旁边的 gcc）。
///
/// `windres` 可能是绝对路径，也可能是裸名字。裸名字时用 `where` 去问系统 ——
/// 它和 `CreateProcess` 用同一套解析规则，比自己拆 PATH 可靠（PATH 可能是 Unix 形态，
/// `env::split_paths` 在 Windows 上按 `;` 拆，会把整串当成一个条目）。
fn resolve_sibling_tool(windres: &str, tool: &str) -> Option<String> {
    let windres_path = PathBuf::from(windres);

    let toolchain_dir = if windres_path.is_absolute() {
        windres_path.parent().map(PathBuf::from)
    } else {
        let located = Command::new("where").arg(windres).output().ok()?;

        if !located.status.success() {
            return None;
        }

        String::from_utf8_lossy(&located.stdout)
            .lines()
            .next()
            .map(|line| PathBuf::from(line.trim()))
            .and_then(|path| path.parent().map(PathBuf::from))
    }?;

    let candidate = toolchain_dir.join(format!("{tool}.exe"));

    if candidate.is_file() {
        Some(candidate.to_string_lossy().into_owned())
    } else {
        None
    }
}

/// 嵌不进清单意味着**发布出去的程序会退回 MessageBoxW** —— 按钮文字受系统语言控制，
/// 整套多语言弹窗白做，而且用户和维护者都不会察觉（实测 2026-08-14：release 二进制里
/// 一处清单都没有，只在 cargo 输出里留了一条谁也不会看的警告）。
///
/// 所以 release 构建直接失败：宁可构建不过，也不要悄悄发一个退化的二进制。
/// debug 只警告 —— 本地开发者可能没装 mingw，不该因此完全无法构建。
fn fail_or_warn(message: &str) {
    if env::var("PROFILE").as_deref() == Ok("release") {
        panic!("{message}\n发布构建必须嵌入 ComCtl32 v6 清单，否则配对确认框会退回 MessageBoxW。");
    }

    println!("cargo:warning={message}（debug 构建继续，配对弹窗将退回 MessageBoxW）");
}
