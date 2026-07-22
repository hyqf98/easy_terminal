// build.rs — 构建时自动下载各平台 OpenVPN 二进制 + Windows wintun.dll
//
// 打包后用户无需自行安装 openvpn，下载安装包即可直接使用 VPN 功能。
// 下载失败不阻塞编译，运行时会退化到检测系统已安装的 openvpn。

use std::env;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::time::Duration;

const WINTUN_VERSION: &str = "0.14.1";

fn main() {
    // 先下载 openvpn 二进制，再执行 Tauri 构建。
    // Tauri 的 externalBin 要求二进制在 tauri_build::build() 之前就存在。
    prepare_openvpn_binaries();
    tauri_build::build();
}

/// 检测当前编译目标并下载对应的 openvpn 二进制。
fn prepare_openvpn_binaries() {
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".into());
    let project_root = PathBuf::from(&manifest_dir);
    let binaries_dir = project_root.join("binaries");
    let resources_dir = project_root.join("resources");

    let _ = fs::create_dir_all(&binaries_dir);
    let _ = fs::create_dir_all(&resources_dir);

    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();

    let triple = match (target_os.as_str(), target_arch.as_str()) {
        ("windows", "x86_64") => "x86_64-pc-windows-msvc",
        ("macos", "aarch64") => "aarch64-apple-darwin",
        ("macos", "x86_64") => "x86_64-apple-darwin",
        ("linux", "x86_64") => "x86_64-unknown-linux-gnu",
        _ => {
            println!(
                "cargo:warning=[vpn] 目标平台 {} {} 不支持自动下载 openvpn，运行时将退化到系统检测",
                target_os, target_arch
            );
            return;
        }
    };

    // 1. 下载 openvpn 二进制（如果不存在）
    let ext = if target_os == "windows" { "exe" } else { "" };
    let bin_filename = if ext.is_empty() {
        format!("openvpn-{}", triple)
    } else {
        format!("openvpn-{}.{}", triple, ext)
    };
    let bin_path = binaries_dir.join(&bin_filename);

    if bin_path.exists() {
        println!("cargo:rerun-if-changed={}", bin_path.display());
    } else {
        let url = download_url(triple, target_os == "windows");
        println!("cargo:warning=[vpn] 正在下载 openvpn: {}", url);
        match download_file(&url, &bin_path) {
            Ok(()) => {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = fs::set_permissions(&bin_path, fs::Permissions::from_mode(0o755));
                }
                println!("cargo:warning=[vpn] openvpn 下载完成: {}", bin_path.display());
            }
            Err(e) => {
                println!(
                    "cargo:warning=[vpn] openvpn 下载失败（{}），运行时将退化到系统检测",
                    e
                );
            }
        }
    }

    // 2. Windows 额外下载 wintun.dll
    if target_os == "windows" {
        let wintun_path = resources_dir.join("wintun.dll");
        if wintun_path.exists() {
            println!("cargo:rerun-if-changed={}", wintun_path.display());
        } else {
            let wintun_url = format!(
                "https://www.wintun.net/builds/wintun-{}.zip",
                WINTUN_VERSION
            );
            println!("cargo:warning=[vpn] 正在下载 wintun: {}", wintun_url);
            // wintun.dll 在 zip 内路径为 wintun/bin/amd64/wintun.dll
            match download_and_extract_wintun(&wintun_url, &wintun_path) {
                Ok(()) => {
                    println!(
                        "cargo:warning=[vpn] wintun.dll 下载完成: {}",
                        wintun_path.display()
                    );
                }
                Err(e) => {
                    println!(
                        "cargo:warning=[vpn] wintun.dll 下载失败（{}），Windows VPN 可能无法创建虚拟网卡",
                        e
                    );
                }
            }
        }
    }
}

/// 构造 openvpn 二进制的下载 URL。
///
/// 二进制托管在 GitHub Release 上，按 target-triple 命名。
/// 开发者需预先上传对应平台的 openvpn 二进制到 Release。
fn download_url(triple: &str, _is_windows: bool) -> String {
    format!(
        "https://github.com/hyqf98/easy-terminal/releases/download/openvpn-bin/openvpn-{}",
        triple
    )
}

/// 通过原始 TCP 下载文件（不依赖额外 crate）。
fn download_file(url: &str, dest: &PathBuf) -> Result<(), String> {
    let parsed = parse_url(url)?;
    let response = http_get(&parsed.host, &parsed.path, parsed.port)?;
    let mut file = fs::File::create(dest).map_err(|e| format!("创建文件失败: {}", e))?;
    file.write_all(&response.body)
        .map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(())
}

/// 下载 wintun.zip 并提取 wintun.dll（简易 zip 解析）。
///
/// 由于 build.rs 无法方便地依赖 zip crate，这里先下载 zip，
/// 再调用系统 unzip（Unix）或 PowerShell（Windows）提取。
fn download_and_extract_wintun(url: &str, dest: &PathBuf) -> Result<(), String> {
    let parsed = parse_url(url)?;
    let response = http_get(&parsed.host, &parsed.path, parsed.port)?;

    // 先把 zip 写到临时文件
    let temp_zip = dest.with_extension("zip.tmp");
    {
        let mut file =
            fs::File::create(&temp_zip).map_err(|e| format!("创建临时文件失败: {}", e))?;
        file.write_all(&response.body)
            .map_err(|e| format!("写入临时文件失败: {}", e))?;
    }

    // 用系统工具解压
    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!(
                    "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
                    temp_zip.display(),
                    dest.parent().unwrap().display()
                ),
            ])
            .output()
            .map_err(|e| format!("PowerShell 解压失败: {}", e))?;
        if !output.status.success() {
            return Err(format!(
                "解压失败: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        // zip 内结构: wintun/bin/amd64/wintun.dll
        let extracted = dest.parent().unwrap().join("wintun").join("bin").join("amd64").join("wintun.dll");
        if extracted.exists() {
            fs::copy(&extracted, dest).map_err(|e| format!("复制 wintun.dll 失败: {}", e))?;
            let _ = fs::remove_dir_all(dest.parent().unwrap().join("wintun"));
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let output = std::process::Command::new("unzip")
            .arg("-o")
            .arg(&temp_zip)
            .arg("wintun/bin/amd64/wintun.dll")
            .arg("-d")
            .arg(dest.parent().unwrap())
            .output()
            .map_err(|e| format!("unzip 失败（请安装 unzip）: {}", e))?;
        if !output.status.success() {
            return Err(format!(
                "解压失败: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        let extracted = dest.parent().unwrap().join("wintun").join("bin").join("amd64").join("wintun.dll");
        if extracted.exists() {
            fs::copy(&extracted, dest).map_err(|e| format!("复制 wintun.dll 失败: {}", e))?;
            let _ = fs::remove_dir_all(dest.parent().unwrap().join("wintun"));
        }
    }

    let _ = fs::remove_file(&temp_zip);
    Ok(())
}

// ===== 简易 HTTP GET（不依赖 reqwest/ureq） =====

struct ParsedUrl {
    host: String,
    path: String,
    port: u16,
    _is_https: bool,
}

fn parse_url(url: &str) -> Result<ParsedUrl, String> {
    let (scheme, rest) = url
        .split_once("://")
        .ok_or_else(|| format!("无效 URL: {}", url))?;
    let is_https = scheme == "https";
    let default_port = if is_https { 443 } else { 80 };

    let (host_part, path) = match rest.split_once('/') {
        Some((h, p)) => (h.to_string(), format!("/{}", p)),
        None => (rest.to_string(), "/".to_string()),
    };

    let (host, port) = match host_part.split_once(':') {
        Some((h, p)) => (h.to_string(), p.parse().unwrap_or(default_port)),
        None => (host_part, default_port),
    };

    Ok(ParsedUrl {
        host,
        path,
        port,
        _is_https: is_https,
    })
}

struct HttpResponse {
    body: Vec<u8>,
}

/// 发送 HTTP GET 请求（支持重定向）。
fn http_get(host: &str, path: &str, port: u16) -> Result<HttpResponse, String> {
    let mut stream = TcpStream::connect((host, port))
        .map_err(|e| format!("连接 {}:{} 失败: {}", host, port, e))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(120)))
        .map_err(|e| format!("设置超时失败: {}", e))?;

    let request = format!(
        "GET {} HTTP/1.1\r\nHost: {}\r\nUser-Agent: easy-terminal-build/1.0\r\nAccept: */*\r\nConnection: close\r\n\r\n",
        path, host
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|e| format!("发送请求失败: {}", e))?;

    let mut buf = Vec::with_capacity(65536);
    stream
        .read_to_end(&mut buf)
        .map_err(|e| format!("读取响应失败: {}", e))?;

    // 分割 header 和 body
    let split_pos = buf
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or_else(|| "响应格式错误：找不到 header/body 分隔".to_string())?;
    let header_str = String::from_utf8_lossy(&buf[..split_pos]).to_string();
    let body = buf[split_pos + 4..].to_vec();

    // 检查状态码
    let status_line = header_str.lines().next().unwrap_or("");
    if status_line.contains(" 301 ") || status_line.contains(" 302 ") {
        // 处理重定向
        for line in header_str.lines() {
            if let Some(loc) = line.strip_prefix("Location: ").or_else(|| line.strip_prefix("location: ")) {
                let redirect_parsed = parse_url(loc.trim())?;
                return http_get(&redirect_parsed.host, &redirect_parsed.path, redirect_parsed.port);
            }
        }
        return Err("重定向但未找到 Location 头".into());
    }
    if !status_line.contains(" 200 ") {
        return Err(format!("HTTP 请求失败: {}", status_line));
    }

    // 检查是否 chunked
    if header_str.to_lowercase().contains("transfer-encoding: chunked") {
        let body = decode_chunked(&body)?;
        return Ok(HttpResponse { body });
    }

    Ok(HttpResponse { body })
}

/// 解码 HTTP chunked transfer-encoding。
fn decode_chunked(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut result = Vec::new();
    let mut pos = 0;
    while pos < data.len() {
        // 读取 chunk size 行
        let line_end = data[pos..]
            .windows(2)
            .position(|w| w == b"\r\n")
            .ok_or_else(|| "chunk 格式错误".to_string())?;
        let size_str = String::from_utf8_lossy(&data[pos..pos + line_end]);
        let chunk_size = usize::from_str_radix(size_str.trim(), 16)
            .map_err(|e| format!("解析 chunk size 失败: {}", e))?;
        pos += line_end + 2;

        if chunk_size == 0 {
            break;
        }

        if pos + chunk_size > data.len() {
            return Err("chunk 数据不完整".into());
        }
        result.extend_from_slice(&data[pos..pos + chunk_size]);
        pos += chunk_size + 2; // 跳过 chunk 数据和末尾 \r\n
    }
    Ok(result)
}
