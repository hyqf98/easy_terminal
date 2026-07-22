use crate::path_util;
use crate::{fs, settings};
use crate::performance::{self, PerformanceSnapshot};
use serde::{Deserialize, Serialize};
use ssh2::{RenameFlags, Session, Sftp};
use std::fs::{self as local_fs, File as LocalFile};
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const REMOTE_DIRECTORY_PAGE_SIZE: usize = 200;
const SSH_SESSION_IDLE: Duration = Duration::from_secs(60);
const SSH_SESSION_CACHE_LIMIT: usize = 4;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDirectoryCursor {
    pub is_dir: bool,
    pub name: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDirectoryPage {
    pub entries: Vec<fs::FileEntry>,
    pub next_cursor: Option<RemoteDirectoryCursor>,
}

struct CachedSession {
    session: Session,
    last_used: Instant,
}

#[derive(Default)]
struct SessionCaches {
    monitor: std::collections::HashMap<String, CachedSession>,
    file: std::collections::HashMap<String, CachedSession>,
}

static SESSION_CACHES: std::sync::OnceLock<std::sync::Mutex<SessionCaches>> = std::sync::OnceLock::new();

enum SessionPurpose {
    Monitor,
    File,
}

struct ConvertedKey {
    path: PathBuf,
    cleaned_up: bool,
}

impl ConvertedKey {
    fn new(path: PathBuf) -> Self {
        ConvertedKey {
            path,
            cleaned_up: false,
        }
    }
}

impl Drop for ConvertedKey {
    fn drop(&mut self) {
        if !self.cleaned_up {
            let _ = local_fs::remove_file(&self.path);
        }
    }
}

fn convert_openssh_key_to_pem(key_path: &Path) -> Result<ConvertedKey, String> {
    let tmp_dir = std::env::temp_dir();
    let tmp_name = format!(
        "easy-terminal-ssh-key-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );
    let tmp_path = tmp_dir.join(tmp_name);

    let output = Command::new("ssh-keygen")
        .args(["-e", "-f", &key_path.to_string_lossy(), "-m", "pem"])
        .output()
        .map_err(|e| format!("无法执行 ssh-keygen: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("密钥格式转换失败: {}", stderr.trim()));
    }

    local_fs::write(&tmp_path, &output.stdout)
        .map_err(|e| format!("无法写入临时密钥文件: {}", e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = local_fs::set_permissions(&tmp_path, local_fs::Permissions::from_mode(0o600));
    }

    Ok(ConvertedKey::new(tmp_path))
}

fn authenticate_with_key(
    session: &Session,
    user: &str,
    key_path: &Path,
    passphrase: Option<&str>,
) -> Result<(), String> {
    let result = session.userauth_pubkey_file(user, None, key_path, passphrase);

    if let Err(e) = result {
        let err_msg = format!("{}", e);
        let needs_conversion = err_msg.contains("Invalid")
            || err_msg.contains("failed")
            || err_msg.contains("Bad")
            || err_msg.contains("Unable")
            || err_msg.contains("invalid");

        if needs_conversion {
            let converted = convert_openssh_key_to_pem(key_path)?;
            session
                .userauth_pubkey_file(user, None, &converted.path, passphrase)
                .map_err(|e2| {
                    let err2 = format!("{}", e2);
                    format!(
                        "密钥认证失败(已尝试PEM转换): {}\n原始错误: {}\n密钥文件: {}",
                        err2,
                        err_msg,
                        key_path.display()
                    )
                })?;
            Ok(())
        } else {
            Err(format!("密钥认证失败: {}", err_msg))
        }
    } else {
        Ok(())
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileTransferProgress {
    pub direction: String,
    pub status: String,
    pub file_name: String,
    pub detail: String,
    pub transferred_bytes: u64,
    pub total_bytes: u64,
    pub progress_percent: u64,
}

pub fn read_remote_file(
    profile: settings::SSHProfile,
    path: String,
    _profiles: Vec<settings::SSHProfile>,
) -> Result<fs::FilePreviewData, String> {
    let session = connect_session(&profile)?;
    let sftp = session
        .sftp()
        .map_err(|e| format!("无法创建 SFTP 会话: {}", e))?;
    let remote_path = Path::new(&path);

    let stat = sftp
        .stat(remote_path)
        .map_err(|e| format!("读取远程文件信息失败: {}", e))?;
    if stat.is_dir() {
        return Err(format!("不能预览目录: {}", path));
    }

    const MAX_PREVIEW_BYTES: usize = 2 * 1024 * 1024;
    let file_size = stat.size.unwrap_or(0) as usize;
    let mut remote_file = sftp
        .open(remote_path)
        .map_err(|e| format!("打开远程文件失败: {}", e))?;

    let read_size = if file_size > MAX_PREVIEW_BYTES {
        MAX_PREVIEW_BYTES
    } else {
        file_size
    };
    let mut buf = vec![0u8; read_size];
    let mut total_read = 0;
    while total_read < read_size {
        let n = remote_file
            .read(&mut buf[total_read..])
            .map_err(|e| format!("读取远程文件失败: {}", e))?;
        if n == 0 {
            break;
        }
        total_read += n;
    }
    buf.truncate(total_read);

    if buf.iter().take(4096).any(|b| *b == 0) {
        return Err("二进制文件暂不支持预览".to_string());
    }

    let truncated = file_size > MAX_PREVIEW_BYTES;
    Ok(fs::FilePreviewData {
        path: path.clone(),
        language: fs::detect_language(Path::new(&path)),
        content: String::from_utf8_lossy(&buf).to_string(),
        truncated,
        size: file_size as u64,
    })
}

/// 读取远程文件预览：截断至 1MB 并返回语言/内容等元数据。
/// 行为与本地 `fs::read_file_preview` 保持一致，供前端文件预览面板使用。
/// 注：跳板机链路当前通过 `connect_session` 拒绝（暂不支持）。
pub fn read_remote_file_preview(
    profile: settings::SSHProfile,
    path: String,
    _profiles: Vec<settings::SSHProfile>,
) -> Result<fs::FilePreviewData, String> {
    let session = connect_session(&profile)?;
    let sftp = session
        .sftp()
        .map_err(|e| format!("无法创建 SFTP 会话: {}", e))?;
    let remote_path = Path::new(&path);

    let stat = sftp
        .stat(remote_path)
        .map_err(|e| format!("读取远程文件信息失败: {}", e))?;
    if stat.is_dir() {
        return Err(format!("不能预览目录: {}", path));
    }

    const MAX_PREVIEW_BYTES: usize = 1024 * 1024; // 1MB，与本地预览保持一致
    let file_size = stat.size.unwrap_or(0) as usize;
    let mut remote_file = sftp
        .open(remote_path)
        .map_err(|e| format!("打开远程文件失败: {}", e))?;

    let read_size = if file_size > MAX_PREVIEW_BYTES {
        MAX_PREVIEW_BYTES
    } else {
        file_size
    };
    let mut buf = vec![0u8; read_size];
    let mut total_read = 0;
    while total_read < read_size {
        let n = remote_file
            .read(&mut buf[total_read..])
            .map_err(|e| format!("读取远程文件失败: {}", e))?;
        if n == 0 {
            break;
        }
        total_read += n;
    }
    buf.truncate(total_read);

    if buf.iter().take(4096).any(|b| *b == 0) {
        return Err("二进制文件暂不支持预览".to_string());
    }

    let truncated = file_size > MAX_PREVIEW_BYTES;
    Ok(fs::FilePreviewData {
        path: path.clone(),
        language: fs::detect_language(Path::new(&path)),
        content: String::from_utf8_lossy(&buf).to_string(),
        truncated,
        size: file_size as u64,
    })
}

pub fn write_remote_file(
    profile: settings::SSHProfile,
    path: String,
    content: String,
    _profiles: Vec<settings::SSHProfile>,
) -> Result<(), String> {
    let session = connect_session(&profile)?;
    let sftp = session
        .sftp()
        .map_err(|e| format!("无法创建 SFTP 会话: {}", e))?;
    let remote_path = Path::new(&path);

    let mut remote_file = sftp
        .create(remote_path)
        .map_err(|e| format!("创建远程文件失败: {}", e))?;
    remote_file
        .write_all(content.as_bytes())
        .map_err(|e| format!("写入远程文件失败: {}", e))?;
    remote_file
        .flush()
        .map_err(|e| format!("刷新远程文件失败: {}", e))?;
    Ok(())
}

pub fn test_connection(
    host: String,
    port: u16,
    user: String,
    auth_type: String,
    password: String,
    private_key_path: String,
    jump_profile_id: String,
    profiles: Vec<settings::SSHProfile>,
) -> Result<String, String> {
    if jump_profile_id.is_empty() {
        return test_direct_connection(host, port, user, auth_type, password, private_key_path);
    }

    if auth_type == "password" {
        return Err(
            "当前版本暂不支持带跳板链路的密码测试，请优先验证目标机直连或改用密钥认证".to_string(),
        );
    }

    test_via_system_ssh(
        host,
        port,
        user,
        auth_type,
        private_key_path,
        jump_profile_id,
        profiles,
    )
}

pub fn get_remote_home(
    profile: settings::SSHProfile,
    _profiles: Vec<settings::SSHProfile>,
) -> Result<String, String> {
    let session = connect_session(&profile)?;
    let mut channel = session
        .channel_session()
        .map_err(|e| format!("无法创建 SSH 通道: {}", e))?;
    channel
        .exec("printf %s \"$HOME\"")
        .map_err(|e| format!("无法获取远程 HOME: {}", e))?;
    let mut output = String::new();
    channel
        .read_to_string(&mut output)
        .map_err(|e| format!("无法读取远程 HOME: {}", e))?;
    let _ = channel.wait_close();
    let home = output.trim();
    if home.is_empty() {
        return Ok("/".to_string());
    }
    Ok(normalize_remote_path(home))
}

/// 复用已建立的 SSH session 获取远程 home 目录，避免重复连接。
fn get_remote_home_from_session(session: &Session) -> Result<String, String> {
    let mut channel = session
        .channel_session()
        .map_err(|e| format!("无法创建 SSH 通道: {}", e))?;
    channel
        .exec("printf %s \"$HOME\"")
        .map_err(|e| format!("无法获取远程 HOME: {}", e))?;
    let mut output = String::new();
    channel
        .read_to_string(&mut output)
        .map_err(|e| format!("无法读取远程 HOME: {}", e))?;
    let _ = channel.wait_close();
    let home = output.trim();
    if home.is_empty() {
        return Ok("/".to_string());
    }
    Ok(normalize_remote_path(home))
}

fn directory_sort_key(entry: &fs::FileEntry) -> (u8, String, String) {
    (
        if entry.is_dir { 0 } else { 1 },
        entry.name.to_lowercase(),
        entry.name.clone(),
    )
}

fn cursor_sort_key(cursor: &RemoteDirectoryCursor) -> (u8, String, String) {
    (
        if cursor.is_dir { 0 } else { 1 },
        cursor.name.to_lowercase(),
        cursor.name.clone(),
    )
}

/// Read a bounded, sorted remote directory page without materializing the
/// whole SFTP directory in memory. Later pages rescan the directory using the
/// last sort key, trading a little remote I/O for stable application memory.
pub fn read_remote_dir_page(
    profile: settings::SSHProfile,
    path: String,
    cursor: Option<RemoteDirectoryCursor>,
    limit: Option<usize>,
    name_filter: Option<String>,
    _profiles: Vec<settings::SSHProfile>,
) -> Result<RemoteDirectoryPage, String> {
    let page_size = limit.unwrap_or(REMOTE_DIRECTORY_PAGE_SIZE).clamp(1, REMOTE_DIRECTORY_PAGE_SIZE);
    let normalized_name_filter = name_filter
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase);
    with_cached_session(&profile, SessionPurpose::File, |session| {
        let sftp = session
            .sftp()
            .map_err(|e| format!("无法创建 SFTP 会话: {}", e))?;
        // Shell titles commonly report `~` / `~/project`. Resolve both against
        // the connected account, rather than treating every non-absolute path
        // as the home directory and silently losing the requested subfolder.
        let home = get_remote_home_from_session(session)?;
        let target = if path.trim().is_empty() || path.trim() == "~" {
            home
        } else if let Some(relative) = path.trim().strip_prefix("~/") {
            join_remote_path(&home, relative)
        } else if path.starts_with('/') {
            normalize_remote_path(&path)
        } else {
            home
        };
        let after = cursor.as_ref().map(cursor_sort_key);
        let mut candidates: Vec<fs::FileEntry> = Vec::with_capacity(page_size + 1);
        let mut matching_entries = 0usize;
        let mut directory = sftp
            .opendir(Path::new(&target))
            .map_err(|e| format!("读取远程目录失败: {}", e))?;

        while let Ok((entry_path, stat)) = directory.readdir() {
            let name = entry_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_string();
            if name.is_empty() || name == "." || name == ".." {
                continue;
            }
            if normalized_name_filter
                .as_ref()
                .is_some_and(|filter| !name.to_lowercase().contains(filter))
            {
                continue;
            }
            let entry = fs::FileEntry {
                name: name.clone(),
                path: join_remote_path(&target, &name),
                is_dir: stat.is_dir(),
                size: stat.size.unwrap_or(0),
                modified: stat.mtime.unwrap_or(0),
                icon: remote_icon(&name, stat.is_dir()),
            };
            if after.as_ref().is_some_and(|last| directory_sort_key(&entry) <= *last) {
                continue;
            }
            matching_entries += 1;
            candidates.push(entry);
            candidates.sort_by_key(directory_sort_key);
            if candidates.len() > page_size {
                candidates.pop();
            }
        }

        let next_cursor = if matching_entries > page_size {
            candidates.last().map(|entry| RemoteDirectoryCursor {
                is_dir: entry.is_dir,
                name: entry.name.clone(),
            })
        } else {
            None
        };
        Ok(RemoteDirectoryPage { entries: candidates, next_cursor })
    })
}

/// Compatibility wrapper for callers that have not yet adopted pagination.
pub fn read_remote_dir(
    profile: settings::SSHProfile,
    path: String,
    profiles: Vec<settings::SSHProfile>,
) -> Result<Vec<fs::FileEntry>, String> {
    Ok(read_remote_dir_page(profile, path, None, Some(REMOTE_DIRECTORY_PAGE_SIZE), None, profiles)?.entries)
}

pub fn download_remote_entries(
    app_handle: AppHandle,
    profile: settings::SSHProfile,
    remote_paths: Vec<String>,
    local_dir: String,
    conflict_policy: Option<String>,
    _profiles: Vec<settings::SSHProfile>,
) -> Result<(), String> {
    if remote_paths.is_empty() {
        return Ok(());
    }

    let session = connect_session(&profile)?;
    let sftp = session
        .sftp()
        .map_err(|e| format!("无法创建 SFTP 会话: {}", e))?;
    let destination = PathBuf::from(local_dir);
    local_fs::create_dir_all(&destination).map_err(|e| format!("无法创建本地目录: {}", e))?;

    let total_bytes = remote_paths.iter().try_fold(0u64, |acc, path| {
        collect_remote_size(&sftp, Path::new(path)).map(|size| acc + size)
    })?;
    let mut transferred = 0u64;

    emit_transfer(
        &app_handle,
        progress_payload(
            "download",
            "starting",
            remote_paths[0].clone(),
            "开始下载".to_string(),
            0,
            total_bytes,
        ),
    );

    let policy = normalize_conflict_policy(conflict_policy.as_deref());
    for remote_path in &remote_paths {
        let name = Path::new(remote_path)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("remote-item");
        let local_target = destination.join(name);
        if local_target.exists() && policy == "skip" {
            continue;
        }
        let local_target = if local_target.exists() && policy == "rename" {
            next_local_name(&local_target)
        } else {
            local_target
        };
        download_entry_recursive(
            &sftp,
            Path::new(remote_path),
            &local_target,
            &app_handle,
            total_bytes,
            &mut transferred,
        )?;
    }

    emit_transfer(
        &app_handle,
        progress_payload(
            "download",
            "success",
            remote_paths[0].clone(),
            "下载完成".to_string(),
            transferred,
            total_bytes,
        ),
    );
    Ok(())
}

pub fn upload_local_entries(
    app_handle: AppHandle,
    profile: settings::SSHProfile,
    local_paths: Vec<String>,
    remote_dir: String,
    conflict_policy: Option<String>,
    _profiles: Vec<settings::SSHProfile>,
) -> Result<(), String> {
    if local_paths.is_empty() {
        return Ok(());
    }

    let session = connect_session(&profile)?;
    let sftp = session
        .sftp()
        .map_err(|e| format!("无法创建 SFTP 会话: {}", e))?;
    let remote_dir_path = PathBuf::from(normalize_remote_path(&remote_dir));
    ensure_remote_dir(&sftp, &remote_dir_path)?;

    let total_bytes = local_paths.iter().try_fold(0u64, |acc, local_path| {
        collect_local_size(Path::new(local_path)).map(|size| acc + size)
    })?;
    let mut transferred = 0u64;

    emit_transfer(
        &app_handle,
        progress_payload(
            "upload",
            "starting",
            remote_dir.clone(),
            "开始上传".to_string(),
            0,
            total_bytes,
        ),
    );

    let policy = normalize_conflict_policy(conflict_policy.as_deref());
    for local_path in &local_paths {
        let local = PathBuf::from(local_path);
        let file_name = local
            .file_name()
            .ok_or("无效的本地路径")?
            .to_string_lossy()
            .to_string();
        let remote_target = remote_dir_path.join(file_name);
        if sftp.stat(&remote_target).is_ok() && policy == "skip" {
            continue;
        }
        let remote_target = if sftp.stat(&remote_target).is_ok() && policy == "rename" {
            next_remote_name(&sftp, &remote_target)?
        } else {
            remote_target
        };
        upload_entry_recursive(
            &sftp,
            &local,
            &remote_target,
            &app_handle,
            total_bytes,
            &mut transferred,
        )?;
    }

    emit_transfer(
        &app_handle,
        progress_payload(
            "upload",
            "success",
            remote_dir,
            "上传完成".to_string(),
            transferred,
            total_bytes,
        ),
    );
    Ok(())
}

pub fn rename_remote_entry(
    profile: settings::SSHProfile,
    old_path: String,
    new_path: String,
    _profiles: Vec<settings::SSHProfile>,
) -> Result<(), String> {
    let session = connect_session(&profile)?;
    let sftp = session
        .sftp()
        .map_err(|e| format!("无法创建 SFTP 会话: {}", e))?;
    let from = normalize_remote_path(&old_path);
    let to = normalize_remote_path(&new_path);

    if from == to {
        return Ok(());
    }

    if sftp.stat(Path::new(&from)).is_err() {
        return Err(format!("远程路径不存在: {}", from));
    }
    if sftp.stat(Path::new(&to)).is_ok() {
        return Err(format!("目标已存在: {}", to));
    }

    sftp.rename(Path::new(&from), Path::new(&to), Some(RenameFlags::empty()))
        .map_err(|e| format!("远程重命名失败: {}", e))
}

pub fn move_remote_entries(
    profile: settings::SSHProfile,
    sources: Vec<String>,
    dest_dir: String,
    _profiles: Vec<settings::SSHProfile>,
) -> Result<(), String> {
    if sources.is_empty() {
        return Ok(());
    }

    let session = connect_session(&profile)?;
    let sftp = session
        .sftp()
        .map_err(|e| format!("无法创建 SFTP 会话: {}", e))?;
    let target_dir = normalize_remote_path(&dest_dir);
    let target_stat = sftp
        .stat(Path::new(&target_dir))
        .map_err(|e| format!("读取目标目录失败: {}", e))?;
    if !target_stat.is_dir() {
        return Err(format!("目标不是目录: {}", target_dir));
    }

    for source in sources {
        let from = normalize_remote_path(&source);
        let file_name = Path::new(&from)
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| format!("无效路径: {}", from))?;
        let to = join_remote_path(&target_dir, file_name);
        if from == to {
            continue;
        }
        if sftp.stat(Path::new(&to)).is_ok() {
            return Err(format!("目标已存在: {}", to));
        }
        sftp.rename(Path::new(&from), Path::new(&to), Some(RenameFlags::empty()))
            .map_err(|e| format!("远程移动失败: {}", e))?;
    }

    Ok(())
}

pub fn delete_remote_entries(
    profile: settings::SSHProfile,
    paths: Vec<String>,
    _profiles: Vec<settings::SSHProfile>,
) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }

    let session = connect_session(&profile)?;
    let sftp = session
        .sftp()
        .map_err(|e| format!("无法创建 SFTP 会话: {}", e))?;

    for path in paths {
        let normalized = normalize_remote_path(&path);
        delete_remote_entry_recursive(&sftp, Path::new(&normalized))?;
    }

    Ok(())
}

fn test_direct_connection(
    host: String,
    port: u16,
    user: String,
    auth_type: String,
    password: String,
    private_key_path: String,
) -> Result<String, String> {
    let address = format!("{}:{}", host, port);
    let socket = address
        .to_socket_addrs()
        .map_err(|e| format!("无法解析主机地址: {}", e))?
        .next()
        .ok_or("无法解析主机地址")?;

    let tcp = TcpStream::connect_timeout(&socket, Duration::from_secs(6))
        .map_err(|e| format!("SSH 连接失败: {}", e))?;
    let _ = tcp.set_read_timeout(Some(Duration::from_secs(6)));
    let _ = tcp.set_write_timeout(Some(Duration::from_secs(6)));

    let mut session = Session::new().map_err(|e| format!("无法创建 SSH 会话: {}", e))?;
    session.set_tcp_stream(tcp);
    session
        .handshake()
        .map_err(|e| format!("SSH 握手失败: {}", e))?;

    if auth_type == "key" {
        let key_path = expand_home(private_key_path)?;

        if !key_path.exists() {
            return Err(format!("密钥文件不存在: {}", key_path.display()));
        }

        let passphrase = if password.trim().is_empty() {
            None
        } else {
            Some(password.as_str())
        };

        authenticate_with_key(&session, &user, &key_path, passphrase)?;
    } else {
        if password.trim().is_empty() {
            return Err("密码认证需要填写密码".to_string());
        }
        session
            .userauth_password(&user, &password)
            .map_err(|e| format!("密码认证失败: {}", e))?;
    }

    if !session.authenticated() {
        return Err("SSH 认证失败".to_string());
    }

    let mut channel = session
        .channel_session()
        .map_err(|e| format!("无法创建 SSH 通道: {}", e))?;
    channel
        .exec("exit")
        .map_err(|e| format!("远程命令执行失败: {}", e))?;
    let _ = channel.wait_close();

    Ok("连接成功".to_string())
}

fn test_via_system_ssh(
    host: String,
    port: u16,
    user: String,
    auth_type: String,
    private_key_path: String,
    jump_profile_id: String,
    profiles: Vec<settings::SSHProfile>,
) -> Result<String, String> {
    let lookup: std::collections::HashMap<String, &settings::SSHProfile> =
        profiles.iter().map(|p| (p.id.clone(), p)).collect();

    let mut jump_chain: Vec<String> = Vec::new();
    let mut visited = std::collections::HashSet::new();
    let mut current_id = jump_profile_id;

    while !current_id.is_empty() {
        if visited.contains(&current_id) {
            break;
        }
        visited.insert(current_id.clone());
        if let Some(jump) = lookup.get(&current_id) {
            jump_chain.push(format!("{}@{}:{}", jump.user, jump.host, jump.port));
            current_id = jump.jump_profile_id.clone();
        } else {
            break;
        }
    }

    let mut args: Vec<String> = vec![
        "-o".to_string(),
        "BatchMode=yes".to_string(),
        "-o".to_string(),
        "ConnectTimeout=5".to_string(),
        "-o".to_string(),
        "StrictHostKeyChecking=no".to_string(),
    ];

    if auth_type == "key" && !private_key_path.is_empty() {
        args.push("-i".to_string());
        args.push(expand_home(private_key_path)?.to_string_lossy().to_string());
    }

    if !jump_chain.is_empty() {
        args.push("-J".to_string());
        args.push(jump_chain.join(","));
    }

    args.push("-p".to_string());
    args.push(port.to_string());
    args.push(format!("{}@{}", user, host));
    args.push("exit".to_string());

    let output = Command::new("ssh")
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to execute ssh: {}", e))?;

    if output.status.success() {
        Ok("连接成功".to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(stderr.trim().to_string())
    }
}

fn connect_session(profile: &settings::SSHProfile) -> Result<Session, String> {
    if !profile.jump_profile_id.is_empty() {
        return Err("当前版本的远程文件管理暂不支持跳板机链路".to_string());
    }

    let address = format!("{}:{}", profile.host, profile.port);
    let socket = address
        .to_socket_addrs()
        .map_err(|e| format!("无法解析主机地址: {}", e))?
        .next()
        .ok_or("无法解析主机地址")?;

    let tcp = TcpStream::connect_timeout(&socket, Duration::from_secs(8))
        .map_err(|e| format!("SSH 连接失败: {}", e))?;
    let _ = tcp.set_read_timeout(Some(Duration::from_secs(15)));
    let _ = tcp.set_write_timeout(Some(Duration::from_secs(15)));

    let mut session = Session::new().map_err(|e| format!("无法创建 SSH 会话: {}", e))?;
    session.set_tcp_stream(tcp);
    session
        .handshake()
        .map_err(|e| format!("SSH 握手失败: {}", e))?;

    if profile.auth_type == "key" {
        let key_path = expand_home(profile.private_key_path.clone())?;

        if !key_path.exists() {
            return Err(format!("密钥文件不存在: {}", key_path.display()));
        }

        let passphrase = if profile.password.trim().is_empty() {
            None
        } else {
            Some(profile.password.as_str())
        };

        authenticate_with_key(&session, &profile.user, &key_path, passphrase)?;
    } else {
        if profile.password.trim().is_empty() {
            return Err("密码认证需要填写密码".to_string());
        }
        session
            .userauth_password(&profile.user, &profile.password)
            .map_err(|e| format!("密码认证失败: {}", e))?;
    }

    if !session.authenticated() {
        return Err("SSH 认证失败".to_string());
    }

    Ok(session)
}

fn session_cache_key(profile: &settings::SSHProfile) -> String {
    // Exclude password and display-only fields. Connection-affecting changes
    // produce a new key, while cached sessions never expose credentials.
    format!(
        "{}|{}|{}|{}|{}|{}",
        profile.id, profile.host, profile.port, profile.user, profile.auth_type, profile.private_key_path
    )
}

fn session_map(caches: &mut SessionCaches, purpose: SessionPurpose) -> &mut std::collections::HashMap<String, CachedSession> {
    match purpose {
        SessionPurpose::Monitor => &mut caches.monitor,
        SessionPurpose::File => &mut caches.file,
    }
}

fn with_cached_session<T, F>(
    profile: &settings::SSHProfile,
    purpose: SessionPurpose,
    operation: F,
) -> Result<T, String>
where
    F: Fn(&Session) -> Result<T, String>,
{
    let key = session_cache_key(profile);
    let cache_lock = SESSION_CACHES.get_or_init(|| std::sync::Mutex::new(SessionCaches::default()));
    let mut caches = cache_lock.lock().map_err(|_| "SSH 会话缓存已锁定".to_string())?;
    let sessions = session_map(&mut caches, purpose);
    let now = Instant::now();
    sessions.retain(|_, cached| now.duration_since(cached.last_used) < SSH_SESSION_IDLE);

    if let Some(cached) = sessions.get_mut(&key) {
        cached.last_used = now;
        match operation(&cached.session) {
            Ok(value) => return Ok(value),
            Err(_) => {
                // A broken channel/session must not be retained. Reconnect once
                // below; repeated failures return to the caller normally.
                sessions.remove(&key);
            }
        }
    }

    let session = connect_session(profile)?;
    let value = operation(&session)?;
    while sessions.len() >= SSH_SESSION_CACHE_LIMIT {
        if let Some(oldest) = sessions
            .iter()
            .min_by_key(|(_, cached)| cached.last_used)
            .map(|(key, _)| key.clone())
        {
            sessions.remove(&oldest);
        } else {
            break;
        }
    }
    sessions.insert(key, CachedSession { session, last_used: now });
    Ok(value)
}

/// 通过与远程文件管理相同的认证链路采集 Linux 主机性能信息。
/// 采集脚本固定在 performance 模块中，避免将任何前端输入拼接进 shell 命令。
pub fn get_performance_snapshot(
    profile: settings::SSHProfile,
    _profiles: Vec<settings::SSHProfile>,
) -> Result<PerformanceSnapshot, String> {
    with_cached_session(&profile, SessionPurpose::Monitor, |session| {
        let mut channel = session
            .channel_session()
            .map_err(|e| format!("无法创建 SSH 采集通道: {}", e))?;
        channel
            .exec(performance::remote_script())
            .map_err(|e| format!("无法执行远端性能采集: {}", e))?;
        let mut output = String::new();
        channel
            .read_to_string(&mut output)
            .map_err(|e| format!("读取远端性能数据失败: {}", e))?;
        let _ = channel.wait_close();
        performance::parse_remote_snapshot(&output)
    })
}

/// Stop a listener process on the connected Linux host.
/// The PID is numeric at the IPC boundary, so the emitted command has no user-controlled shell content.
pub fn stop_port_process(
    profile: settings::SSHProfile,
    _profiles: Vec<settings::SSHProfile>,
    pid: u32,
) -> Result<(), String> {
    if pid == 0 {
        return Err("无效的远程进程 PID".to_string());
    }
    let session = connect_session(&profile)?;
    let mut channel = session
        .channel_session()
        .map_err(|e| format!("无法创建 SSH 停止进程通道: {}", e))?;
    channel
        .exec(&format!("kill -TERM {}", pid))
        .map_err(|e| format!("无法执行远程停止进程命令: {}", e))?;
    let mut stderr = String::new();
    use std::io::Read;
    channel
        .stderr()
        .read_to_string(&mut stderr)
        .map_err(|e| format!("读取远程停止进程错误失败: {}", e))?;
    let _ = channel.wait_close();
    if channel.exit_status().unwrap_or(1) == 0 {
        Ok(())
    } else if stderr.trim().is_empty() {
        Err(format!("远程停止 PID {} 失败", pid))
    } else {
        Err(stderr.trim().to_string())
    }
}

fn collect_remote_size(sftp: &Sftp, remote_path: &Path) -> Result<u64, String> {
    let stat = sftp
        .stat(remote_path)
        .map_err(|e| format!("读取远程文件信息失败: {}", e))?;
    if stat.is_dir() {
        let mut total = 0u64;
        for (child_path, child_stat) in sftp
            .readdir(remote_path)
            .map_err(|e| format!("读取远程目录失败: {}", e))?
        {
            let name = child_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("");
            if name == "." || name == ".." {
                continue;
            }
            if child_stat.is_dir() {
                total += collect_remote_size(sftp, &child_path)?;
            } else {
                total += child_stat.size.unwrap_or(0);
            }
        }
        Ok(total)
    } else {
        Ok(stat.size.unwrap_or(0))
    }
}

fn collect_local_size(path: &Path) -> Result<u64, String> {
    let metadata = local_fs::metadata(path).map_err(|e| format!("读取本地文件信息失败: {}", e))?;
    if metadata.is_dir() {
        let mut total = 0u64;
        for entry in local_fs::read_dir(path).map_err(|e| format!("读取本地目录失败: {}", e))?
        {
            let entry = entry.map_err(|e| format!("读取本地目录失败: {}", e))?;
            total += collect_local_size(&entry.path())?;
        }
        Ok(total)
    } else {
        Ok(metadata.len())
    }
}

fn download_entry_recursive(
    sftp: &Sftp,
    remote_path: &Path,
    local_target: &Path,
    app_handle: &AppHandle,
    total_bytes: u64,
    transferred: &mut u64,
) -> Result<(), String> {
    let stat = sftp
        .stat(remote_path)
        .map_err(|e| format!("读取远程文件信息失败: {}", e))?;
    if stat.is_dir() {
        local_fs::create_dir_all(local_target).map_err(|e| format!("创建本地目录失败: {}", e))?;
        for (child_path, _) in sftp
            .readdir(remote_path)
            .map_err(|e| format!("读取远程目录失败: {}", e))?
        {
            let name = child_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("");
            if name == "." || name == ".." {
                continue;
            }
            download_entry_recursive(
                sftp,
                &child_path,
                &local_target.join(name),
                app_handle,
                total_bytes,
                transferred,
            )?;
        }
        return Ok(());
    }

    if let Some(parent) = local_target.parent() {
        local_fs::create_dir_all(parent).map_err(|e| format!("创建本地目录失败: {}", e))?;
    }
    let mut remote_file = sftp
        .open(remote_path)
        .map_err(|e| format!("打开远程文件失败: {}", e))?;
    let mut local_file =
        LocalFile::create(local_target).map_err(|e| format!("创建本地文件失败: {}", e))?;
    copy_with_progress(
        &mut remote_file,
        &mut local_file,
        app_handle,
        "download",
        &remote_path.to_string_lossy(),
        total_bytes,
        transferred,
    )
}

fn upload_entry_recursive(
    sftp: &Sftp,
    local_path: &Path,
    remote_target: &Path,
    app_handle: &AppHandle,
    total_bytes: u64,
    transferred: &mut u64,
) -> Result<(), String> {
    let metadata =
        local_fs::metadata(local_path).map_err(|e| format!("读取本地文件信息失败: {}", e))?;
    if metadata.is_dir() {
        ensure_remote_dir(sftp, remote_target)?;
        for entry in
            local_fs::read_dir(local_path).map_err(|e| format!("读取本地目录失败: {}", e))?
        {
            let entry = entry.map_err(|e| format!("读取本地目录失败: {}", e))?;
            upload_entry_recursive(
                sftp,
                &entry.path(),
                &remote_target.join(entry.file_name()),
                app_handle,
                total_bytes,
                transferred,
            )?;
        }
        return Ok(());
    }

    if let Some(parent) = remote_target.parent() {
        ensure_remote_dir(sftp, parent)?;
    }
    let mut local_file =
        LocalFile::open(local_path).map_err(|e| format!("打开本地文件失败: {}", e))?;
    let mut remote_file = sftp
        .create(remote_target)
        .map_err(|e| format!("创建远程文件失败: {}", e))?;
    copy_with_progress(
        &mut local_file,
        &mut remote_file,
        app_handle,
        "upload",
        &local_path.to_string_lossy(),
        total_bytes,
        transferred,
    )
}

fn copy_with_progress<R: Read, W: Write>(
    reader: &mut R,
    writer: &mut W,
    app_handle: &AppHandle,
    direction: &str,
    file_name: &str,
    total_bytes: u64,
    transferred: &mut u64,
) -> Result<(), String> {
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|e| format!("传输失败: {}", e))?;
        if read == 0 {
            break;
        }
        writer
            .write_all(&buffer[..read])
            .map_err(|e| format!("写入失败: {}", e))?;
        *transferred += read as u64;
        emit_transfer(
            app_handle,
            progress_payload(
                direction,
                "progress",
                file_name.to_string(),
                if direction == "upload" {
                    "上传中"
                } else {
                    "下载中"
                }
                .to_string(),
                *transferred,
                total_bytes,
            ),
        );
    }
    writer.flush().map_err(|e| format!("刷新写入失败: {}", e))?;
    Ok(())
}

fn ensure_remote_dir(sftp: &Sftp, remote_path: &Path) -> Result<(), String> {
    let path_string = normalize_remote_path(&remote_path.to_string_lossy());
    let mut current = String::new();
    for segment in path_string.split('/').filter(|segment| !segment.is_empty()) {
        current.push('/');
        current.push_str(segment);
        let path = Path::new(&current);
        match sftp.stat(path) {
            Ok(stat) if stat.is_dir() => {}
            Ok(_) => return Err(format!("远程路径不是目录: {}", current)),
            Err(_) => {
                sftp.mkdir(path, 0o755)
                    .map_err(|e| format!("创建远程目录失败: {}", e))?;
            }
        }
    }
    if path_string == "/" {
        return Ok(());
    }
    Ok(())
}

fn delete_remote_entry_recursive(sftp: &Sftp, path: &Path) -> Result<(), String> {
    let stat = match sftp.stat(path) {
        Ok(stat) => stat,
        Err(_) => return Ok(()),
    };

    if stat.is_dir() {
        for (child_path, _) in sftp
            .readdir(path)
            .map_err(|e| format!("读取远程目录失败: {}", e))?
        {
            let name = child_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("");
            if name == "." || name == ".." {
                continue;
            }
            delete_remote_entry_recursive(sftp, &child_path)?;
        }
        sftp.rmdir(path)
            .map_err(|e| format!("删除远程目录失败: {}", e))?;
        return Ok(());
    }

    sftp.unlink(path)
        .map_err(|e| format!("删除远程文件失败: {}", e))
}

fn progress_payload(
    direction: &str,
    status: &str,
    file_name: String,
    detail: String,
    transferred_bytes: u64,
    total_bytes: u64,
) -> FileTransferProgress {
    let progress_percent = if total_bytes == 0 {
        if status == "success" {
            100
        } else {
            0
        }
    } else {
        ((transferred_bytes as f64 / total_bytes as f64) * 100.0).round() as u64
    };
    FileTransferProgress {
        direction: direction.to_string(),
        status: status.to_string(),
        file_name,
        detail,
        transferred_bytes,
        total_bytes,
        progress_percent: progress_percent.min(100),
    }
}

fn emit_transfer(app_handle: &AppHandle, payload: FileTransferProgress) {
    let _ = app_handle.emit("file-transfer-progress", payload);
}

/// Normalize untrusted UI input to the three supported, non-destructive policies.
fn normalize_conflict_policy(value: Option<&str>) -> &str {
    match value.unwrap_or("overwrite") {
        "skip" => "skip",
        "rename" => "rename",
        _ => "overwrite",
    }
}

/// Produce a non-existing sibling path such as `report (1).log`.
fn next_local_name(path: &Path) -> PathBuf {
    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    let stem = path.file_stem().and_then(|v| v.to_str()).unwrap_or("item");
    let ext = path.extension().and_then(|v| v.to_str()).map(|v| format!(".{v}")).unwrap_or_default();
    for suffix in 1..10_000 {
        let candidate = parent.join(format!("{stem} ({suffix}){ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    parent.join(format!("{stem}-copy{ext}"))
}

/// Produce a non-existing SFTP sibling path using the same stable naming rule.
fn next_remote_name(sftp: &Sftp, path: &Path) -> Result<PathBuf, String> {
    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    let stem = path.file_stem().and_then(|v| v.to_str()).unwrap_or("item");
    let ext = path.extension().and_then(|v| v.to_str()).map(|v| format!(".{v}")).unwrap_or_default();
    for suffix in 1..10_000 {
        let candidate = parent.join(format!("{stem} ({suffix}){ext}"));
        if sftp.stat(&candidate).is_err() {
            return Ok(candidate);
        }
    }
    Err("无法生成不冲突的远程文件名".to_string())
}

fn expand_home(path: String) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("密钥路径不能为空".to_string());
    }

    // 统一使用 path_util::expand_path 展开 `~` 和 `$HOME` 等环境变量，
    // 支持裸 `~`、`~/path`、`~user` 以及 `$VAR`/`${VAR}` 语法。
    Ok(path_util::expand_path(&path))
}

pub fn prepare_ssh_key(private_key_path: String) -> Result<String, String> {
    let key_path = expand_home(private_key_path)?;

    if !key_path.exists() {
        return Err(format!("密钥文件不存在: {}", key_path.display()));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let metadata =
            local_fs::metadata(&key_path).map_err(|e| format!("无法读取密钥文件信息: {}", e))?;
        let mode = metadata.permissions().mode() & 0o777;

        if mode & 0o077 == 0 {
            return Ok(key_path.to_string_lossy().to_string());
        }

        let tmp_dir = std::env::temp_dir().join("easy-terminal-ssh-keys");
        local_fs::create_dir_all(&tmp_dir).map_err(|e| format!("无法创建临时目录: {}", e))?;

        let tmp_name = format!(
            "key-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
        );
        let tmp_path = tmp_dir.join(tmp_name);

        local_fs::copy(&key_path, &tmp_path).map_err(|e| format!("无法复制密钥文件: {}", e))?;

        local_fs::set_permissions(&tmp_path, local_fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("无法设置密钥文件权限: {}", e))?;

        Ok(tmp_path.to_string_lossy().to_string())
    }

    #[cfg(not(unix))]
    {
        Ok(key_path.to_string_lossy().to_string())
    }
}

fn normalize_remote_path(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    if normalized.is_empty() {
        "/".to_string()
    } else if normalized.starts_with('/') {
        normalized
    } else {
        format!("/{}", normalized)
    }
}

fn join_remote_path(base: &str, name: &str) -> String {
    let normalized_base = normalize_remote_path(base);
    if normalized_base == "/" {
        format!("/{}", name)
    } else {
        format!("{}/{}", normalized_base.trim_end_matches('/'), name)
    }
}

fn remote_icon(name: &str, is_dir: bool) -> String {
    if is_dir {
        return "folder".to_string();
    }

    let ext = Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
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
        "zip" | "tar" | "gz" | "rar" | "7z" => "archive".into(),
        _ => "file".into(),
    }
}
