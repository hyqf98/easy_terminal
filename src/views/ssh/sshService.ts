import { invoke } from '@tauri-apps/api/core';
import type { SSHProfile } from '../../types';

// SSH 远程文件管理服务：所有命令统一透传完整的 profile + profiles 对象，
// 以匹配 Rust 后端命令签名（见 src-tauri/src/lib.rs）
export const sshService = {
  // 读取远程目录条目列表
  readRemoteDir: (profile: SSHProfile, path: string, profiles: SSHProfile[]) =>
    invoke('read_remote_dir', { profile, path, profiles }),

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
};
