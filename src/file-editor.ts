import { invoke } from '@tauri-apps/api/core';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection, crosshairCursor } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter, indentOnInput, foldKeymap } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { javascript } from '@codemirror/lang-javascript';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { markdown } from '@codemirror/lang-markdown';
import { yaml } from '@codemirror/lang-yaml';
import { java } from '@codemirror/lang-java';
import { xml } from '@codemirror/lang-xml';
import { sql } from '@codemirror/lang-sql';
import { php } from '@codemirror/lang-php';
import { oneDark } from '@codemirror/theme-one-dark';
import { linter } from '@codemirror/lint';
import { StreamLanguage } from '@codemirror/language';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import type { Extension } from '@codemirror/state';
import type { FilePreviewData, SSHProfile } from './types';
import type { ViewUpdate } from '@codemirror/view';

interface EditorOptions {
  path: string;
  language: string;
  content: string;
  truncated: boolean;
  size: number;
  readOnly?: boolean;
  commandLine?: string;
  remote?: {
    profile: SSHProfile;
    profiles: SSHProfile[];
  };
  onSave?: () => void;
}

let activeEditor: { overlay: HTMLDivElement; view: EditorView; keyHandler: (e: KeyboardEvent) => void } | null = null;

function getLanguageExtension(lang: string): Extension[] {
  switch (lang) {
    case 'json': return [json(), linter(jsonParseLinter())];
    case 'typescript': return [javascript({ typescript: true })];
    case 'javascript': return [javascript()];
    case 'css': return [css()];
    case 'html': return [html()];
    case 'python': return [python()];
    case 'rust': return [rust()];
    case 'markdown': return [markdown()];
    case 'yaml': return [yaml()];
    case 'java': return [java()];
    case 'xml': return [xml()];
    case 'sql': return [sql()];
    case 'php': return [php()];
    case 'shell': return [StreamLanguage.define(shell)];
    case 'toml': return [StreamLanguage.define(toml)];
    case 'powershell': return [StreamLanguage.define(powerShell)];
    default: return [];
  }
}

function baseExtensions(readOnly: boolean) {
  const exts: any[] = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    history(),
    foldGutter(),
    drawSelection(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    rectangularSelection(),
    crosshairCursor(),
    highlightSelectionMatches(),
    EditorView.lineWrapping,
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      indentWithTab,
    ]),
  ];
  if (readOnly) {
    exts.push(EditorState.readOnly.of(true));
    exts.push(EditorView.editable.of(false));
  }
  return exts;
}

function getTheme(): string {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}

function getFontSize(): number {
  const s = localStorage.getItem('terminal-font-size');
  return s ? parseInt(s, 10) : 14;
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

export function openFileEditor(options: EditorOptions): void {
  closeFileEditor();

  const { path, language, content, truncated, size, readOnly, commandLine, remote } = options;
  const isDark = getTheme() !== 'light';
  const fontSize = getFontSize();
  const isRemote = !!remote;
  const canEdit = !readOnly && !truncated;

  const overlay = document.createElement('div');
  overlay.className = 'file-preview-overlay';

  const statusText = truncated
    ? '只读 (文件过大)'
    : isRemote
      ? '远程文件'
      : readOnly
        ? '只读'
        : '已加载';

  const langLabel = language.toUpperCase();
  const sizeLabel = size > 1024 * 1024
    ? `${(size / 1024 / 1024).toFixed(1)} MB`
    : size > 1024
      ? `${(size / 1024).toFixed(1)} KB`
      : `${size} B`;

  overlay.innerHTML = `
    <div class="file-preview-card file-editor-card">
      <div class="file-preview-header">
        <div class="file-preview-header-main">
          <div class="file-preview-title">${escapeHtml(fileName(path))}</div>
          <div class="file-preview-meta">${escapeHtml(path)}</div>
        </div>
        <div class="file-preview-actions">
          <span class="cmd-chip">${escapeHtml(langLabel)}</span>
          <span class="cmd-chip" style="opacity:0.7">${escapeHtml(sizeLabel)}</span>
          <span class="cmd-chip" style="opacity:0.7">${escapeHtml(statusText)}</span>
          ${canEdit ? '<button class="file-editor-save-btn" data-editor-save>保存</button>' : ''}
          <button class="cmd-toolbar-btn" data-editor-close>关闭</button>
        </div>
      </div>
      ${commandLine ? `<div class="file-preview-command">${escapeHtml(commandLine)}</div>` : ''}
      ${truncated ? '<div class="file-preview-warning">文件较大，当前仅显示前 2 MB 内容，编辑功能已禁用。</div>' : ''}
      <div class="file-editor-body"></div>
      <div class="file-editor-statusbar">
        <span class="file-editor-status-item" data-status-mode>${escapeHtml(langLabel)}</span>
        <span class="file-editor-status-item" data-status-lines>行: 0</span>
        <span class="file-editor-status-item" data-status-cursor>行 1, 列 1</span>
        ${isRemote ? '<span class="file-editor-status-item">远程</span>' : ''}
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const editorBody = overlay.querySelector('.file-editor-body') as HTMLDivElement;

  const extensions = [
    ...baseExtensions(!canEdit),
    ...getLanguageExtension(language),
    isDark ? oneDark : [],
    EditorView.theme({
      '&': { height: '100%', fontSize: `${fontSize}px` },
      '.cm-scroller': { fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, monospace', lineHeight: '1.6' },
      '.cm-gutters': { fontSize: `${fontSize}px` },
    }),
    EditorView.updateListener.of((update: ViewUpdate) => {
      if (update.selectionSet || update.docChanged) {
        const pos = update.state.selection.main.head;
        const line = update.state.doc.lineAt(pos);
        const linesEl = overlay.querySelector('[data-status-lines]');
        const cursorEl = overlay.querySelector('[data-status-cursor]');
        if (linesEl) linesEl.textContent = `行: ${update.state.doc.lines}`;
        if (cursorEl) cursorEl.textContent = `行 ${line.number}, 列 ${pos - line.from + 1}`;
      }
    }),
  ];

  if (canEdit) {
    extensions.push(
      keymap.of([{
        key: 'Mod-s',
        run: () => { saveFile(); return true; },
      }])
    );
  }

  let currentContent = content;
  const view = new EditorView({
    state: EditorState.create({ doc: content, extensions }),
    parent: editorBody,
  });

  const saveFile = async () => {
    const saveBtn = overlay.querySelector('[data-editor-save]') as HTMLButtonElement;
    if (!saveBtn) return;
    const newContent = view.state.doc.toString();
    if (newContent === currentContent) return;

    saveBtn.textContent = '保存中...';
    saveBtn.disabled = true;

    try {
      if (remote) {
        await invoke('write_remote_file', {
          profile: remote.profile,
          path,
          content: newContent,
          profiles: remote.profiles,
        });
      } else {
        await invoke('write_text_file', { path, content: newContent });
      }
      currentContent = newContent;
      saveBtn.textContent = '已保存';
      setTimeout(() => {
        if (saveBtn.isConnected) {
          saveBtn.textContent = '保存';
          saveBtn.disabled = false;
        }
      }, 1500);
      options.onSave?.();
    } catch (err) {
      console.error('Save error:', err);
      saveBtn.textContent = '保存失败';
      saveBtn.disabled = false;
      setTimeout(() => {
        if (saveBtn.isConnected) {
          saveBtn.textContent = '保存';
        }
      }, 2000);
    }
  };

  const handleSaveClick = (e: Event) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-editor-save]')) {
      e.stopPropagation();
      saveFile();
    }
  };

  const handleClose = (e: Event) => {
    const target = e.target as HTMLElement;
    if (target === overlay || target.closest('[data-editor-close]')) {
      closeFileEditor();
    }
  };

  overlay.addEventListener('click', handleClose);
  overlay.addEventListener('click', handleSaveClick);

  const keyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeFileEditor();
    }
  };
  document.addEventListener('keydown', keyHandler, true);

  const linesEl = overlay.querySelector('[data-status-lines]');
  if (linesEl) linesEl.textContent = `行: ${view.state.doc.lines}`;

  activeEditor = { overlay, view, keyHandler };
}

export function closeFileEditor(): void {
  if (!activeEditor) return;
  activeEditor.view.destroy();
  document.removeEventListener('keydown', activeEditor.keyHandler, true);
  activeEditor.overlay.remove();
  activeEditor = null;
}

export async function openLocalFileEditor(path: string, commandLine?: string): Promise<void> {
  try {
    const preview = await invoke<FilePreviewData>('read_file_preview', { path });
    openFileEditor({
      path: preview.path,
      language: preview.language,
      content: preview.content,
      truncated: preview.truncated,
      size: preview.size,
      commandLine,
    });
  } catch (err) {
    console.error('openLocalFileEditor error', err);
  }
}

export async function openRemoteFileEditor(
  path: string,
  profile: SSHProfile,
  profiles: SSHProfile[],
  commandLine?: string,
): Promise<void> {
  try {
    const preview = await invoke<FilePreviewData>('read_remote_file', {
      profile,
      path,
      profiles,
    });
    openFileEditor({
      path: preview.path,
      language: preview.language,
      content: preview.content,
      truncated: preview.truncated,
      size: preview.size,
      commandLine,
      remote: { profile, profiles },
    });
  } catch (err) {
    console.error('openRemoteFileEditor error', err);
  }
}
