export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number;
  icon: string;
}

/** Opaque sort cursor returned by one bounded remote-directory page. */
export interface RemoteDirectoryCursor {
  isDir: boolean;
  name: string;
}

/** A bounded directory response that avoids retaining large SFTP listings. */
export interface RemoteDirectoryPage {
  entries: FileEntry[];
  nextCursor: RemoteDirectoryCursor | null;
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
  /**
   * Read one directory page, optionally filtering entries by the current
   * directory's file name. The filter never traverses child directories.
   */
  readDirPage?(path: string, cursor?: RemoteDirectoryCursor | null, nameFilter?: string): Promise<RemoteDirectoryPage>;
  readFilePreview(path: string): Promise<FilePreviewData>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  createEntry(path: string, isDir: boolean): Promise<void>;
  renameEntry(oldPath: string, newPath: string): Promise<void>;
  deleteEntries(paths: string[]): Promise<void>;
  moveEntries(sources: string[], destDir: string): Promise<void>;
  getHomePath(): Promise<string>;
  /** Windows 多盘符：返回盘符根路径列表（仅本地策略实现，远程返回 undefined） */
  listDrives?(): Promise<string[]>;
}
