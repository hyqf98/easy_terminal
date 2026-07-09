import type { IFileOperationStrategy, FileEntry, FilePreviewData } from './FileOperationStrategy';
import { fsService } from '../fsService';
import { invoke } from '@tauri-apps/api/core';

export class LocalFileStrategy implements IFileOperationStrategy {
  async readDir(path: string): Promise<FileEntry[]> {
    return fsService.readDir(path) as Promise<FileEntry[]>;
  }

  async readFilePreview(path: string): Promise<FilePreviewData> {
    return fsService.readFilePreview(path) as Promise<FilePreviewData>;
  }

  async readFile(path: string): Promise<string> {
    return fsService.readFile(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    await fsService.writeFile(path, content);
  }

  async createEntry(path: string, isDir: boolean): Promise<void> {
    await fsService.createFile(path, isDir);
  }

  async renameEntry(oldPath: string, newPath: string): Promise<void> {
    await fsService.renameEntry(oldPath, newPath);
  }

  async deleteEntries(paths: string[]): Promise<void> {
    await fsService.deleteEntries(paths);
  }

  async moveEntries(sources: string[], destDir: string): Promise<void> {
    await fsService.moveEntries(sources, destDir);
  }

  async getHomePath(): Promise<string> {
    return invoke<string>('get_home_dir');
  }

  // Windows 多盘符：调用后端 list_drives，返回盘符根路径数组
  async listDrives(): Promise<string[]> {
    const entries = await invoke<{ path: string }[]>('list_drives');
    return entries.map((entry) => entry.path);
  }
}
