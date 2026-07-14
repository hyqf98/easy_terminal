use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

use crate::path_util;

#[derive(Serialize, Deserialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: u64,
    pub icon: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct FilePreviewData {
    pub path: String,
    pub language: String,
    pub content: String,
    pub truncated: bool,
    pub size: u64,
}

fn get_icon(name: &str, is_dir: bool) -> String {
    if is_dir {
        return "folder".to_string();
    }
    let ext = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "ts" | "tsx" => "typescript".into(),
        "js" | "jsx" | "mjs" | "cjs" => "javascript".into(),
        "rs" => "rust".into(),
        "py" | "pyw" => "python".into(),
        "css" | "scss" | "less" | "sass" => "css".into(),
        "html" | "htm" => "html".into(),
        "json" | "jsonc" => "json".into(),
        "md" | "markdown" => "markdown".into(),
        "toml" | "yaml" | "yml" | "ini" | "conf" | "env" => "config".into(),
        "png" | "jpg" | "jpeg" | "gif" | "svg" | "ico" | "webp" | "bmp" | "avif" => "image".into(),
        "mp4" | "webm" | "mov" | "avi" | "mkv" | "m4v" | "flv" => "video".into(),
        "mp3" | "wav" | "flac" | "aac" | "ogg" | "m4a" => "audio".into(),
        "exe" | "msi" | "app" | "dmg" | "deb" | "rpm" | "apk" => "executable".into(),
        "zip" | "tar" | "gz" | "rar" | "7z" | "bz2" | "xz" => "archive".into(),
        "doc" | "docx" => "word".into(),
        "xls" | "xlsx" | "csv" => "excel".into(),
        "ppt" | "pptx" => "ppt".into(),
        "pdf" => "pdf".into(),
        _ => "file".into(),
    }
}

pub fn read_dir_entries(dir_path: &str) -> Result<Vec<FileEntry>, String> {
    let path = path_util::expand_path(dir_path);
    if !path.is_dir() {
        return Err(format!("Not a directory: {}", dir_path));
    }
    let mut entries = Vec::new();
    let read_dir = fs::read_dir(&path).map_err(|e| e.to_string())?;
    for entry in read_dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let name = entry.file_name().to_str().unwrap_or("?").to_string();
        let file_path = entry.path().to_str().unwrap_or("").to_string();
        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        entries.push(FileEntry {
            name,
            path: file_path,
            is_dir: metadata.is_dir(),
            size: metadata.len(),
            modified,
            icon: get_icon(&entry.file_name().to_str().unwrap_or(""), metadata.is_dir()),
        });
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

pub fn create_file_entry(path: &str) -> Result<(), String> {
    let p = path_util::expand_path(path);
    if p.exists() {
        return Err(format!("Already exists: {}", path));
    }
    fs::File::create(&p).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn create_dir_entry(path: &str) -> Result<(), String> {
    let p = path_util::expand_path(path);
    if p.exists() {
        return Err(format!("Already exists: {}", path));
    }
    fs::create_dir(&p).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn write_text_file(path: &str, content: &str) -> Result<(), String> {
    let p = path_util::expand_path(path);
    fs::write(&p, content).map_err(|e| e.to_string())
}

pub fn rename_entry(old_path: &str, new_path: &str) -> Result<(), String> {
    let from = path_util::expand_path(old_path);
    let to = path_util::expand_path(new_path);
    if !from.exists() {
        return Err(format!("Not found: {}", old_path));
    }
    if to.exists() {
        return Err(format!("Already exists: {}", new_path));
    }
    fs::rename(&from, &to).map_err(|e| e.to_string())
}

pub fn move_entries(sources: Vec<String>, dest_dir: String) -> Result<(), String> {
    let dest = path_util::expand_path(&dest_dir);
    if !dest.is_dir() {
        return Err(format!("Destination is not a directory: {}", dest_dir));
    }
    for src in sources {
        let from = path_util::expand_path(&src);
        if !from.exists() {
            continue;
        }
        let file_name = from.file_name().ok_or("Invalid path")?;
        let to = dest.join(file_name);
        if to.exists() {
            continue;
        }
        fs::rename(&from, &to).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn delete_entries(paths: Vec<String>) -> Result<(), String> {
    for path in paths {
        let p = path_util::expand_path(&path);
        if !p.exists() {
            continue;
        }
        if p.is_dir() {
            fs::remove_dir_all(&p).map_err(|e| e.to_string())?;
        } else {
            fs::remove_file(&p).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// 递归复制文件/目录到目标目录。同名文件自动添加序号后缀。
pub fn copy_entries(sources: Vec<String>, dest_dir: String) -> Result<(), String> {
    let dest = path_util::expand_path(&dest_dir);
    if !dest.is_dir() {
        return Err(format!("Destination is not a directory: {}", dest_dir));
    }
    for src in sources {
        let from = path_util::expand_path(&src);
        if !from.exists() {
            continue;
        }
        let file_name = from.file_name().ok_or("Invalid path")?;
        let target = unique_path(&dest.join(file_name));
        copy_recursive(&from, &target)?;
    }
    Ok(())
}

fn unique_path(path: &Path) -> std::path::PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("file");
    let ext = path.extension().and_then(|s| s.to_str());
    let parent = path.parent().unwrap_or(Path::new("."));
    let mut counter = 2;
    loop {
        let new_name = match ext {
            Some(e) => format!("{} ({}).{}", stem, counter, e),
            None => format!("{} ({})", stem, counter),
        };
        let candidate = parent.join(&new_name);
        if !candidate.exists() {
            return candidate;
        }
        counter += 1;
    }
}

fn copy_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    if src.is_dir() {
        fs::create_dir_all(dest).map_err(|e| e.to_string())?;
        for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let dest_child = dest.join(entry.file_name());
            copy_recursive(&entry.path(), &dest_child)?;
        }
    } else {
        fs::copy(src, dest).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 将文件/目录移入系统回收站。
pub fn trash_entries(paths: Vec<String>) -> Result<(), String> {
    let expanded: Vec<_> = paths.iter().map(|p| path_util::expand_path(p)).collect();
    trash::delete_all(&expanded).map_err(|e| format!("Trash error: {e}"))
}

/// 使用操作系统默认程序打开文件。
pub fn open_with_default_app(path: &str) -> Result<(), String> {
    let p = path_util::expand_path(path);
    if !p.exists() {
        return Err(format!("File not found: {}", path));
    }
    // 使用 std::process::Command 调用平台默认打开程序
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&p)
            .spawn()
            .map_err(|e| format!("Failed to open: {e}"))?;
    }
    #[cfg(windows)]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", p.to_str().unwrap_or("")])
            .spawn()
            .map_err(|e| format!("Failed to open: {e}"))?;
    }
    #[cfg(all(not(target_os = "macos"), not(windows)))]
    {
        std::process::Command::new("xdg-open")
            .arg(&p)
            .spawn()
            .map_err(|e| format!("Failed to open: {e}"))?;
    }
    Ok(())
}

/// 在系统文件管理器中显示文件（Finder/Explorer）。
pub fn reveal_in_file_manager(path: &str) -> Result<(), String> {
    let p = path_util::expand_path(path);
    #[cfg(target_os = "macos")]
    {
        if p.is_dir() {
            std::process::Command::new("open")
                .arg(&p)
                .spawn()
                .map_err(|e| format!("Failed to reveal: {e}"))?;
        } else {
            std::process::Command::new("open")
                .args(["-R", &p.to_str().unwrap_or("")])
                .spawn()
                .map_err(|e| format!("Failed to reveal: {e}"))?;
        }
    }
    #[cfg(windows)]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &p.to_str().unwrap_or("")])
            .spawn()
            .map_err(|e| format!("Failed to reveal: {e}"))?;
    }
    #[cfg(all(not(target_os = "macos"), not(windows)))]
    {
        let dir = if p.is_dir() { &p } else { p.parent().unwrap_or(Path::new(".")) };
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("Failed to reveal: {e}"))?;
    }
    Ok(())
}

pub fn get_home_directory() -> Result<String, String> {
    path_util::home_dir_string()
}

pub fn list_drives() -> Result<Vec<FileEntry>, String> {
    // 盘符枚举仅对 Windows 有意义，非 Windows 平台直接返回空列表
    #[cfg(not(windows))]
    {
        return Ok(Vec::new());
    }

    #[cfg(windows)]
    {
        let mut drives = Vec::new();
        for letter in b'A'..=b'Z' {
            let drive = format!("{}:\\", letter as char);
            if Path::new(&drive).exists() {
                drives.push(FileEntry {
                    name: format!("{}:", letter as char),
                    path: drive,
                    is_dir: true,
                    size: 0,
                    modified: 0,
                    icon: "drive".to_string(),
                });
            }
        }
        Ok(drives)
    }
}

pub fn get_os_platform() -> String {
    if cfg!(windows) {
        "windows".to_string()
    } else if cfg!(target_os = "macos") {
        "darwin".to_string()
    } else {
        "linux".to_string()
    }
}

pub fn read_file_preview(path: &str) -> Result<FilePreviewData, String> {
    const MAX_PREVIEW_BYTES: usize = 1024 * 1024;

    let file_path = path_util::expand_path(path);
    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }
    if file_path.is_dir() {
        return Err(format!("Cannot preview directory: {}", path));
    }

    let bytes = fs::read(&file_path).map_err(|e| e.to_string())?;
    if bytes.iter().take(4096).any(|byte| *byte == 0) {
        return Err("Binary files are not supported in preview".to_string());
    }

    let truncated = bytes.len() > MAX_PREVIEW_BYTES;
    let preview_bytes = if truncated {
        &bytes[..MAX_PREVIEW_BYTES]
    } else {
        &bytes[..]
    };

    Ok(FilePreviewData {
        path: path.to_string(),
        language: detect_language(&file_path),
        content: String::from_utf8_lossy(preview_bytes).to_string(),
        truncated,
        size: bytes.len() as u64,
    })
}

pub fn detect_language(path: &Path) -> String {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "ts" | "tsx" => "typescript".to_string(),
        "js" | "jsx" => "javascript".to_string(),
        "json" => "json".to_string(),
        "rs" => "rust".to_string(),
        "py" => "python".to_string(),
        "md" => "markdown".to_string(),
        "html" => "html".to_string(),
        "css" | "scss" | "less" => "css".to_string(),
        "toml" => "toml".to_string(),
        "yaml" | "yml" => "yaml".to_string(),
        "sh" => "shell".to_string(),
        "ps1" => "powershell".to_string(),
        _ => "text".to_string(),
    }
}
