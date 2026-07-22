import { invoke } from '@tauri-apps/api/core';
import type { SSHProfile } from '../../types';
import type { RemoteDirectoryCursor, RemoteDirectoryPage } from '../filetree/strategies/FileOperationStrategy';

// SSH 远程文件管理服务：所有命令统一透传完整的 profile + profiles 对象，
// 以匹配 Rust 后端命令签名（见 src-tauri/src/lib.rs）
export const sshService = {
  // 读取远程目录条目列表
  readRemoteDir: (profile: SSHProfile, path: string, profiles: SSHProfile[]) =>
    invoke('read_remote_dir', { profile, path, profiles }),

  readRemoteDirPage: (profile: SSHProfile, path: string, cursor: RemoteDirectoryCursor | null, profiles: SSHProfile[], nameFilter = '') =>
    invoke<RemoteDirectoryPage>('read_remote_dir_page', {
      profile,
      path,
      cursor,
      limit: 200,
      nameFilter: nameFilter.trim() || null,
      profiles,
    }),

  // 读取远程文件完整内容（返回 FilePreviewData，调用方按需取 content）
  readRemoteFile: (profile: SSHProfile, path: string, profiles: SSHProfile[]) =>
    invoke('read_remote_file', { profile, path, profiles }),

  // 读取远程文件预览（截断 + 语言识别，返回 FilePreviewData）
  readRemoteFilePreview: (profile: SSHProfile, path: string, profiles: SSHProfile[]) =>
    invoke('read_remote_file_preview', { profile, path, profiles }),

  // 写入远程文件内容
  writeRemoteFile: (profile: SSHProfile, path: string, content: string, profiles: SSHProfile[]) =>
    invoke('write_remote_file', { profile, path, content, profiles }),

  // 获取远程家目录路径
  getRemoteHome: (profile: SSHProfile, profiles: SSHProfile[]) =>
    invoke('get_remote_home', { profile, profiles }),

  // 重命名远程条目
  renameRemoteEntry: (profile: SSHProfile, oldPath: string, newPath: string, profiles: SSHProfile[]) =>
    invoke('rename_remote_entry', { profile, oldPath, newPath, profiles }),

  // 批量删除远程条目
  deleteRemoteEntries: (profile: SSHProfile, paths: string[], profiles: SSHProfile[]) =>
    invoke('delete_remote_entries', { profile, paths, profiles }),

  // 批量移动远程条目到目标目录
  moveRemoteEntries: (profile: SSHProfile, sources: string[], destDir: string, profiles: SSHProfile[]) =>
    invoke('move_remote_entries', { profile, sources, destDir, profiles }),

  /** 递归上传本地文件或目录到远程目录。 */
  uploadLocalEntries: (profile: SSHProfile, localPaths: string[], remoteDir: string, profiles: SSHProfile[], conflictPolicy = 'overwrite') =>
    invoke<void>('upload_local_entries', { profile, localPaths, remoteDir, conflictPolicy, profiles }),

  /** 递归下载远程文件或目录到本地目录。 */
  downloadRemoteEntries: (profile: SSHProfile, remotePaths: string[], localDir: string, profiles: SSHProfile[], conflictPolicy = 'overwrite') =>
    invoke<void>('download_remote_entries', { profile, remotePaths, localDir, conflictPolicy, profiles }),
};
