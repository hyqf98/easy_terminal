import type { IFileOperationStrategy, FileEntry, FilePreviewData } from './FileOperationStrategy';
import { sshService } from '../../ssh/sshService';
import type { SSHProfile } from '../../../types';

/**
 * 远程文件策略：通过 SSH（SFTP）执行文件树操作。
 * 所有方法均透传完整的 profile + profiles 对象，匹配 Rust 后端命令签名。
 */
export class RemoteFileStrategy implements IFileOperationStrategy {
  private profileId: string;
  private homePath: string;
  private profile: SSHProfile;
  private profiles: SSHProfile[];

  constructor(profileId: string, home: string, profile: SSHProfile, profiles: SSHProfile[]) {
    this.profileId = profileId;
    this.homePath = home;
    this.profile = profile;
    this.profiles = profiles;
  }

  async readDir(path: string): Promise<FileEntry[]> {
    return sshService.readRemoteDir(this.profile, path, this.profiles) as Promise<FileEntry[]>;
  }

  async readFilePreview(path: string): Promise<FilePreviewData> {
    return sshService.readRemoteFilePreview(this.profile, path, this.profiles) as Promise<FilePreviewData>;
  }

  // 后端 read_remote_file 返回 FilePreviewData，此处提取 content 作为原始文本
  async readFile(path: string): Promise<string> {
    const data = await sshService.readRemoteFile(this.profile, path, this.profiles) as FilePreviewData;
    return data.content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    await sshService.writeRemoteFile(this.profile, path, content, this.profiles);
  }

  async createEntry(_path: string, _isDir: boolean): Promise<void> {
    // 远程策略当前以写入空内容方式创建文件（文件夹创建后续可扩展独立命令）
    await sshService.writeRemoteFile(this.profile, _path, '', this.profiles);
  }

  async renameEntry(oldPath: string, newPath: string): Promise<void> {
    await sshService.renameRemoteEntry(this.profile, oldPath, newPath, this.profiles);
  }

  async deleteEntries(paths: string[]): Promise<void> {
    await sshService.deleteRemoteEntries(this.profile, paths, this.profiles);
  }

  async moveEntries(sources: string[], destDir: string): Promise<void> {
    await sshService.moveRemoteEntries(this.profile, sources, destDir, this.profiles);
  }

  async getHomePath(): Promise<string> {
    return this.homePath;
  }

  getProfileId(): string {
    return this.profileId;
  }
}
