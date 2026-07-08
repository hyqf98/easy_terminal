export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number;
  icon: string;
}

export interface FilePreviewData {
  path: string;
  language: string;
  content: string;
  truncated: boolean;
  size: number;
}

export interface IFileOperationStrategy {
  readDir(path: string): Promise<FileEntry[]>;
  readFilePreview(path: string): Promise<FilePreviewData>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  createEntry(path: string, isDir: boolean): Promise<void>;
  renameEntry(oldPath: string, newPath: string): Promise<void>;
  deleteEntries(paths: string[]): Promise<void>;
  getHomePath(): Promise<string>;
}
