import { invoke } from '@tauri-apps/api/core';
import type { FilePreviewData } from './types';

let activePreview: HTMLDivElement | null = null;

export async function openFilePreview(path: string, commandLine: string): Promise<boolean> {
  try {
    const preview = await invoke<FilePreviewData>('read_file_preview', { path });
    renderPreview(preview, commandLine);
    return true;
  } catch (error) {
    console.error('read_file_preview error', error);
    return false;
  }
}

function renderPreview(preview: FilePreviewData, commandLine: string) {
  closeFilePreview();

  const overlay = document.createElement('div');
  overlay.className = 'file-preview-overlay';
  overlay.innerHTML = `
    <div class="file-preview-card">
      <div class="file-preview-header">
        <div class="file-preview-header-main">
          <div class="file-preview-title">${escapeHtml(fileName(preview.path))}</div>
          <div class="file-preview-meta">${escapeHtml(preview.path)}</div>
        </div>
        <div class="file-preview-actions">
          <span class="cmd-chip">${escapeHtml(preview.language.toUpperCase())}</span>
          <button class="cmd-toolbar-btn" data-preview-close>关闭</button>
        </div>
      </div>
      <div class="file-preview-command">${escapeHtml(commandLine)}</div>
      ${preview.truncated ? '<div class="file-preview-warning">文件较大，当前仅显示前 1 MB 内容。</div>' : ''}
      <div class="file-preview-body">
        <pre class="file-preview-code"><code>${formatCode(preview)}</code></pre>
      </div>
    </div>
  `;

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay || (event.target as HTMLElement).closest('[data-preview-close]')) {
      closeFilePreview();
    }
  });

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeFilePreview();
    }
  };
  document.addEventListener('keydown', onKeydown, true);
  overlay.dataset.keyHandler = 'true';
  (overlay as HTMLDivElement & { __onKeydown?: (event: KeyboardEvent) => void }).__onKeydown = onKeydown;

  document.body.appendChild(overlay);
  activePreview = overlay;
}

export function closeFilePreview() {
  if (!activePreview) return;
  const handler = (activePreview as HTMLDivElement & { __onKeydown?: (event: KeyboardEvent) => void }).__onKeydown;
  if (handler) {
    document.removeEventListener('keydown', handler, true);
  }
  activePreview.remove();
  activePreview = null;
}

function formatCode(preview: FilePreviewData): string {
  if (preview.language === 'json') {
    try {
      return escapeHtml(JSON.stringify(JSON.parse(preview.content), null, 2));
    } catch {
      return escapeHtml(preview.content);
    }
  }
  return escapeHtml(preview.content);
}

function fileName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
