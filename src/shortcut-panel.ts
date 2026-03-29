import { onLangChange, t } from './i18n';
import { formatShortcutFromEvent, type ShortcutManager } from './shortcut-manager';
import type { ShortcutBinding } from './types';

type ShortcutField = 'windows' | 'darwin' | 'linux';

export class ShortcutPanel {
  private container: HTMLDivElement;
  private draftBindings: ShortcutBinding[] = [];
  private recording: { bindingId: string; field: ShortcutField } | null = null;
  private recorderKeydown = (event: KeyboardEvent) => this.handleRecorderKeydown(event);

  constructor(container: HTMLDivElement, private shortcuts: ShortcutManager) {
    this.container = container;
    this.renderShell();
    this.draftBindings = this.shortcuts.getBindings();
    this.render();

    this.shortcuts.onChange((bindings) => {
      this.stopRecording(false);
      this.draftBindings = bindings;
      this.render();
    });
    onLangChange(() => {
      this.renderShell();
      this.render();
    });
  }

  private renderShell() {
    this.container.innerHTML = `
      <div class="panel-header">
        <h2>${shortcutIcon()} ${t('shortcut.title')}</h2>
      </div>
      <div class="panel-body shortcut-panel-body"></div>
    `;
  }

  private get body(): HTMLDivElement {
    return this.container.querySelector('.shortcut-panel-body') as HTMLDivElement;
  }

  private render() {
    this.body.innerHTML = `
      <div class="shortcut-summary">
        ${t('shortcut.summary', this.platformLabel())}
        <span class="shortcut-summary-note">点击录制后直接按下组合键，按 <code>Delete</code> 清空，按 <code>Esc</code> 取消。</span>
      </div>
      <div class="shortcut-list">
        ${this.draftBindings.map((binding) => this.renderItem(binding)).join('')}
      </div>
      <div class="cmd-overlay-actions shortcut-actions">
        <button class="cmd-toolbar-btn primary" id="shortcut-save">${t('cmd.save')}</button>
      </div>
    `;
    this.bindEvents();
  }

  private renderItem(binding: ShortcutBinding): string {
    return `
      <div class="shortcut-item" data-shortcut-id="${escapeHtml(binding.id)}">
        <div class="shortcut-item-head">
          <div class="shortcut-item-title">${escapeHtml(binding.label)}</div>
          <div class="shortcut-item-desc">${escapeHtml(binding.description)}</div>
        </div>
        <div class="shortcut-grid">
          ${this.renderField(binding, 'windows', 'Windows', 'Ctrl+C')}
          ${this.renderField(binding, 'darwin', 'macOS', 'Cmd+C')}
          ${this.renderField(binding, 'linux', 'Linux', 'Ctrl+C')}
        </div>
      </div>
    `;
  }

  private renderField(binding: ShortcutBinding, field: ShortcutField, label: string, placeholder: string): string {
    const isRecording = this.recording?.bindingId === binding.id && this.recording.field === field;
    const isCurrent = this.shortcuts.getPlatform() === platformToOs(field);
    const value = binding[field];
    return `
      <div class="shortcut-field-card${isRecording ? ' recording' : ''}${isCurrent ? ' current' : ''}" data-shortcut-card="${field}">
        <div class="shortcut-field-head">
          <span>${label}</span>
          ${isCurrent ? '<em>当前平台</em>' : ''}
        </div>
        <input
          class="shortcut-input-display${isRecording ? ' recording' : ''}"
          data-shortcut-field="${field}"
          type="text"
          readonly
          value="${escapeHtml(isRecording ? '按下快捷键组合...' : value)}"
          placeholder="${placeholder}"
        >
        <div class="shortcut-field-actions">
          <button class="cmd-toolbar-btn" type="button" data-shortcut-record="${field}">
            ${isRecording ? '录制中' : '录制'}
          </button>
          <button class="cmd-toolbar-btn" type="button" data-shortcut-clear="${field}">清空</button>
        </div>
      </div>
    `;
  }

  private bindEvents() {
    this.body.querySelector('#shortcut-save')?.addEventListener('click', async () => {
      this.stopRecording(false);
      await this.shortcuts.saveBindings(this.draftBindings.map((binding) => ({ ...binding })));
    });

    this.body.querySelectorAll<HTMLElement>('[data-shortcut-record]').forEach((button) => {
      button.addEventListener('click', () => {
        const root = button.closest<HTMLElement>('[data-shortcut-id]');
        const field = button.dataset.shortcutRecord as ShortcutField | undefined;
        const bindingId = root?.dataset.shortcutId;
        if (!bindingId || !field) return;

        if (this.recording?.bindingId === bindingId && this.recording.field === field) {
          this.stopRecording();
          return;
        }
        this.startRecording(bindingId, field);
      });
    });

    this.body.querySelectorAll<HTMLElement>('[data-shortcut-clear]').forEach((button) => {
      button.addEventListener('click', () => {
        const root = button.closest<HTMLElement>('[data-shortcut-id]');
        const field = button.dataset.shortcutClear as ShortcutField | undefined;
        const bindingId = root?.dataset.shortcutId;
        if (!bindingId || !field) return;
        this.updateDraftValue(bindingId, field, '');
        if (this.recording?.bindingId === bindingId && this.recording.field === field) {
          this.stopRecording(false);
        }
        this.render();
      });
    });
  }

  private startRecording(bindingId: string, field: ShortcutField) {
    this.stopRecording(false);
    this.recording = { bindingId, field };
    document.addEventListener('keydown', this.recorderKeydown, true);
    this.render();
  }

  private stopRecording(shouldRender = true) {
    document.removeEventListener('keydown', this.recorderKeydown, true);
    this.recording = null;
    if (shouldRender) {
      this.render();
    }
  }

  private handleRecorderKeydown(event: KeyboardEvent) {
    if (!this.recording) return;

    event.preventDefault();
    event.stopPropagation();

    const hasModifier = event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;
    if (event.key === 'Escape' && !hasModifier) {
      this.stopRecording();
      return;
    }

    if ((event.key === 'Backspace' || event.key === 'Delete') && !hasModifier) {
      this.updateDraftValue(this.recording.bindingId, this.recording.field, '');
      this.stopRecording();
      return;
    }

    const formatted = formatShortcutFromEvent(event);
    if (!formatted) {
      return;
    }

    this.updateDraftValue(this.recording.bindingId, this.recording.field, formatted);
    this.stopRecording();
  }

  private updateDraftValue(bindingId: string, field: ShortcutField, value: string) {
    this.draftBindings = this.draftBindings.map((binding) => {
      if (binding.id !== bindingId) return binding;
      return {
        ...binding,
        [field]: value,
      };
    });
  }

  private platformLabel(): string {
    const platform = this.shortcuts.getPlatform();
    if (platform === 'darwin') return 'macOS';
    if (platform === 'linux') return 'Linux';
    return 'Windows';
  }
}

function platformToOs(field: ShortcutField): 'windows' | 'darwin' | 'linux' {
  if (field === 'darwin') return 'darwin';
  if (field === 'linux') return 'linux';
  return 'windows';
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function shortcutIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M10 8h10"></path><path d="M4 8h2"></path><path d="M4 16h16"></path><path d="M8 12h8"></path></svg>`;
}
