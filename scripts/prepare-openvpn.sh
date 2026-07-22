#!/usr/bin/env bash
# scripts/prepare-openvpn.sh
#
# 手动下载各平台 OpenVPN 二进制 + Windows wintun.dll，放到 src-tauri/binaries/。
# 构建时 build.rs 也会自动执行此操作，此脚本可单独运行以便调试/更新。
#
# 用法：
#   ./scripts/prepare-openvpn.sh           # 下载当前平台
#   ./scripts/prepare-openvpn.sh --all      # 下载全部平台
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BINARIES_DIR="$PROJECT_ROOT/src-tauri/binaries"
RESOURCES_DIR="$PROJECT_ROOT/src-tauri/resources"
DOWNLOAD_BASE="https://github.com/hyqf98/easy-terminal/releases/download/openvpn-bin"
WINTUN_URL="https://www.wintun.net/builds/wintun-0.14.1.zip"

mkdir -p "$BINARIES_DIR" "$RESOURCES_DIR"

# 颜色输出
info()  { printf "\033[34m[VPN]\033[0m %s\n" "$1"; }
ok()    { printf "\033[32m[VPN]\033[0m %s\n" "$1"; }
warn()  { printf "\033[33m[VPN]\033[0m %s\n" "$1"; }
error() { printf "\033[31m[VPN]\033[0m %s\n" "$1" >&2; }

# 下载单个平台的 openvpn
download_openvpn() {
    local triple="$1"
    local ext="$2"
    local filename

    if [[ -n "$ext" ]]; then
        filename="openvpn-${triple}.${ext}"
    else
        filename="openvpn-${triple}"
    fi

    local dest="$BINARIES_DIR/$filename"

    if [[ -f "$dest" ]]; then
        ok "已存在: $filename"
        return 0
    fi

    local url="$DOWNLOAD_BASE/openvpn-${triple}"
    info "下载: $url"
    if curl -fSL -o "$dest" "$url"; then
        chmod +x "$dest" 2>/dev/null || true
        ok "完成: $filename"
    else
        error "下载失败: $triple"
        rm -f "$dest"
        return 1
    fi
}

# 下载 wintun.dll（Windows 虚拟网卡驱动）
download_wintun() {
    local dest="$RESOURCES_DIR/wintun.dll"

    if [[ -f "$dest" ]]; then
        ok "已存在: wintun.dll"
        return 0
    fi

    info "下载 wintun.dll..."
    local tmp_zip="$RESOURCES_DIR/wintun.zip"

    if ! curl -fSL -o "$tmp_zip" "$WINTUN_URL"; then
        error "wintun 下载失败"
        rm -f "$tmp_zip"
        return 1
    fi

    # 解压并提取 amd64 版本
    local tmp_extract="$RESOURCES_DIR/wintun-extract"
    mkdir -p "$tmp_extract"
    if unzip -o "$tmp_zip" -d "$tmp_extract" >/dev/null 2>&1; then
        local dll_src="$tmp_extract/wintun/bin/amd64/wintun.dll"
        if [[ -f "$dll_src" ]]; then
            cp "$dll_src" "$dest"
            ok "完成: wintun.dll"
        else
            error "zip 内未找到 wintun.dll"
        fi
    else
        error "解压失败（请确保系统已安装 unzip）"
    fi

    rm -rf "$tmp_extract" "$tmp_zip"
}

# 检测当前平台
detect_platform() {
    local os arch
    os="$(uname -s)"
    arch="$(uname -m)"

    case "$os-$arch" in
        Darwin-arm64)  echo "aarch64-apple-darwin" ;;
        Darwin-x86_64) echo "x86_64-apple-darwin" ;;
        Linux-x86_64)  echo "x86_64-unknown-linux-gnu" ;;
        MINGW*-x86_64|MSYS*-x86_64|CYGWIN*-x86_64)
            echo "x86_64-pc-windows-msvc" ;;
        *) error "不支持的平台: $os-$arch"; exit 1 ;;
    esac
}

main() {
    info "准备 OpenVPN 二进制..."

    if [[ "${1:-}" == "--all" ]]; then
        # 下载全部平台
        info "下载全部平台..."
        download_openvpn "x86_64-pc-windows-msvc" "exe" || true
        download_openvpn "aarch64-apple-darwin" "" || true
        download_openvpn "x86_64-apple-darwin" "" || true
        download_openvpn "x86_64-unknown-linux-gnu" "" || true
        download_wintun || true
    else
        # 只下载当前平台
        local triple
        triple="$(detect_platform)"
        info "当前平台: $triple"

        if [[ "$triple" == *"windows"* ]]; then
            download_openvpn "$triple" "exe" || exit 1
            download_wintun || warn "wintun.dll 下载失败，Windows VPN 可能无法创建虚拟网卡"
        else
            download_openvpn "$triple" "" || exit 1
        fi
    fi

    ok "完成！二进制位于: $BINARIES_DIR"
    info "提示: 运行 pnpm tauri dev 或 pnpm build:xxx 时，build.rs 会自动检查并补充下载。"
}

main "$@"
