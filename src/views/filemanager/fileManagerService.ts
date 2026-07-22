/**
 * File Manager Service — Tauri invoke 封装
 *
 * 封装文件管理器所需的所有后端调用，提供类型安全的接口。
 */
import { Channel, invoke } from '@tauri-apps/api/core';

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

export interface QuickAccessLocation {
  id: 'home' | 'downloads' | 'documents' | 'desktop' | 'pictures';
  path: string;
}

export async function getQuickAccessLocations(): Promise<QuickAccessLocation[]> {
  return invoke<QuickAccessLocation[]>('get_quick_access_locations');
}

export async function openSystemTrash(): Promise<void> {
  return invoke('open_system_trash');
}

export type SearchStreamKind = 'batch' | 'completed' | 'cancelled';

export interface FileSearchStreamEvent {
  searchId: string;
  kind: SearchStreamKind;
  results: FileSearchResult[];
  limited: boolean;
}

export interface ContentSearchStreamEvent {
  searchId: string;
  kind: SearchStreamKind;
  results: ContentSearchResult[];
  limited: boolean;
}

export async function cancelFileSearch(searchId: string): Promise<void> {
  return invoke('cancel_file_search', { searchId });
}

/** 文件夹大小流式事件 */
export type FolderSizeKind = 'size' | 'completed' | 'cancelled';

export interface FolderSizeStreamEvent {
  requestId: string;
  kind: FolderSizeKind;
  path: string;
  size: number;
}

/**
 * 流式计算多个文件夹的递归总大小。
 * 每个文件夹算完即推送 `size` 事件，前端可渐进式填充。
 * 切换目录时调用 `cancelFileSearch(requestId)` 取消未完成的计算。
 */
export async function computeFolderSizesStream(
  paths: string[],
  requestId: string,
  onEvent: (event: FolderSizeStreamEvent) => void,
): Promise<void> {
  const onEventChannel = new Channel<FolderSizeStreamEvent>(onEvent);
  return invoke('compute_folder_sizes_stream', { paths, requestId, onEvent: onEventChannel });
}

export async function searchFilesStream(
  query: string,
  searchId: string,
  onEvent: (event: FileSearchStreamEvent) => void,
  limit = 200,
): Promise<void> {
  const onEventChannel = new Channel<FileSearchStreamEvent>(onEvent);
  return invoke('search_files_stream', { query, searchId, limit, onEvent: onEventChannel });
}

export async function searchContentStream(
  query: string,
  root: string,
  searchId: string,
  onEvent: (event: ContentSearchStreamEvent) => void,
  limit = 200,
  maxMatchesPerFile = 5,
): Promise<void> {
  const onEventChannel = new Channel<ContentSearchStreamEvent>(onEvent);
  return invoke('search_content_stream', {
    query,
    root,
    searchId,
    limit,
    maxMatchesPerFile,
    onEvent: onEventChannel,
  });
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
  available: number;
  used: number;
  kind: string; // "ssd" | "hdd" | "external" | "network" | "removable"
}

/** 读取系统磁盘容量列表 */
export async function listDisks(): Promise<DiskInfo[]> {
  return invoke<DiskInfo[]>('list_disks');
}

// 真正需要外部程序打开的二进制类型
const EXTERNAL_OPEN_ICONS = new Set([
  'archive',      // zip/tar/gz — 压缩包
  'executable',   // exe/dmg/app
  'word',         // doc/docx
  'excel',        // xls/xlsx
  'ppt',          // ppt/pptx
  'pdf',          // pdf
]);

/**
 * 所有文件默认都可用当前软件预览，除非是需要外部程序的二进制类型。
 */
export function isPreviewable(icon: string): boolean {
  return !EXTERNAL_OPEN_ICONS.has(icon);
}

/**
 * 只有特定二进制类型才需要调用系统程序打开。
 */
export function shouldOpenExternally(icon: string): boolean {
  return EXTERNAL_OPEN_ICONS.has(icon);
}

/** 内容搜索 — 单条匹配行 */
export interface ContentMatchLine {
  lineNumber: number;
  lineText: string;
  matchStart: number;
  matchEnd: number;
}

/** 内容搜索 — 单个文件结果 */
export interface ContentSearchResult {
  path: string;
  name: string;
  matches: ContentMatchLine[];
  matchCount: number;
  hasMoreMatches: boolean;
}

/** 文件内容搜索（基于 ripgrep，搜索当前目录及子目录） */
export async function searchContent(
  query: string,
  root: string,
  limit?: number,
): Promise<ContentSearchResult[]> {
  return invoke<ContentSearchResult[]>('search_content', { query, root, limit: limit ?? 100 });
}
