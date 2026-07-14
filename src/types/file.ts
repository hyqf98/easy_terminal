export interface FilePreviewData {
  path: string;
  language: string;
  content: string;
  truncated: boolean;
  size: number;
}

// Re-export file manager types for centralized access
export type { FileEntry, FileSearchResult, IndexStatus, IndexConfig, DiskInfo } from '../views/filemanager/fileManagerService';
