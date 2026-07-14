/**
 * ClipboardManager — 文件剪贴板管理
 *
 * 管理文件复制/剪切状态，支持 Ctrl+C / Ctrl+X / Ctrl+V 操作。
 * 剪贴板内容在应用生命周期内有效（不跨应用）。
 */

export type ClipboardMode = 'copy' | 'cut' | null;

class FileClipboardManager {
  paths: string[] = [];
  mode: ClipboardMode = null;
  private listeners: Set<() => void> = new Set();

  get isEmpty(): boolean {
    return this.paths.length === 0;
  }

  copy(paths: string[]): void {
    this.paths = [...paths];
    this.mode = 'copy';
    this.notify();
  }

  cut(paths: string[]): void {
    this.paths = [...paths];
    this.mode = 'cut';
    this.notify();
  }

  consume(): { paths: string[]; mode: ClipboardMode } {
    const result = { paths: [...this.paths], mode: this.mode };
    if (this.mode === 'cut') {
      this.clear();
    }
    return result;
  }

  clear(): void {
    this.paths = [];
    this.mode = null;
    this.notify();
  }

  isCut(path: string): boolean {
    return this.mode === 'cut' && this.paths.includes(path);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    this.listeners.forEach((fn) => fn());
  }
}

export const fileClipboard = new FileClipboardManager();
