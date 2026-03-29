use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

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
        "js" | "jsx" => "javascript".into(),
        "rs" => "rust".into(),
        "py" => "python".into(),
        "css" | "scss" | "less" => "css".into(),
        "html" => "html".into(),
        "json" => "json".into(),
        "md" => "markdown".into(),
        "toml" | "yaml" | "yml" => "config".into(),
        "png" | "jpg" | "jpeg" | "gif" | "svg" | "ico" => "image".into(),
        "exe" | "msi" => "executable".into(),
        "zip" | "tar" | "gz" | "rar" | "7z" => "archive".into(),
        _ => "file".into(),
    }
}

pub fn read_dir_entries(dir_path: &str) -> Result<Vec<FileEntry>, String> {
    let path = Path::new(dir_path);
    if !path.is_dir() {
        return Err(format!("Not a directory: {}", dir_path));
    }
    let mut entries = Vec::new();
    let read_dir = fs::read_dir(path).map_err(|e| e.to_string())?;
    for entry in read_dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let name = entry
            .file_name()
            .to_str()
            .unwrap_or("?")
            .to_string();
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
        b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

pub fn create_file_entry(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    if p.exists() {
        return Err(format!("Already exists: {}", path));
    }
    fs::File::create(p).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn create_dir_entry(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    if p.exists() {
        return Err(format!("Already exists: {}", path));
    }
    fs::create_dir(p).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn rename_entry(old_path: &str, new_path: &str) -> Result<(), String> {
    let from = Path::new(old_path);
    let to = Path::new(new_path);
    if !from.exists() {
        return Err(format!("Not found: {}", old_path));
    }
    if to.exists() {
        return Err(format!("Already exists: {}", new_path));
    }
    fs::rename(from, to).map_err(|e| e.to_string())
}

pub fn move_entries(sources: Vec<String>, dest_dir: String) -> Result<(), String> {
    let dest = Path::new(&dest_dir);
    if !dest.is_dir() {
        return Err(format!("Destination is not a directory: {}", dest_dir));
    }
    for src in sources {
        let from = Path::new(&src);
        if !from.exists() {
            continue;
        }
        let file_name = from.file_name().ok_or("Invalid path")?;
        let to = dest.join(file_name);
        if to.exists() {
            continue;
        }
        fs::rename(from, &to).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn delete_entries(paths: Vec<String>) -> Result<(), String> {
    for path in paths {
        let p = Path::new(&path);
        if !p.exists() {
            continue;
        }
        if p.is_dir() {
            fs::remove_dir_all(p).map_err(|e| e.to_string())?;
        } else {
            fs::remove_file(p).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub fn get_home_directory() -> Result<String, String> {
    dirs::home_dir()
        .or_else(|| Some(PathBuf::from("/")))
        .and_then(|p| p.to_str().map(|s| s.to_string()))
        .ok_or("Cannot determine home directory".into())
}

pub fn list_drives() -> Result<Vec<FileEntry>, String> {
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

    let file_path = Path::new(path);
    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }
    if file_path.is_dir() {
        return Err(format!("Cannot preview directory: {}", path));
    }

    let bytes = fs::read(file_path).map_err(|e| e.to_string())?;
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
        language: detect_language(file_path),
        content: String::from_utf8_lossy(preview_bytes).to_string(),
        truncated,
        size: bytes.len() as u64,
    })
}

fn detect_language(path: &Path) -> String {
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
