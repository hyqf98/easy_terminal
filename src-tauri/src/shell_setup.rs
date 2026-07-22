//! Shell 环境自动配置：检测并安装 zsh-syntax-highlighting、zsh-autosuggestions、starship。
//!
//! 插件存放在 `~/.easy-terminal/shell/` 下，由 zshrc source。
//! 首次启动 PTY 时自动检测，幂等（已安装则跳过）。

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::path_util;

/// 插件根目录：`~/.easy-terminal/shell/`
fn shell_plugins_dir() -> Result<PathBuf, String> {
    let dir = path_util::app_data_dir()?.join("shell");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// starship 二进制路径：`~/.easy-terminal/shell/starship`
fn starship_path() -> Result<PathBuf, String> {
    Ok(shell_plugins_dir()?.join("starship"))
}

/// 检测系统是否安装了 git（用于克隆插件）
fn has_git() -> bool {
    Command::new("git")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// 确保指定插件已克隆到本地。返回插件 source 脚本的路径。
/// repo_url: git 仓库地址
/// dir_name: 目标目录名
/// entry: 插件入口文件名（.zsh）
fn ensure_plugin(repo_url: &str, dir_name: &str, entry: &str) -> Result<PathBuf, String> {
    let base = shell_plugins_dir()?;
    let plugin_dir = base.join(dir_name);
    let entry_path = plugin_dir.join(entry);

    // 已存在且包含入口文件 → 跳过
    if entry_path.exists() {
        return Ok(entry_path);
    }

    // 清理可能的不完整克隆
    if plugin_dir.exists() {
        let _ = fs::remove_dir_all(&plugin_dir);
    }

    if !has_git() {
        return Err("git not found".to_string());
    }

    // 浅克隆（--depth=1），快速且节省空间
    let output = Command::new("git")
        .args([
            "clone",
            "--depth",
            "1",
            repo_url,
            plugin_dir.to_str().unwrap_or(""),
        ])
        .output()
        .map_err(|e| format!("git clone failed: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git clone failed: {}", stderr.trim()));
    }

    if entry_path.exists() {
        Ok(entry_path)
    } else {
        Err(format!("plugin entry {} not found after clone", entry))
    }
}

/// 确保 zsh-syntax-highlighting 已安装
pub fn ensure_zsh_syntax_highlighting() -> Result<PathBuf, String> {
    ensure_plugin(
        "https://github.com/zsh-users/zsh-syntax-highlighting.git",
        "zsh-syntax-highlighting",
        "zsh-syntax-highlighting.zsh",
    )
}

/// 确保 zsh-autosuggestions 已安装
pub fn ensure_zsh_autosuggestions() -> Result<PathBuf, String> {
    ensure_plugin(
        "https://github.com/zsh-users/zsh-autosuggestions.git",
        "zsh-autosuggestions",
        "zsh-autosuggestions.zsh",
    )
}

/// 确保 starship 已安装。优先检测系统全局安装，否则下载到插件目录。
pub fn ensure_starship() -> Result<PathBuf, String> {
    // 1. 检测系统已安装的 starship
    if let Ok(output) = Command::new("which").arg("starship").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() && Path::new(&path).exists() {
                return Ok(PathBuf::from(path));
            }
        }
    }

    // 2. 检测本地已下载的 starship
    let local = starship_path()?;
    if local.exists() {
        return Ok(local);
    }

    // 3. 下载安装（使用 starship 官方安装脚本）
    // macOS/Linux 上通过 curl 安装到指定目录
    let shell_dir = shell_plugins_dir()?;
    let arch = std::env::consts::ARCH;
    let os = std::env::consts::OS;

    // 构建 starship 下载 URL
    let (arch_str, os_str) = match (arch, os) {
        ("x86_64", "macos") => ("x86_64", "apple-darwin"),
        ("aarch64", "macos") => ("aarch64", "apple-darwin"),
        ("x86_64", "linux") => ("x86_64", "unknown-linux-gnu"),
        ("aarch64", "linux") => ("aarch64", "unknown-linux-gnu"),
        _ => return Err(format!("Unsupported platform: {}-{}", arch, os)),
    };

    let version = "latest";
    let url = format!(
        "https://github.com/starship/starship/releases/{}/download/starship-{}-{}.tar.gz",
        version, arch_str, os_str
    );

    // 下载 tar.gz
    let tmp_tar = shell_dir.join("starship.tar.gz");
    let download_status = Command::new("curl")
        .args(["-sSL", "-o", tmp_tar.to_str().unwrap_or(""), &url])
        .status()
        .map_err(|e| format!("curl failed: {}", e))?;

    if !download_status.success() {
        let _ = fs::remove_file(&tmp_tar);
        return Err("starship download failed".to_string());
    }

    // 解压到 shell 目录
    let extract_status = Command::new("tar")
        .args([
            "xzf",
            tmp_tar.to_str().unwrap_or(""),
            "-C",
            shell_dir.to_str().unwrap_or(""),
        ])
        .status()
        .map_err(|e| format!("tar failed: {}", e))?;

    let _ = fs::remove_file(&tmp_tar);

    if !extract_status.success() || !local.exists() {
        return Err("starship extraction failed".to_string());
    }

    // 设置可执行权限
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&local, fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
    }

    Ok(local)
}

/// 安装状态信息，供前端查询显示
#[derive(serde::Serialize)]
pub struct ShellSetupStatus {
    pub syntax_highlighting: bool,
    pub autosuggestions: bool,
    pub starship: bool,
    pub starship_path: Option<String>,
}

/// 检测各组件是否已安装（不触发安装，仅检查）
pub fn check_setup_status() -> ShellSetupStatus {
    let base = shell_plugins_dir().ok();

    let syntax_ok = base
        .as_ref()
        .map(|b| {
            b.join("zsh-syntax-highlighting/zsh-syntax-highlighting.zsh")
                .exists()
        })
        .unwrap_or(false);

    let auto_ok = base
        .as_ref()
        .map(|b| {
            b.join("zsh-autosuggestions/zsh-autosuggestions.zsh")
                .exists()
        })
        .unwrap_or(false);

    let (star_ok, star_path) = match starship_path() {
        Ok(p) if p.exists() => (true, Some(p.to_string_lossy().to_string())),
        _ => {
            // 检查系统全局
            if let Ok(output) = Command::new("which").arg("starship").output() {
                if output.status.success() {
                    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if !path.is_empty() {
                        (true, Some(path))
                    } else {
                        (false, None)
                    }
                } else {
                    (false, None)
                }
            } else {
                (false, None)
            }
        }
    };

    ShellSetupStatus {
        syntax_highlighting: syntax_ok,
        autosuggestions: auto_ok,
        starship: star_ok,
        starship_path: star_path,
    }
}

/// 执行完整安装（幂等，已安装的跳过）。返回成功安装的组件列表。
#[derive(serde::Serialize)]
pub struct SetupResult {
    pub success: bool,
    pub syntax_highlighting: bool,
    pub autosuggestions: bool,
    pub starship: bool,
    pub errors: Vec<String>,
}

pub fn run_setup() -> SetupResult {
    let mut errors: Vec<String> = Vec::new();
    let mut syntax_ok = false;
    let mut auto_ok = false;
    let mut star_ok = false;

    match ensure_zsh_syntax_highlighting() {
        Ok(_) => syntax_ok = true,
        Err(e) => errors.push(format!("syntax-highlighting: {}", e)),
    }

    match ensure_zsh_autosuggestions() {
        Ok(_) => auto_ok = true,
        Err(e) => errors.push(format!("autosuggestions: {}", e)),
    }

    match ensure_starship() {
        Ok(_) => star_ok = true,
        Err(e) => errors.push(format!("starship: {}", e)),
    }

    SetupResult {
        success: syntax_ok && auto_ok && star_ok,
        syntax_highlighting: syntax_ok,
        autosuggestions: auto_ok,
        starship: star_ok,
        errors,
    }
}
