//! 跨平台路径工具模块
//!
//! 提供统一的路径展开（`~`、`$HOME` 等环境变量）和应用数据目录定位，
//! 消除各模块中重复的路径处理逻辑。

use std::fs;
use std::path::PathBuf;

/// 应用数据目录名（统一存放 settings、db、ssh 配置等）
pub const APP_DIR_NAME: &str = ".easy-terminal";

/// 展开路径中的 `~` 和 `$VAR` / `${VAR}` 环境变量。
///
/// 使用 `shellexpand::full` 在单次扫描中同时完成 tilde 和环境变量展开，
/// 避免多次替换导致的 `~` 二次展开问题。展开失败时返回原始路径。
///
/// # 示例
/// ```
/// expand_path("~/Documents");     // -> /home/user/Documents
/// expand_path("$HOME/.config");   // -> /home/user/.config
/// expand_path("/etc/hosts");      // -> /etc/hosts（无变化）
/// ```
pub fn expand_path(path: &str) -> PathBuf {
    let expanded = shellexpand::full(path).unwrap_or_else(|_| path.into());
    PathBuf::from(expanded.into_owned())
}

/// 获取应用数据目录（`~/.easy-terminal`），不存在时自动创建。
///
/// 所有持久化数据（settings、db、ssh 配置、终端状态等）统一存放在此目录下。
pub fn app_data_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let dir = home.join(APP_DIR_NAME);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// 获取用户家目录字符串，供 Tauri Command 返回给前端。
///
/// `dirs::home_dir()` 失败时回退到根目录 `/`。
pub fn home_dir_string() -> Result<String, String> {
    dirs::home_dir()
        .or_else(|| Some(PathBuf::from("/")))
        .and_then(|p| p.to_str().map(|s| s.to_string()))
        .ok_or("Cannot determine home directory".into())
}
