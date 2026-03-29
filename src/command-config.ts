import { invoke } from '@tauri-apps/api/core';
import type { CommandEntry } from './command-suggest';

interface CommandConfig {
  platform: string;
  commands: CommandEntry[];
}

export class CommandConfigPanel {
  private container: HTMLDivElement;
  private configs: CommandConfig[] = [];
  private currentPlatform = '';
  private editorOverlay: HTMLDivElement | null = null;

  constructor(container: HTMLDivElement) {
    this.container = container;
    this.container.innerHTML = `
      <div class="panel-header">
        <h2>${commandIcon()} 命令配置</h2>
      </div>
      <div class="panel-body cmd-panel-body"></div>
    `;
    this.init();
  }

  private get body(): HTMLDivElement {
    return this.container.querySelector('.cmd-panel-body') as HTMLDivElement;
  }

  private async init() {
    try {
      this.currentPlatform = await invoke<string>('get_platform');
      this.configs = await invoke<CommandConfig[]>('load_commands');
    } catch {
      this.configs = [];
    }
    this.render();
  }

  private render() {
    const totalCommands = this.configs.reduce((sum, c) => sum + c.commands.length, 0);

    let html = `
      <div class="cmd-summary">
        已加载 <code>${totalCommands}</code> 条命令
      </div>
      <div class="cmd-file-list">
    `;

    for (const config of this.configs) {
      const isCurrent = config.platform === this.currentPlatform;
      html += `
        <div class="cmd-file-item${isCurrent ? ' current' : ''}" data-platform="${escapeHtml(config.platform)}">
          <div class="cmd-file-info">
            <span class="cmd-file-platform-icon">${platformIcon(config.platform)}</span>
            <span class="cmd-file-name">${escapeHtml(config.platform)}.json</span>
            ${isCurrent ? '<span class="cmd-file-badge">当前</span>' : ''}
          </div>
          <span class="cmd-file-count">${config.commands.length} 条</span>
        </div>
      `;
    }

    html += `</div>`;

    // Import section
    html += `
      <div class="cmd-import-section">
        <button class="cmd-import-btn" id="cmd-import-btn">
          ${uploadIcon()} 导入 JSON 文件
        </button>
        <div class="cmd-import-hint">
          格式：{"platform":"windows","commands":[{name,alias,description,usage,category}]}
        </div>
      </div>
    `;

    this.body.innerHTML = html;
    this.bindEvents();
  }

  private bindEvents() {
    // File item click -> open editor
    this.body.querySelectorAll('.cmd-file-item').forEach((el) => {
      el.addEventListener('click', () => {
        const platform = (el as HTMLElement).dataset.platform!;
        this.openEditor(platform);
      });
    });

    this.body.querySelector('#cmd-import-btn')?.addEventListener('click', () => this.importFile());
  }

  private async openEditor(platform: string) {
    const config = this.configs.find(c => c.platform === platform);
    if (!config) return;

    // Close existing editor if any
    this.closeEditor();

    const viewport = document.getElementById('app-viewport')!;
    const overlay = document.createElement('div');
    overlay.className = 'json-editor-overlay';
    overlay.innerHTML = `
      <div class="json-editor-container">
        <div class="json-editor-header">
          <div class="json-editor-title">
            <span class="cmd-file-platform-icon">${platformIcon(platform)}</span>
            <span>${escapeHtml(platform)}.json</span>
            <span class="json-editor-count">${config.commands.length} 条命令</span>
          </div>
          <div class="json-editor-actions">
            <button class="json-editor-format-btn" title="格式化">
              ${formatIcon()} 格式化
            </button>
            <button class="json-editor-save-btn" title="保存">
              ${saveIcon()} 保存
            </button>
            <button class="json-editor-close-btn" title="关闭">
              ${closeIcon()}
            </button>
          </div>
        </div>
        <div class="json-editor-body">
          <textarea class="json-editor-textarea" spellcheck="false">${escapeHtml(JSON.stringify(config, null, 2))}</textarea>
        </div>
      </div>
    `;

    viewport.appendChild(overlay);
    this.editorOverlay = overlay;

    // Auto-format on open
    const textarea = overlay.querySelector('.json-editor-textarea') as HTMLTextAreaElement;
    this.formatJson(textarea);

    // Bind editor events
    overlay.querySelector('.json-editor-close-btn')!.addEventListener('click', () => {
      this.closeEditor();
    });

    overlay.querySelector('.json-editor-format-btn')!.addEventListener('click', () => {
      this.formatJson(textarea);
    });

    overlay.querySelector('.json-editor-save-btn')!.addEventListener('click', async () => {
      await this.saveEditor(platform, textarea);
    });

    // Ctrl+S to save
    textarea.addEventListener('keydown', async (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        await this.saveEditor(platform, textarea);
      }
      if (e.key === 'Escape') {
        this.closeEditor();
      }
    });

    // Tab key inserts spaces
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      }
    });

    textarea.focus();
  }

  private formatJson(textarea: HTMLTextAreaElement) {
    try {
      const parsed = JSON.parse(textarea.value);
      textarea.value = JSON.stringify(parsed, null, 2);
      textarea.dataset.error = '';
      textarea.classList.remove('json-error');
    } catch (e) {
      textarea.dataset.error = (e as Error).message;
      textarea.classList.add('json-error');
    }
  }

  private async saveEditor(_platform: string, textarea: HTMLTextAreaElement) {
    try {
      const config: CommandConfig = JSON.parse(textarea.value);
      if (!config.platform || !Array.isArray(config.commands)) {
        throw new Error('JSON 格式不正确，需要 platform 和 commands 字段');
      }
      // Format before save
      textarea.value = JSON.stringify(config, null, 2);
      textarea.classList.remove('json-error');

      await invoke('save_commands', { config });
      // Reload configs
      this.configs = await invoke<CommandConfig[]>('load_commands');
      this.render();

      // Update editor count display
      const countEl = this.editorOverlay?.querySelector('.json-editor-count');
      if (countEl) {
        countEl.textContent = `${config.commands.length} 条命令`;
      }
    } catch (e) {
      textarea.classList.add('json-error');
      alert('保存失败: ' + e);
    }
  }

  private closeEditor() {
    if (this.editorOverlay) {
      this.editorOverlay.remove();
      this.editorOverlay = null;
    }
  }

  private async importFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const config: CommandConfig = JSON.parse(text);
        if (!config.platform || !Array.isArray(config.commands)) {
          throw new Error('JSON 格式不正确，需要 platform 和 commands 字段');
        }
        await invoke('save_commands', { config });
        this.configs = await invoke<CommandConfig[]>('load_commands');
        this.render();
      } catch (e) { alert('导入失败: ' + e); }
    });
    input.click();
  }
}

// ===== SVG Icons =====
function commandIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>`;
}

function platformIcon(platform: string): string {
  const icons: Record<string, string> = {
    windows: `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/></svg>`,
    linux: `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M12.504 0c-.155 0-.311.015-.466.04C10.577.276 9.592 1.328 9.17 2.72c-.422 1.392-.298 2.743.326 3.79.308.518.57 1.066.767 1.648.359 1.06.057 2.234-.742 3.118-.8.884-1.7 1.896-2.267 3.092-.567 1.196-.807 2.588-.466 4.03.34 1.44 1.248 2.887 2.95 4.055 1.702 1.168 3.372 1.597 4.892 1.514 1.52-.083 2.882-.687 3.964-1.838 1.082-1.15 1.558-2.586 1.623-4.052.065-1.466-.285-2.966-.998-4.197-.713-1.23-1.816-2.187-3.21-2.6-.57-.168-1.089-.478-1.516-.913-.427-.436-.748-.99-.906-1.62-.158-.63-.146-1.306.039-1.96.37-1.307.435-2.473.15-3.45C13.14.878 12.916.478 12.504 0z"/></svg>`,
    darwin: `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>`,
  };
  return icons[platform] || `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/></svg>`;
}

function uploadIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>`;
}

function saveIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>`;
}

function formatIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><line x1="21" y1="10" x2="3" y2="10"></line><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="14" x2="3" y2="14"></line><line x1="21" y1="18" x2="3" y2="18"></line></svg>`;
}

function closeIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
