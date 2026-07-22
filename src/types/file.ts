export interface FilePreviewData {
  path: string;
  language: string;
  content: string;
  truncated: boolean;
  size: number;
}

export type RuntimePlatform = 'windows' | 'darwin' | 'linux';

export interface TerminalFilePreviewRequest {
  terminalId: string;
  commandLine: string;
  path: string;
  mode: 'local' | 'ssh';
  profileId?: string;
  readOnly: boolean;
  signal?: AbortSignal;
}

export interface PrefetchedFilePreview {
  path: string;
  data: FilePreviewData;
}

// Re-export file manager types for centralized access
export type { FileEntry, FileSearchResult, IndexStatus, IndexConfig, DiskInfo } from '../views/filemanager/fileManagerService';
