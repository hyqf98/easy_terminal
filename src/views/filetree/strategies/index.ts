export { LocalFileStrategy } from './LocalFileStrategy';
export { RemoteFileStrategy } from './RemoteFileStrategy';
export type { IFileOperationStrategy, FileEntry, FilePreviewData } from './FileOperationStrategy';

import { LocalFileStrategy } from './LocalFileStrategy';
import { RemoteFileStrategy } from './RemoteFileStrategy';
import type { IFileOperationStrategy } from './FileOperationStrategy';

export function createLocalFileStrategy(): IFileOperationStrategy {
  return new LocalFileStrategy();
}

export function createRemoteFileStrategy(profileId: string, home: string): IFileOperationStrategy {
  return new RemoteFileStrategy(profileId, home);
}
