//! VPN 隧道管理模块。
//!
//! 管理 OpenVPN 隧道进程的完整生命周期：
//! - 写入临时 `.ovpn` 配置文件
//! - 检测并启动 `openvpn` 子进程
//! - 通过 management interface（TCP 行协议）实时推送状态与日志
//! - 优雅断开隧道并清理资源
//!
//! ## 架构
//!
//! 全局 [`VpnManager`]（`OnceLock<Mutex<HashMap>>`）存储所有活跃隧道。
//! 每个隧道拥有独立的 management 监听线程，负责解析 OpenVPN 管理协议
//! 并通过 `app_handle.emit()` 向前端推送 `vpn-status` / `vpn-log` 事件。
//!
//! 参考：[OpenVPN management-notes.txt](https://github.com/OpenVPN/openvpn/blob/master/doc/management-notes.txt)

use crate::path_util;
use crate::settings::{VpnProfile, VpnTestResult, VpnTunnelStatus};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// management 监听线程连接 openvpn 管理接口的最大重试次数。
/// 每次 100ms 间隔，总计约 10 秒。
const MANAGEMENT_CONNECT_RETRIES: u32 = 100;

/// 流量统计上报间隔（秒），通过 `bytecount N` 命令设置。
const BYTECOUNT_INTERVAL_SECS: u64 = 5;

/// 断开隧道时等待子进程退出的最大时长。
const DISCONNECT_TIMEOUT: Duration = Duration::from_secs(5);

// ===== 事件载荷 =====

/// `vpn-log` 事件载荷。
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct VpnLogEvent {
    /// 关联的 VPN 配置 ID
    profile_id: String,
    /// 日志消息内容
    message: String,
}

// ===== 活跃隧道 =====

/// 一条活跃的 OpenVPN 隧道。
///
/// 持有子进程句柄、管理端口、临时配置路径以及缓存的运行时状态。
/// `child` 使用 `Option` 以便在断开时 `take()` 取出所有权进行等待 / kill。
#[allow(dead_code)]
struct ActiveTunnel {
    /// VPN 配置 ID（与 [`VpnProfile::id`] 对应）
    profile_id: String,
    /// openvpn 子进程句柄，断开后置 None
    child: Option<std::process::Child>,
    /// management interface 监听端口
    management_port: u16,
    /// 临时 `.ovpn` 配置文件路径（断开时清理）
    config_path: PathBuf,
    /// 隧道启动时间（Unix 时间戳字符串）
    started_at: String,
    /// 缓存的最新运行时状态（由 management 监听线程更新）
    status: VpnTunnelStatus,
}

// ===== 全局管理器 =====

/// 全局隧道映射表（profile_id → ActiveTunnel）。
type TunnelMap = HashMap<String, ActiveTunnel>;

/// 全局 VPN 隧道管理器单例。
///
/// 采用 `OnceLock<Mutex<...>>` 模式（与 `ssh::SESSION_CACHES` 一致），
/// 在首次访问时惰性初始化，进程内全局共享。
static VPN_MANAGER: OnceLock<Mutex<TunnelMap>> = OnceLock::new();

/// 获取全局隧道管理器的静态引用（首次调用时初始化）。
fn vpn_manager() -> &'static Mutex<TunnelMap> {
    VPN_MANAGER.get_or_init(|| Mutex::new(HashMap::new()))
}

// ===== 辅助函数 =====

/// 获取当前时间的 Unix 时间戳字符串。
fn now_timestamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}

/// 解析 `.ovpn` 配置内容。
///
/// 支持两种输入：
/// 1. 内联配置文本（多行，直接返回）
/// 2. 文件路径（无换行、文件存在时读取内容）
///
/// 空配置返回错误。
fn resolve_ovpn_content(config: &str) -> Result<String, String> {
    let trimmed = config.trim();
    if trimmed.is_empty() {
        return Err("VPN 配置内容为空".into());
    }
    // 无换行且指向真实文件时按路径读取
    if !trimmed.contains('\n') {
        let expanded = path_util::expand_path(trimmed);
        if expanded.is_file() {
            return std::fs::read_to_string(&expanded)
                .map_err(|e| format!("读取配置文件失败: {}", e));
        }
    }
    Ok(trimmed.to_string())
}

/// 为指定 profile 生成临时 `.ovpn` 配置文件路径。
///
/// 存放在应用数据目录下，文件名 `vpn-{profile_id}.ovpn`。
fn config_path_for_profile(profile_id: &str) -> Result<PathBuf, String> {
    Ok(path_util::app_data_dir()?.join(format!("vpn-{}.ovpn", profile_id)))
}

/// 分配一个可用的 management 端口。
///
/// 通过绑定 `127.0.0.1:0` 获取操作系统分配的临时端口，随后释放供 openvpn 使用。
/// 存在极小的竞态窗口（drop 与 openvpn 绑定之间），但对本地单用户场景足够。
fn allocate_management_port() -> Result<u16, String> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("无法分配管理端口: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("无法获取管理端口地址: {}", e))?
        .port();
    // 释放监听器，让 openvpn 可以绑定该端口
    drop(listener);
    Ok(port)
}

/// 检测内嵌的 openvpn 二进制（Tauri externalBin 打包后与主程序同目录）。
///
/// Tauri 的 `externalBin` 机制会将二进制放在与主程序相同的目录中，
/// 文件名去除 target-triple 后缀后即为 `openvpn`（或 `openvpn.exe`）。
fn find_bundled_binary() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let name = if cfg!(windows) { "openvpn.exe" } else { "openvpn" };
    let path = dir.join(name);
    if path.exists() {
        Some(path)
    } else {
        None
    }
}

/// 跨平台检测 openvpn 二进制路径。
///
/// 查找优先级：
/// 1. **内嵌二进制**（打包在 app 同目录，用户零安装）
/// 2. **系统注册表 / PATH**（开发模式或用户已自行安装 openvpn）
/// 3. **常见安装路径**（退化兜底）
///
/// - **Windows**：检查注册表 `HKLM\SOFTWARE\OpenVPN\exe_path`，
///   退化到 `C:\Program Files\OpenVPN\bin\openvpn.exe`（含 x86 变体）。
/// - **macOS / Linux**：优先执行 `which openvpn`，
///   退化到常见安装路径（Homebrew、/usr/sbin 等）。
fn find_openvpn_binary() -> Result<PathBuf, String> {
    // 1. 优先：内嵌二进制（打包后与 app 同目录）
    if let Some(path) = find_bundled_binary() {
        return Ok(path);
    }

    #[cfg(target_os = "windows")]
    {
        // 1. 检查注册表 HKLM\SOFTWARE\OpenVPN\exe_path
        if let Ok(output) = Command::new("reg")
            .args(["query", r"HKLM\SOFTWARE\OpenVPN", "/v", "exe_path"])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if line.contains("exe_path") {
                    if let Some(path_str) = line.split_whitespace().last() {
                        let path = PathBuf::from(path_str);
                        if path.exists() {
                            return Ok(path);
                        }
                    }
                }
            }
        }
        // 2. 退化到常见安装路径
        for candidate in [
            r"C:\Program Files\OpenVPN\bin\openvpn.exe",
            r"C:\Program Files (x86)\OpenVPN\bin\openvpn.exe",
        ] {
            let path = PathBuf::from(candidate);
            if path.exists() {
                return Ok(path);
            }
        }
        Err("未找到 OpenVPN，请先安装: https://openvpn.net/".into())
    }

    #[cfg(not(target_os = "windows"))]
    {
        // 1. 通过 which 查找
        if let Ok(output) = Command::new("which").arg("openvpn").output() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() && PathBuf::from(&path).exists() {
                return Ok(PathBuf::from(path));
            }
        }
        // 2. 退化到常见安装路径
        for candidate in [
            "/usr/local/sbin/openvpn",
            "/usr/sbin/openvpn",
            "/opt/homebrew/sbin/openvpn",
            "/opt/homebrew/bin/openvpn",
            "/usr/local/bin/openvpn",
            "/usr/bin/openvpn",
        ] {
            let path = PathBuf::from(candidate);
            if path.exists() {
                return Ok(path);
            }
        }
        Err("未找到 openvpn，请先安装（macOS: brew install openvpn）".into())
    }
}

/// 将 openvpn management 状态名映射为前端状态字符串。
fn map_management_state(state: &str) -> &'static str {
    match state {
        "CONNECTED" => "connected",
        "RECONNECTING" => "reconnecting",
        "EXITING" => "disconnected",
        "INITIAL"
        | "CONNECTING"
        | "WAIT"
        | "AUTH"
        | "GET_CONFIG"
        | "ASSIGN_IP"
        | "ADD_ROUTES"
        | "RESOLVE"
        | "TCP_CONNECT" => "connecting",
        _ => "connecting",
    }
}

// ===== Management 协议解析 =====

/// 解析 `>STATE:` 行，更新隧道缓存状态。
///
/// 行格式：`<timestamp>,<state>,<info>,<local_ip>,<remote_ip>`
fn apply_state_line(payload: &str, status: &mut VpnTunnelStatus) {
    let parts: Vec<&str> = payload.split(',').collect();
    if parts.len() < 2 {
        return;
    }
    let mapped = map_management_state(parts[1]);
    status.state = mapped.to_string();

    // CONNECTED 状态下第 4 个字段是分配的虚拟 IP
    if mapped == "connected" && parts.len() >= 4 {
        status.ip = parts[3].to_string();
    }

    // EXITING 状态清空 IP
    if mapped == "disconnected" {
        status.ip.clear();
    }
}

/// 解析 `>BYTECOUNT:` 行，更新流量统计。
///
/// 行格式：`<bytes_in>,<bytes_out>`
fn apply_bytecount_line(payload: &str, status: &mut VpnTunnelStatus) {
    let parts: Vec<&str> = payload.split(',').collect();
    if parts.len() < 2 {
        return;
    }
    if let Ok(inbound) = parts[0].parse::<u64>() {
        status.bytes_in = inbound;
    }
    if let Ok(outbound) = parts[1].parse::<u64>() {
        status.bytes_out = outbound;
    }
}

/// 解析 `>LOG:` 行，提取消息内容。
///
/// 行格式：`<timestamp>,<flags>,<message>`
/// message 本身可能包含逗号，因此使用 `splitn(3, ',')`。
fn extract_log_message(payload: &str) -> Option<String> {
    let mut parts = payload.splitn(3, ',');
    let _timestamp = parts.next()?;
    let _flags = parts.next()?;
    let message = parts.next()?;
    if message.is_empty() {
        None
    } else {
        Some(message.to_string())
    }
}

/// 连接到 openvpn management 接口（带重试）。
///
/// openvpn 启动后需要短暂时间才能监听 management 端口，
/// 此函数每隔 100ms 重试，最多约 10 秒。
fn connect_management(port: u16) -> Result<TcpStream, String> {
    let addr = format!("127.0.0.1:{}", port);
    for _ in 0..MANAGEMENT_CONNECT_RETRIES {
        match TcpStream::connect(&addr) {
            Ok(stream) => {
                let _ = stream.set_read_timeout(Some(Duration::from_secs(120)));
                let _ = stream.set_nodelay(true);
                return Ok(stream);
            }
            Err(_) => std::thread::sleep(Duration::from_millis(100)),
        }
    }
    Err(format!("无法连接到 openvpn 管理接口 (端口 {})", port))
}

/// management 监听线程入口。
///
/// 在独立 `std::thread` 中运行，负责：
/// 1. 连接 openvpn management TCP 接口
/// 2. 发送初始化命令（`state on` / `bytecount 5` / `log on all`）
/// 3. 循环读取行协议，按前缀分发到状态更新 / 日志推送 / 认证响应
/// 4. 连接断开后检测是否为异常退出，执行清理
///
/// 认证交互：当 openvpn 请求 `Auth` 用户名 / 密码时，自动通过
/// management 接口回填 profile 中的凭据（仅 password 认证模式）。
fn management_listener(
    app_handle: AppHandle,
    profile_id: String,
    management_port: u16,
    username: String,
    password: String,
) {
    // 连接 management 接口
    let stream = match connect_management(management_port) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[vpn] {} management 连接失败: {}", profile_id, e);
            // 标记隧道为错误状态
            mark_tunnel_error(&profile_id, &e, &app_handle);
            cleanup_unexpected_exit(&profile_id, &app_handle);
            return;
        }
    };

    // 克隆一份用于写入命令（读取用原始 stream 包装 BufReader）
    let mut writer = match stream.try_clone() {
        Ok(w) => w,
        Err(e) => {
            eprintln!("[vpn] {} management stream clone 失败: {}", profile_id, e);
            mark_tunnel_error(&profile_id, &e.to_string(), &app_handle);
            cleanup_unexpected_exit(&profile_id, &app_handle);
            return;
        }
    };

    let reader = BufReader::new(stream);

    // 发送初始化命令：启用实时状态 / 流量 / 日志通知
    let init_commands = [
        "hold release",
        "state on",
        &format!("bytecount {}", BYTECOUNT_INTERVAL_SECS),
        "log on all",
    ];
    for cmd in &init_commands {
        if let Err(e) = writeln!(writer, "{}", cmd) {
            eprintln!("[vpn] {} management 写入命令失败: {}", profile_id, e);
            break;
        }
    }
    let _ = writer.flush();

    // 行协议读取循环
    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break, // 连接关闭或读取错误
        };

        // >STATE:<timestamp>,<state>,<info>,<local_ip>,<remote_ip>
        if let Some(payload) = line.strip_prefix(">STATE:") {
            let mut status_changed = false;
            let snapshot = {
                let manager = vpn_manager();
                if let Ok(mut tunnels) = manager.lock() {
                    if let Some(tunnel) = tunnels.get_mut(&profile_id) {
                        apply_state_line(payload, &mut tunnel.status);
                        status_changed = true;
                        Some(tunnel.status.clone())
                    } else {
                        None
                    }
                } else {
                    None
                }
            };
            if status_changed {
                if let Some(snap) = snapshot {
                    let _ = app_handle.emit("vpn-status", snap);
                }
            }
            continue;
        }

        // >BYTECOUNT:<in>,<out>
        if let Some(payload) = line.strip_prefix(">BYTECOUNT:") {
            let snapshot = {
                let manager = vpn_manager();
                if let Ok(mut tunnels) = manager.lock() {
                    if let Some(tunnel) = tunnels.get_mut(&profile_id) {
                        apply_bytecount_line(payload, &mut tunnel.status);
                        Some(tunnel.status.clone())
                    } else {
                        None
                    }
                } else {
                    None
                }
            };
            if let Some(snap) = snapshot {
                let _ = app_handle.emit("vpn-status", snap);
            }
            continue;
        }

        // >LOG:<timestamp>,<flags>,<message>
        if let Some(payload) = line.strip_prefix(">LOG:") {
            if let Some(message) = extract_log_message(payload) {
                let _ = app_handle.emit(
                    "vpn-log",
                    VpnLogEvent {
                        profile_id: profile_id.clone(),
                        message,
                    },
                );
            }
            continue;
        }

        // >HOLD:Waiting for hold release — 释放 hold
        if line.starts_with(">HOLD:") {
            let _ = writeln!(writer, "hold release");
            let _ = writer.flush();
            continue;
        }

        // >PASSWORD:Need 'Auth' username — 回填用户名
        if line.starts_with(">PASSWORD:Need 'Auth' username") {
            if !username.is_empty() {
                let _ = writeln!(writer, "username \"Auth\" {}", username);
                let _ = writer.flush();
            }
            continue;
        }

        // >PASSWORD:Need 'Auth' password — 回填密码
        if line.starts_with(">PASSWORD:Need 'Auth' password") {
            if !password.is_empty() {
                let _ = writeln!(writer, "password \"Auth\" {}", password);
                let _ = writer.flush();
            }
            continue;
        }

        // >PASSWORD:Verification Failed — 认证失败
        if line.starts_with(">PASSWORD:Verification Failed") {
            mark_tunnel_error(&profile_id, "VPN 认证失败：用户名或密码错误", &app_handle);
        }

        // 忽略 SUCCESS / END / INFO / 其他响应行
    }

    // 连接关闭后的清理
    cleanup_unexpected_exit(&profile_id, &app_handle);
}

/// 标记隧道为错误状态并推送事件。
fn mark_tunnel_error(profile_id: &str, message: &str, app_handle: &AppHandle) {
    let snapshot = {
        let manager = vpn_manager();
        if let Ok(mut tunnels) = manager.lock() {
            if let Some(tunnel) = tunnels.get_mut(profile_id) {
                tunnel.status.state = "error".to_string();
                tunnel.status.error_message = message.to_string();
                Some(tunnel.status.clone())
            } else {
                None
            }
        } else {
            None
        }
    };
    if let Some(snap) = snapshot {
        let _ = app_handle.emit("vpn-status", snap);
    }
}

/// 检测并清理异常退出的隧道。
///
/// 当 management 连接断开时调用。如果隧道仍存在于管理器中（说明不是
/// 正常 disconnect 触发），则等待子进程退出并执行清理。
fn cleanup_unexpected_exit(profile_id: &str, app_handle: &AppHandle) {
    let mut removed_tunnel = None;
    {
        let manager = vpn_manager();
        if let Ok(mut tunnels) = manager.lock() {
            if let Some(mut tunnel) = tunnels.remove(profile_id) {
                // 等待子进程退出
                if let Some(child) = tunnel.child.take() {
                    let _ = child.wait_with_output();
                }
                removed_tunnel = Some(tunnel);
            }
        }
    }

    if let Some(mut tunnel) = removed_tunnel {
        // 清理临时配置文件
        let _ = std::fs::remove_file(&tunnel.config_path);

        // 推送最终 disconnected 状态
        tunnel.status.state = "disconnected".to_string();
        tunnel.status.ip.clear();
        if tunnel.status.error_message.is_empty() {
            tunnel.status.error_message = "VPN 连接已断开".to_string();
        }
        let _ = app_handle.emit("vpn-status", tunnel.status.clone());
    }
}

// ===== Tauri 命令 =====

/// 连接 VPN 隧道。
///
/// 完整流程：
/// 1. 校验配置内容（内联文本或文件路径）
/// 2. 写入临时 `.ovpn` 文件（Unix 设置 0600 权限）
/// 3. 分配 management 端口
/// 4. 启动 openvpn 子进程
/// 5. 注册到全局管理器
/// 6. 启动 management 监听线程
///
/// # 参数
/// - `app_handle`: Tauri 应用句柄（自动注入，用于事件推送）
/// - `profile`: VPN 配置（含 `.ovpn` 内容与认证信息）
///
/// # 返回
/// 成功时返回 `tunnel-{profileId}` 格式的隧道标识。
///
/// # 事件
/// 连接后通过 `vpn-status` 推送状态变更，通过 `vpn-log` 推送日志。
#[tauri::command]
pub async fn vpn_connect(
    app_handle: tauri::AppHandle,
    profile: VpnProfile,
) -> Result<String, String> {
    let app_handle_for_thread = app_handle.clone();
    let profile_id = profile.id.clone();

    tauri::async_runtime::spawn_blocking(move || {
        // 1. 校验配置内容
        let config_content = resolve_ovpn_content(&profile.ovpn_config)?;

        // 2. 检查是否已有同名隧道
        {
            let manager = vpn_manager();
            let tunnels = manager.lock().map_err(|e| e.to_string())?;
            if tunnels.contains_key(&profile.id) {
                return Err(format!("VPN 隧道 {} 已存在，请先断开", profile.id));
            }
        }

        // 3. 检测 openvpn 二进制
        let binary = find_openvpn_binary()?;

        // 4. 写入临时配置文件
        let config_path = config_path_for_profile(&profile.id)?;
        std::fs::write(&config_path, &config_content)
            .map_err(|e| format!("写入配置文件失败: {}", e))?;

        // Unix 下设置 0600 权限保护敏感凭据
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(
                &config_path,
                std::fs::Permissions::from_mode(0o600),
            );
        }

        // 5. 分配 management 端口
        let mgmt_port = allocate_management_port()?;

        // 6. 启动 openvpn 子进程（静默、无窗口）
        //
        // - Windows: 使用 CREATE_NO_WINDOW 标志避免弹出黑色控制台窗口；
        //   stderr 重定向到 piped 以防意外输出泄漏到父进程控制台。
        // - 所有平台: stdin/stdout 设为 null，日志全部走 management interface。
        let working_dir = binary.parent().map(|p| p.to_path_buf());
        let mut cmd = Command::new(&binary);
        cmd.arg("--config")
            .arg(&config_path)
            .arg("--management")
            .arg("127.0.0.1")
            .arg(mgmt_port.to_string())
            .arg("--management-query-passwords")
            .arg("--verb")
            .arg("3")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());

        if let Some(ref dir) = working_dir {
            cmd.current_dir(dir);
        }

        // Windows: 隐藏控制台窗口（无感知启动）
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            const DETACHED_PROCESS: u32 = 0x00000008;
            cmd.creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("启动 openvpn 失败: {}", e))?;

        // 消费 stderr 防止管道阻塞（openvpn 的日志已通过 management interface 获取）
        if let Some(stderr) = child.stderr.take() {
            std::thread::spawn(move || {
                let _ = std::io::copy(&mut BufReader::new(stderr), &mut std::io::sink());
            });
        }

        let tunnel_id = format!("tunnel-{}", profile.id);
        let started_at = now_timestamp();

        // 7. 注册到管理器
        let initial_status = VpnTunnelStatus {
            profile_id: profile.id.clone(),
            state: "connecting".to_string(),
            ip: String::new(),
            bytes_in: 0,
            bytes_out: 0,
            connected_at: started_at.clone(),
            error_message: String::new(),
        };

        {
            let manager = vpn_manager();
            let mut tunnels = manager.lock().map_err(|e| e.to_string())?;
            tunnels.insert(
                profile.id.clone(),
                ActiveTunnel {
                    profile_id: profile.id.clone(),
                    child: Some(child),
                    management_port: mgmt_port,
                    config_path,
                    started_at,
                    status: initial_status.clone(),
                },
            );
        }

        // 8. 推送初始 connecting 状态
        let _ = app_handle.emit("vpn-status", initial_status);

        // 9. 启动 management 监听线程
        std::thread::spawn(move || {
            management_listener(
                app_handle_for_thread,
                profile_id,
                mgmt_port,
                profile.username,
                profile.password,
            );
        });

        Ok(tunnel_id)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// 断开 VPN 隧道。
///
/// 完整流程：
/// 1. 从管理器移除隧道（获取所有权）
/// 2. 通过 management 接口发送 `signal SIGTERM`
/// 3. 等待子进程退出（5 秒超时，超时则 kill）
/// 4. 清理临时 `.ovpn` 文件
/// 5. 推送最终 `disconnected` 状态
///
/// 幂等操作：隧道不存在时直接返回 Ok。
///
/// # 参数
/// - `app_handle`: Tauri 应用句柄（自动注入）
/// - `profile_id`: 目标 VPN 配置 ID
#[tauri::command]
pub async fn vpn_disconnect(
    app_handle: tauri::AppHandle,
    profile_id: String,
) -> Result<(), String> {
    let app_handle_for_blocking = app_handle.clone();
    let profile_id_for_blocking = profile_id.clone();

    tauri::async_runtime::spawn_blocking(move || {
        // 1. 从管理器取出隧道（如果不存在则幂等返回）
        let mut tunnel = {
            let manager = vpn_manager();
            let mut tunnels = manager.lock().map_err(|e| e.to_string())?;
            match tunnels.remove(&profile_id_for_blocking) {
                Some(t) => t,
                None => return Ok(()),
            }
        };

        // 2. 通过 management 接口发送 SIGTERM（优雅退出）
        let mgmt_addr = format!("127.0.0.1:{}", tunnel.management_port);
        if let Ok(mut mgmt_stream) = TcpStream::connect(mgmt_addr.as_str()) {
            let _ = mgmt_stream.set_write_timeout(Some(Duration::from_secs(2)));
            let _ = writeln!(mgmt_stream, "signal SIGTERM");
            let _ = mgmt_stream.flush();
        }

        // 3. 等待子进程退出（带超时）
        if let Some(mut child) = tunnel.child.take() {
            let deadline = std::time::Instant::now() + DISCONNECT_TIMEOUT;
            while std::time::Instant::now() < deadline {
                match child.try_wait() {
                    Ok(Some(_)) => break,
                    Ok(None) => std::thread::sleep(Duration::from_millis(200)),
                    Err(_) => break,
                }
            }
            // 超时后强制 kill
            if let Ok(None) = child.try_wait() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }

        // 4. 清理临时配置文件
        let _ = std::fs::remove_file(&tunnel.config_path);

        // 5. 推送最终 disconnected 状态
        tunnel.status.state = "disconnected".to_string();
        tunnel.status.ip.clear();
        tunnel.status.error_message.clear();
        let _ = app_handle_for_blocking.emit("vpn-status", tunnel.status);

        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// 获取所有 VPN 隧道的运行时状态。
///
/// 遍历全局管理器中所有活跃隧道，返回缓存的最新状态快照。
/// 无活跃隧道时返回空列表。
///
/// 状态由 management 监听线程实时更新，此命令仅读取缓存，
/// 不产生网络 I/O，响应极快。
#[tauri::command]
pub async fn vpn_get_status() -> Result<Vec<VpnTunnelStatus>, String> {
    let manager = vpn_manager();
    let tunnels = manager.lock().map_err(|e| e.to_string())?;
    Ok(tunnels.values().map(|t| t.status.clone()).collect())
}

/// 测试 VPN 配置有效性（不发起真实连接）。
///
/// 校验项：
/// 1. 配置内容非空（支持内联文本与文件路径）
/// 2. 配置中包含 `remote` 服务器地址行
/// 3. openvpn 二进制存在
///
/// # 参数
/// - `profile`: 待测试的 VPN 配置
///
/// # 返回
/// [`VpnTestResult`] 包含是否通过、说明信息与可选延迟（当前始终为 None）。
#[tauri::command]
pub async fn vpn_test_connection(profile: VpnProfile) -> Result<VpnTestResult, String> {
    // 1. 校验配置内容
    let content = match resolve_ovpn_content(&profile.ovpn_config) {
        Ok(c) => c,
        Err(e) => {
            return Ok(VpnTestResult {
                success: false,
                message: e,
                latency_ms: None,
            });
        }
    };

    // 2. 解析 remote 行验证服务器地址
    let remote_lines: Vec<&str> = content
        .lines()
        .map(|l| l.trim())
        .filter(|l| {
            let lower = l.to_ascii_lowercase();
            lower.starts_with("remote ") || lower.starts_with("remote\t")
        })
        .collect();

    if remote_lines.is_empty() {
        return Ok(VpnTestResult {
            success: false,
            message: "配置中未找到 remote 服务器地址".to_string(),
            latency_ms: None,
        });
    }

    // 提取第一个 remote 的服务器地址用于展示
    let server_hint = remote_lines[0]
        .split_whitespace()
        .nth(1)
        .unwrap_or("未知");

    // 3. 检查 openvpn 二进制
    match find_openvpn_binary() {
        Ok(path) => Ok(VpnTestResult {
            success: true,
            message: format!(
                "配置有效（服务器: {}），检测到 OpenVPN: {}",
                server_hint,
                path.display()
            ),
            latency_ms: None,
        }),
        Err(e) => Ok(VpnTestResult {
            success: false,
            message: format!("配置已解析（服务器: {}），但未检测到 OpenVPN: {}", server_hint, e),
            latency_ms: None,
        }),
    }
}

/// 关闭所有活跃的 VPN 隧道（应用退出时调用）。
///
/// 遍历全局管理器中的每条隧道，依次执行：
/// 1. 通过 management 接口发送 `signal SIGTERM`（让 openvpn 优雅退出，清理路由表）
/// 2. 等待子进程退出（最多 3 秒/条）
/// 3. 超时则强制 kill
/// 4. 清理临时配置文件
///
/// 此函数是幂等的，重复调用安全。确保应用退出后不会残留 openvpn 进程。
pub fn shutdown_all_vpn() {
    let tunnels: Vec<ActiveTunnel> = {
        let manager = vpn_manager();
        let mut map = match manager.lock() {
            Ok(guard) => guard,
            Err(_) => return, // Mutex 中毒，无法安全清理
        };
        map.drain().map(|(_, t)| t).collect()
    };

    for tunnel in tunnels {
        // 尝试优雅退出
        let mgmt_addr = format!("127.0.0.1:{}", tunnel.management_port);
        if let Ok(mut stream) = TcpStream::connect_timeout(
            &mgmt_addr
                .parse()
                .unwrap_or_else(|_| "127.0.0.1:0".parse().unwrap()),
            Duration::from_secs(1),
        ) {
            let _ = stream.set_write_timeout(Some(Duration::from_secs(1)));
            let _ = writeln!(stream, "signal SIGTERM");
            let _ = stream.flush();
        }

        // 等待退出（3 秒超时后强制 kill）
        if let Some(mut child) = tunnel.child {
            let deadline = std::time::Instant::now() + Duration::from_secs(3);
            while std::time::Instant::now() < deadline {
                match child.try_wait() {
                    Ok(Some(_)) => break,
                    Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                    Err(_) => break,
                }
            }
            if let Ok(None) = child.try_wait() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }

        // 清理临时配置
        let _ = std::fs::remove_file(&tunnel.config_path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_map_management_state() {
        assert_eq!(map_management_state("CONNECTED"), "connected");
        assert_eq!(map_management_state("CONNECTING"), "connecting");
        assert_eq!(map_management_state("RECONNECTING"), "reconnecting");
        assert_eq!(map_management_state("EXITING"), "disconnected");
        assert_eq!(map_management_state("AUTH"), "connecting");
        assert_eq!(map_management_state("UNKNOWN"), "connecting");
    }

    #[test]
    fn test_apply_state_line_connected() {
        let mut status = VpnTunnelStatus {
            profile_id: "test".into(),
            state: "connecting".into(),
            ip: String::new(),
            bytes_in: 0,
            bytes_out: 0,
            connected_at: "123".into(),
            error_message: String::new(),
        };
        apply_state_line("1700000000,CONNECTED,SUCCESS,10.8.0.6,1.2.3.4", &mut status);
        assert_eq!(status.state, "connected");
        assert_eq!(status.ip, "10.8.0.6");
    }

    #[test]
    fn test_apply_state_line_exiting() {
        let mut status = VpnTunnelStatus {
            profile_id: "test".into(),
            state: "connected".into(),
            ip: "10.8.0.6".into(),
            bytes_in: 100,
            bytes_out: 200,
            connected_at: "123".into(),
            error_message: String::new(),
        };
        apply_state_line("1700000001,EXITING,,,", &mut status);
        assert_eq!(status.state, "disconnected");
        assert!(status.ip.is_empty());
    }

    #[test]
    fn test_apply_bytecount_line() {
        let mut status = VpnTunnelStatus {
            profile_id: "test".into(),
            state: "connected".into(),
            ip: String::new(),
            bytes_in: 0,
            bytes_out: 0,
            connected_at: "123".into(),
            error_message: String::new(),
        };
        apply_bytecount_line("1024,2048", &mut status);
        assert_eq!(status.bytes_in, 1024);
        assert_eq!(status.bytes_out, 2048);
    }

    #[test]
    fn test_extract_log_message() {
        assert_eq!(
            extract_log_message("1700000000,I,Initialization Sequence Completed"),
            Some("Initialization Sequence Completed".to_string())
        );
        assert_eq!(
            extract_log_message("1700000000,N,Message with, comma inside"),
            Some("Message with, comma inside".to_string())
        );
        assert_eq!(extract_log_message("1700000000,I,"), None);
    }

    #[test]
    fn test_resolve_ovpn_content_inline() {
        let content = "remote example.com 1194\nclient\ndev tun";
        let result = resolve_ovpn_content(content).unwrap();
        assert!(result.contains("remote example.com"));
    }

    #[test]
    fn test_resolve_ovpn_content_empty() {
        let result = resolve_ovpn_content("   ");
        assert!(result.is_err());
    }

    #[test]
    fn test_find_openvpn_binary_returns_result() {
        // 此测试验证函数不会 panic，结果取决于运行环境是否安装了 openvpn
        let _ = find_openvpn_binary();
    }
}
