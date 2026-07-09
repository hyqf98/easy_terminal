import { invoke } from '@tauri-apps/api/core';

export interface FilePreviewData {
  path: string;
  language: string;
  content: string;
  truncated: boolean;
  size: number;
}

export const fsService = {
  readDir: (path: string) =>
    invoke<{ name: string; path: string; is_dir: boolean; size: number; modified: number; icon: string }[]>('read_dir', { path }),

  readFilePreview: (path: string) =>
    invoke<FilePreviewData>('read_file_preview', { path }),

  // 完整读取：复用 read_file_preview（返回 content），避免后端无 read_file 命令导致的 invoke 失败
  readFile: (path: string) =>
    invoke<FilePreviewData>('read_file_preview', { path }).then((r) => r.content),

  // 写文件：后端命令为 write_text_file
  writeFile: (path: string, content: string) =>
    invoke<void>('write_text_file', { path, content }),

  // 创建条目：目录走 create_dir，文件走 create_file（后端两命令均只接收 path）
  createFile: (path: string, isDir: boolean) =>
    invoke<void>(isDir ? 'create_dir' : 'create_file', { path }),

  renameEntry: (oldPath: string, newPath: string) =>
    invoke<void>('rename_entry', { oldPath, newPath }),

  moveEntries: (sources: string[], destDir: string) =>
    invoke<void>('move_entries', { sources, destDir }),

  deleteEntries: (paths: string[]) =>
    invoke<void>('delete_entries', { paths }),
};
