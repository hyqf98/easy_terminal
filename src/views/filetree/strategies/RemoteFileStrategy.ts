import type { IFileOperationStrategy, FileEntry, FilePreviewData } from './FileOperationStrategy';
import { sshService } from '../../ssh/sshService';

export class RemoteFileStrategy implements IFileOperationStrategy {
  private profileId: string;
  private homePath: string;

  constructor(profileId: string, home: string) {
    this.profileId = profileId;
    this.homePath = home;
  }

  async readDir(path: string): Promise<FileEntry[]> {
    return sshService.readRemoteDir(this.profileId, path) as Promise<FileEntry[]>;
  }

  async readFilePreview(path: string): Promise<FilePreviewData> {
    return sshService.readRemoteFilePreview(this.profileId, path) as Promise<FilePreviewData>;
  }

  async readFile(path: string): Promise<string> {
    return sshService.readRemoteFile(this.profileId, path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    await sshService.writeRemoteFile(this.profileId, path, content);
  }

  async createEntry(_path: string, _isDir: boolean): Promise<void> {
    await sshService.writeRemoteFile(this.profileId, _path, '');
  }

  async renameEntry(_oldPath: string, _newPath: string): Promise<void> {
    throw new Error('Remote rename not supported via SSH');
  }

  async deleteEntries(_paths: string[]): Promise<void> {
    throw new Error('Remote delete not supported via SSH');
  }

  async getHomePath(): Promise<string> {
    return this.homePath;
  }

  getProfileId(): string {
    return this.profileId;
  }
}
