/**
 * File Manager Service — Tauri invoke 封装
 *
 * 封装文件管理器所需的所有后端调用，提供类型安全的接口。
 */
import { invoke } from '@tauri-apps/api/core';

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number;
  icon: string;
}

export interface FileSearchResult {
  path: string;
  name: string;
  is_dir: boolean;
  size: number;
  modified: number;
}

export interface IndexStatus {
  indexing: boolean;
  totalFiles: number;
  lastScan: number;
  currentPath: string;
  estimatedTotal: number;
  progress: number; // 0-100
}

export async function readDir(path: string): Promise<FileEntry[]> {
  return invoke<FileEntry[]>('read_dir', { path });
}

export async function createFile(path: string): Promise<void> {
  return invoke('create_file', { path });
}

export async function createDir(path: string): Promise<void> {
  return invoke('create_dir', { path });
}

export async function renameEntry(oldPath: string, newPath: string): Promise<void> {
  return invoke('rename_entry', { oldPath, newPath });
}

export async function moveEntries(sources: string[], destDir: string): Promise<void> {
  return invoke('move_entries', { sources, destDir });
}

export async function deleteEntries(paths: string[]): Promise<void> {
  return invoke('delete_entries', { paths });
}

export async function copyEntries(sources: string[], destDir: string): Promise<void> {
  return invoke('copy_entries', { sources, destDir });
}

export async function trashEntries(paths: string[]): Promise<void> {
  return invoke('trash_entries', { paths });
}

export async function openWithDefaultApp(path: string): Promise<void> {
  return invoke('open_with_default_app', { path });
}

export async function revealInFileManager(path: string): Promise<void> {
  return invoke('reveal_in_file_manager', { path });
}

export async function getHomeDir(): Promise<string> {
  return invoke<string>('get_home_dir');
}

export async function searchFiles(query: string, limit?: number): Promise<FileSearchResult[]> {
  return invoke<FileSearchResult[]>('search_files', { query, limit: limit ?? 200 });
}

export async function getIndexStatus(): Promise<IndexStatus> {
  return invoke<IndexStatus>('get_index_status');
}

export async function rebuildIndex(): Promise<void> {
  return invoke('rebuild_index');
}

/** 索引配置 */
export interface IndexConfig {
  roots: string[];
  excludedPaths: string[];
  enabledCategories: string[];
  customExtensions: string[];
  excludeExtensions: string[];
}

/** 获取索引配置 */
export async function getIndexConfig(): Promise<IndexConfig> {
  return invoke<IndexConfig>('get_index_config');
}

/** 保存索引配置（保存后会自动触发索引重建） */
export async function saveIndexConfig(config: IndexConfig): Promise<void> {
  return invoke('save_index_config', { config });
}

/** 磁盘容量信息 */
export interface DiskInfo {
  name: string;
  mount_point: string;
  fs_type: string;
  total: number;
  used: number;
  kind: string; // "ssd" | "hdd" | "external" | "network" | "removable"
}

/** 读取系统磁盘容量列表 */
export async function listDisks(): Promise<DiskInfo[]> {
  return invoke<DiskInfo[]>('list_disks');
}

/**
 * 判断文件是否可预览（文本/图片/视频 — 使用内置 PreviewPanel）。
 */
export function isPreviewable(icon: string): boolean {
  return PREVIEWABLE_ICONS.has(icon);
}

const PREVIEWABLE_ICONS = new Set([
  'typescript', 'javascript', 'rust', 'python',
  'css', 'html', 'json', 'markdown', 'config',
  'image', 'video',
]);

/**
 * 判断文件是否应使用系统默认程序打开。
 */
export function shouldOpenExternally(icon: string): boolean {
  return EXTERNAL_OPEN_ICONS.has(icon);
}

const EXTERNAL_OPEN_ICONS = new Set([
  'word', 'excel', 'ppt', 'pdf', 'executable',
  'archive', 'audio', 'file',
]);
