export { LocalFileStrategy } from './LocalFileStrategy';
export { RemoteFileStrategy } from './RemoteFileStrategy';
export type { IFileOperationStrategy, FileEntry, FilePreviewData, RemoteDirectoryCursor, RemoteDirectoryPage } from './FileOperationStrategy';

import { LocalFileStrategy } from './LocalFileStrategy';
import { RemoteFileStrategy } from './RemoteFileStrategy';
import type { IFileOperationStrategy } from './FileOperationStrategy';
import type { SSHProfile } from '../../../types';

export function createLocalFileStrategy(): IFileOperationStrategy {
  return new LocalFileStrategy();
}

export function createRemoteFileStrategy(
  profileId: string,
  home: string,
  profile: SSHProfile,
  profiles: SSHProfile[],
): IFileOperationStrategy {
  return new RemoteFileStrategy(profileId, home, profile, profiles);
}
