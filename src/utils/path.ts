/**
 * 前端统一路径工具模块
 *
 * 集中所有跨平台的路径处理逻辑（tilde 展开、路径规范化、拼接、绝对路径判断、
 * Shell 标题解析），消除各组件中重复的实现。
 *
 * 注意：前端的路径操作统一使用 `/` 作为分隔符（通过 normalizePath 将 `\` 转为 `/`），
 * 因为 Tauri 后端在 Rust 端使用 `std::path` 处理平台差异，前端仅需保持一致的
 * 逻辑表示即可。
 */

import { invoke } from '@tauri-apps/api/core';

// ============================================================================
// Tilde 展开（`~` → 真实家目录）
// ============================================================================

/** 缓存的本地家目录：首次展开 `~` 时从后端获取，避免重复 invoke */
let cachedHomeDir: string | null = null;

/**
 * 将 `~` / `~/` 前缀展开为绝对路径。
 *
 * 终端上报的 cwd 可能是字面 `~`（如 `~`、`~/projects`），后端的 `expand_path`
 * 会自动处理，但前端在某些场景（如显示、路径比较）也需要展开。首次调用时
 * 从后端 `get_home_dir` 获取真实家目录并缓存。
 *
 * 非 `~` 前缀的路径原样返回。
 */
export async function expandTilde(raw: string): Promise<string> {
  if (!raw) return raw;
  if (raw === '~' || raw.startsWith('~/')) {
    if (cachedHomeDir === null) {
      try {
        cachedHomeDir = await invoke<string>('get_home_dir');
      } catch {
        return raw;
      }
    }
    if (cachedHomeDir) {
      const suffix = raw.slice(1); // 去掉 `~`：`~` → ''，`~/projects` → '/projects'
      if (!suffix) return cachedHomeDir;
      const base = cachedHomeDir.endsWith('/') ? cachedHomeDir.slice(0, -1) : cachedHomeDir;
      return `${base}/${suffix.replace(/^\/+/, '')}`;
    }
  }
  return raw;
}

// ============================================================================
// 路径规范化
// ============================================================================

/**
 * 规范化路径：trim、反斜杠转正斜杠、合并重复斜杠、去除尾部斜杠（保留根 `/`）。
 *
 * 合并了 `normalizeSlashes`（commandIntercept.ts）和 `normalizeFsPath`
 * （TerminalFilePanel.ts）的功能。
 */
export function normalizePath(path: string): string {
  const normalized = path
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/');
  if (normalized === '/') return normalized;
  return normalized.replace(/\/$/, '');
}

// ============================================================================
// 路径拼接
// ============================================================================

/**
 * 将 child 拼接到 base 路径上，自动处理分隔符。
 *
 * 合并了 `joinFsPath`（TerminalFilePanel.ts）和 `joinPath`（FileTree.ts）。
 */
export function joinPath(base: string, child: string): string {
  const normalizedBase = normalizePath(base);
  const normalizedChild = normalizePath(child);
  if (!normalizedChild) return normalizedBase;
  return `${normalizedBase}/${normalizedChild.replace(/^\/+/, '')}`;
}

// ============================================================================
// 绝对路径判断
// ============================================================================

/**
 * 判断是否为绝对路径（POSIX `/`、Windows 盘符 `C:\`/`C:/`、UNC `\\`）。
 *
 * 注意：`~` 和 `~/` 不在此判断范围内（它们需要展开后才成为绝对路径）。
 */
export function isAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('/') || value.startsWith('\\\\');
}

/**
 * 判断是否为有效的路径候选（包含 `~`、绝对路径等）。
 *
 * 用于从终端标题中提取 cwd 后的合法性校验。
 */
export function isValidPathCandidate(value: string): boolean {
  return (
    value === '~' ||
    value.startsWith('~/') ||
    isAbsolutePath(value)
  );
}

// ============================================================================
// Shell 标题解析
// ============================================================================

/** 匹配 `user@host:path` 格式的 SSH/远程提示符 */
const REMOTE_PROMPT_RE = /^[^@\s:]+@[^:\s]+:(.+)$/;

/**
 * 从 Shell 标题/提示符中提取路径部分。
 *
 * 如 `user@server:/home/user/projects` → `/home/user/projects`；
 * 若不匹配远程格式则原样 trim 返回。
 */
export function extractPathFromShellTitle(raw: string): string {
  const trimmed = raw.trim();
  const promptMatch = trimmed.match(REMOTE_PROMPT_RE);
  return (promptMatch ? promptMatch[1] : trimmed).trim();
}

/**
 * 从终端窗口标题中提取并校验 cwd。
 *
 * 先用 `extractPathFromShellTitle` 提取路径，再用 `isValidPathCandidate` 校验。
 * 不合法则返回空字符串。
 */
export function normalizeTitleCwd(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return '';
  const candidate = extractPathFromShellTitle(trimmed);
  if (isValidPathCandidate(candidate)) {
    return candidate;
  }
  return '';
}

// ============================================================================
// 路径组件操作
// ============================================================================

/** 获取父目录路径（POSIX 风格）。根目录的父目录仍是 `/`。 */
export function parentOf(path: string): string {
  const idx = path.replace(/\/+$/, '').lastIndexOf('/');
  if (idx <= 0) return '/';
  return path.substring(0, idx);
}

/** 获取路径的末尾组件名（basename）。 */
export function baseName(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
}

// ============================================================================
// 路径解析（相对路径 → 绝对路径）
// ============================================================================

/**
 * 基于 cwd 解析 input 路径为规范化绝对路径。
 *
 * - 若 input 是绝对路径，直接规范化返回
 * - 否则拼接 cwd + input，并规范化
 */
export function resolvePath(cwd: string, input: string): string {
  if (isAbsolutePath(input)) return normalizePath(input);
  const base = normalizePath(cwd || '');
  if (!base) return normalizePath(input);
  return normalizePath(`${base}/${input}`);
}
