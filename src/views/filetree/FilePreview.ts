import { invoke } from '@tauri-apps/api/core';
import type { FilePreviewData } from '../../types';

let activePreview: HTMLDivElement | null = null;
let activeKeyHandler: ((event: KeyboardEvent) => void) | null = null;

/**
 * 打开文件预览。
 * - 不传 container：以全屏 overlay 弹层形式展示（旧调用方兼容）。
 * - 传入 container：以内联形式渲染进容器，由调用方负责清空与关闭。
 */
export async function openFilePreview(
  path: string,
  commandLine: string,
  container?: HTMLElement
): Promise<boolean> {
  try {
    const preview = await invoke<FilePreviewData>('read_file_preview', { path });
    renderPreview(preview, commandLine, container);
    return true;
  } catch (error) {
    console.error('read_file_preview error', error);
    return false;
  }
}

function renderPreview(preview: FilePreviewData, commandLine: string, container?: HTMLElement) {
  // 内联模式直接渲染进容器；overlay 模式先关闭旧弹层
  if (container) {
    container.innerHTML = '';
    const card = buildPreviewCard(preview, commandLine, false);
    container.appendChild(card);
    return;
  }

  closeFilePreview();

  const overlay = document.createElement('div');
  overlay.className = 'file-preview-overlay';
  const card = buildPreviewCard(preview, commandLine, true);
  overlay.appendChild(card);

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
  activeKeyHandler = onKeydown;

  document.body.appendChild(overlay);
  activePreview = overlay;
}

function buildPreviewCard(preview: FilePreviewData, commandLine: string, withClose: boolean): HTMLDivElement {
  const card = document.createElement('div');
  card.className = withClose ? 'file-preview-card' : 'file-preview-card file-preview-inline';
  card.innerHTML = `
    <div class="file-preview-header">
      <div class="file-preview-header-main">
        <div class="file-preview-title">${escapeHtml(fileName(preview.path))}</div>
        <div class="file-preview-meta">${escapeHtml(preview.path)}</div>
      </div>
      <div class="file-preview-actions">
        <span class="cmd-chip">${escapeHtml(preview.language.toUpperCase())}</span>
        ${withClose ? '<button class="cmd-toolbar-btn" data-preview-close>关闭</button>' : ''}
      </div>
    </div>
    ${commandLine ? `<div class="file-preview-command">${escapeHtml(commandLine)}</div>` : ''}
    ${preview.truncated ? '<div class="file-preview-warning">文件较大，当前仅显示前 1 MB 内容。</div>' : ''}
    <div class="file-preview-body">
      <pre class="file-preview-code"><code>${formatCode(preview)}</code></pre>
    </div>
  `;
  return card;
}

export function closeFilePreview() {
  if (!activePreview) return;
  if (activeKeyHandler) {
    document.removeEventListener('keydown', activeKeyHandler, true);
    activeKeyHandler = null;
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
