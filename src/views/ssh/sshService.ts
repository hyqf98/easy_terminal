import { invoke } from '@tauri-apps/api/core';

export const sshService = {
  testConnection: (profile: { host: string; port: number; user: string; authType: string; password: string; privateKeyPath: string; jumpProfileId: string }) =>
    invoke<boolean>('test_ssh_connection', { profile }),

  readRemoteDir: (profileId: string, path: string) =>
    invoke<{ name: string; path: string; is_dir: boolean; size: number; modified: number; icon: string }[]>('read_remote_dir', { profileId, path }),

  readRemoteFilePreview: (profileId: string, path: string) =>
    invoke<{ path: string; language: string; content: string; truncated: boolean; size: number }>('read_remote_file_preview', { profileId, path }),

  readRemoteFile: (profileId: string, path: string) =>
    invoke<string>('read_remote_file', { profileId, path }),

  writeRemoteFile: (profileId: string, path: string, content: string) =>
    invoke('write_remote_file', { profileId, path, content }),

  downloadRemoteEntries: (profileId: string, remotePaths: string[], localDir: string) =>
    invoke('download_remote_entries', { profileId, remotePaths, localDir }),

  uploadLocalEntries: (profileId: string, localPaths: string[], remoteDir: string) =>
    invoke('upload_local_entries', { profileId, localPaths, remoteDir }),

  getRemoteHome: (profileId: string) =>
    invoke<string>('get_remote_home', { profileId }),
};
