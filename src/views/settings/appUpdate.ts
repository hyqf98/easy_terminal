import { getVersion } from '@tauri-apps/api/app';
import { isTauri } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';

export type UpdateStatus =
  | 'idle'
  | 'unsupported'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'completed'
  | 'error';

export interface UpdateState {
  currentVersion: string;
  latestVersion: string;
  status: UpdateStatus;
  error: string;
  progressPercent: number | null;
  downloadedBytes: number;
  contentLength: number | null;
  lastChecked: string;
}

type Listener = (state: UpdateState) => void;

const initialState: UpdateState = {
  currentVersion: '...',
  latestVersion: '',
  status: 'idle',
  error: '',
  progressPercent: null,
  downloadedBytes: 0,
  contentLength: null,
  lastChecked: '',
};

export class AppUpdater {
  private state: UpdateState = { ...initialState };
  private listeners = new Set<Listener>();
  private pendingUpdate: Update | null = null;

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  getState(): UpdateState {
    return { ...this.state };
  }

  private emit() {
    const snapshot = this.getState();
    this.listeners.forEach((listener) => listener(snapshot));
  }

  private patch(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  async init(autoCheck: boolean) {
    if (!isTauri()) {
      this.patch({ status: 'unsupported' });
      return;
    }

    this.patch({ currentVersion: await getVersion() });
    if (autoCheck) {
      void this.checkForUpdates(true);
    }
  }

  setLastChecked(value: string) {
    this.patch({ lastChecked: value });
  }

  async checkForUpdates(silent = false): Promise<void> {
    if (!isTauri()) {
      this.patch({ status: 'unsupported' });
      return;
    }

    this.patch({
      status: 'checking',
      error: '',
      progressPercent: null,
      downloadedBytes: 0,
      contentLength: null,
    });

    try {
      const update = await check();
      const lastChecked = new Date().toISOString();
      this.pendingUpdate = update;

      if (!update) {
        this.patch({
          status: 'up-to-date',
          latestVersion: '',
          lastChecked,
        });
        return;
      }

      this.patch({
        status: 'available',
        latestVersion: update.version,
        lastChecked,
      });
    } catch (error) {
      this.pendingUpdate = null;
      this.patch({
        status: silent ? 'idle' : 'error',
        error: String(error),
      });
    }
  }

  async installUpdate(): Promise<void> {
    if (!this.pendingUpdate) return;

    this.patch({
      status: 'downloading',
      error: '',
      progressPercent: 0,
      downloadedBytes: 0,
      contentLength: null,
    });

    await this.pendingUpdate.downloadAndInstall((event: DownloadEvent) => {
      if (event.event === 'Started') {
        const contentLength = event.data.contentLength ?? null;
        this.patch({
          status: 'downloading',
          contentLength,
          downloadedBytes: 0,
          progressPercent: contentLength ? 0 : null,
        });
        return;
      }

      if (event.event === 'Progress') {
        const downloadedBytes = this.state.downloadedBytes + event.data.chunkLength;
        const progressPercent = this.state.contentLength && this.state.contentLength > 0
          ? Math.min(100, Math.round((downloadedBytes / this.state.contentLength) * 100))
          : null;
        this.patch({
          status: 'downloading',
          downloadedBytes,
          progressPercent,
        });
        return;
      }

      this.patch({
        status: 'installing',
        progressPercent: 100,
      });
    });

    this.patch({ status: 'completed' });
    if (!isWindows()) {
      try {
        await relaunch();
      } catch {
        // Ignore and keep completed state.
      }
    }
  }
}

function isWindows(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /win/i.test(navigator.userAgent) || /win/i.test((navigator as Navigator).platform || '');
}
