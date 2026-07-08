import { invoke } from '@tauri-apps/api/core';

export const fsService = {
  readDir: (path: string) =>
    invoke<{ name: string; path: string; is_dir: boolean; size: number; modified: number; icon: string }[]>('read_dir', { path }),

  readFilePreview: (path: string) =>
    invoke<{ path: string; language: string; content: string; truncated: boolean; size: number }>('read_file_preview', { path }),

  readFile: (path: string) =>
    invoke<string>('read_file', { path }),

  writeFile: (path: string, content: string) =>
    invoke('write_file', { path, content }),

  createFile: (path: string, isDir: boolean) =>
    invoke('create_file', { path, isDir }),

  renameEntry: (oldPath: string, newPath: string) =>
    invoke('rename_entry', { oldPath, newPath }),

  deleteEntries: (paths: string[]) =>
    invoke('delete_entries', { paths }),
};
