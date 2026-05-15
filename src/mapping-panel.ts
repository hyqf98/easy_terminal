import { onLangChange, t } from './i18n';
import type { CommandMapping } from './types';
import type { CommandIntelligence } from './command-intelligence';

type OverlayState = { type: 'edit'; index: number | null } | null;

export class MappingPanel {
  private container: HTMLDivElement;
  private overlayState: OverlayState = null;
  private draft: CommandMapping | null = null;

  constructor(container: HTMLDivElement, private intelligence: CommandIntelligence) {
    this.container = container;
    this.renderShell();
    this.render();

    this.intelligence.onChange(() => this.render());
    onLangChange(() => {
      this.renderShell();
      this.render();
    });
  }

  private renderShell() {
    this.container.innerHTML = `
      <div class="panel-header">
        <h2>${mappingIcon()} ${t('mapping.title')}</h2>
      </div>
      <div class="panel-body mapping-panel-body"></div>
    `;
  }

  private get body(): HTMLDivElement {
    return this.container.querySelector('.mapping-panel-body') as HTMLDivElement;
  }

  private render() {
    const mappings = this.intelligence.getMappings();
    let html = `
      <div class="cmd-toolbar">
        <button class="cmd-toolbar-btn primary" id="mapping-add">${addIcon()} ${t('mapping.add')}</button>
      </div>
      <div class="mapping-list">
    `;

    if (mappings.length === 0) {
      html += `<div class="cmd-empty">${t('mapping.empty')}</div>`;
    } else {
      html += mappings.map((mapping, index) => `
        <div class="mapping-item" data-mapping-index="${index}">
          <div class="mapping-main">
            <div class="mapping-trigger-row">
              <span class="mapping-trigger">${escapeHtml(mapping.trigger)}</span>
              <span class="cmd-chip ${mapping.enabled ? 'accent' : ''}">${mapping.enabled ? t('mapping.enabled') : t('mapping.disabled')}</span>
              ${mapping.sourceType === 'builtin' ? `<span class="cmd-chip">${t('mapping.sourceBuiltin')}</span>` : ''}
            </div>
            ${mapping.description ? `<div class="mapping-desc">${escapeHtml(mapping.description)}</div>` : ''}
            ${mapping.tags.length ? `<div class="cmd-command-tags">${mapping.tags.map((tag) => `<span class="cmd-tag">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
            <div class="cmd-command-text">${escapeHtml(mapping.command)}</div>
          </div>
          <div class="cmd-command-actions always-visible">
            <button class="cmd-mini-btn" data-mapping-toggle="${index}" title="${t('mapping.toggle')}">${switchIcon()}</button>
            <button class="cmd-mini-btn" data-mapping-edit="${index}" title="${t('cmd.edit')}">${editIcon()}</button>
            ${mapping.sourceType === 'builtin' ? '' : `<button class="cmd-mini-btn" data-mapping-delete="${index}" title="${t('cmd.delete')}">${deleteIcon()}</button>`}
          </div>
        </div>
      `).join('');
    }

    html += '</div>';

    this.body.innerHTML = html;
    this.bindEvents();
    this.renderOverlayInline();
  }

  private renderOverlay(mapping: CommandMapping): string {
    return `
      <div class="cmd-overlay-card mapping-overlay-card">
          <div class="cmd-overlay-title">${this.overlayState?.index === null ? t('mapping.modalTitle') : t('mapping.edit')}</div>
          <label class="cmd-field">
            <span>${t('mapping.trigger')}</span>
            <input id="mapping-trigger" type="text" value="${escapeHtml(mapping.trigger)}" placeholder="去工作路径">
          </label>
          <label class="cmd-field">
            <span>${t('cmd.command')}</span>
            <textarea id="mapping-command" rows="4" placeholder="cd /work/project&#10;支持 [%s:参数名] 占位符自动跳转光标">${escapeHtml(mapping.command)}</textarea>
          </label>
          <label class="cmd-field">
            <span>${t('cmd.description')}</span>
            <input id="mapping-description" type="text" value="${escapeHtml(mapping.description)}" placeholder="${t('mapping.descriptionPlaceholder')}">
          </label>
          <label class="cmd-field">
            <span>${t('cmd.tags')}</span>
            <input id="mapping-tags" type="text" value="${escapeHtml(mapping.tags.join(', '))}" placeholder="工作路径, workspace">
          </label>
          <label class="cmd-field">
            <span>${t('mapping.platforms')}</span>
            <input id="mapping-platforms" type="text" value="${escapeHtml((mapping.platforms || []).join(', '))}" placeholder="darwin, linux, windows">
          </label>
          <label class="cmd-field">
            <span>${t('cmd.examples')}</span>
            <textarea id="mapping-examples" rows="3" placeholder="去工作路径&#10;去项目目录">${escapeHtml(mapping.examples.join('\n'))}</textarea>
          </label>
          <label class="mapping-toggle-row">
            <input id="mapping-enabled" type="checkbox" ${mapping.enabled ? 'checked' : ''}>
            <span>${t('mapping.enabled')}</span>
          </label>
          <div class="cmd-overlay-actions">
            <button class="cmd-toolbar-btn primary" id="mapping-save">${t('cmd.save')}</button>
            <button class="cmd-toolbar-btn" id="mapping-cancel">${t('cmd.cancel')}</button>
          </div>
        </div>
    `;
  }

  private renderOverlayInline() {
    const existing = this.container.querySelector(':scope > .cmd-overlay-inline');
    if (existing) existing.remove();

    if (!this.overlayState) return;

    const mapping = this.draft || this.intelligence.getMappings()[this.overlayState.index ?? -1] || emptyMapping();
    const overlay = document.createElement('div');
    overlay.className = 'cmd-overlay-inline';
    overlay.innerHTML = this.renderOverlay(mapping);
    this.container.appendChild(overlay);
    this.bindOverlayEvents(overlay);
  }

  private bindOverlayEvents(overlay: HTMLElement) {
    overlay.querySelector('#mapping-save')?.addEventListener('click', async () => {
      await this.saveMapping(overlay);
    });
    overlay.querySelector('#mapping-cancel')?.addEventListener('click', () => {
      this.overlayState = null;
      this.draft = null;
      this.renderOverlayInline();
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this.overlayState = null;
        this.draft = null;
        this.renderOverlayInline();
      }
    });
  }

  private async saveMapping(overlay?: HTMLElement) {
    const root = overlay || this.container.querySelector('.cmd-overlay-inline');
    if (!root) return;

    const trigger = (root.querySelector('#mapping-trigger') as HTMLInputElement | null)?.value.trim() || '';
    const command = (root.querySelector('#mapping-command') as HTMLTextAreaElement | null)?.value.trim() || '';
    const description = (root.querySelector('#mapping-description') as HTMLInputElement | null)?.value.trim() || '';
    const tags = ((root.querySelector('#mapping-tags') as HTMLInputElement | null)?.value.trim() || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const platforms = ((root.querySelector('#mapping-platforms') as HTMLInputElement | null)?.value.trim() || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const examples = ((root.querySelector('#mapping-examples') as HTMLTextAreaElement | null)?.value.trim() || '')
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean);
    const enabled = (root.querySelector('#mapping-enabled') as HTMLInputElement | null)?.checked ?? true;

    if (!trigger || !command) {
      alert(t('mapping.required'));
      return;
    }

    const entries = [...this.intelligence.getMappings()];
    const entry: CommandMapping = {
      id: this.overlayState?.index === null ? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` : entries[this.overlayState?.index ?? 0]?.id || '',
      trigger,
      command,
      description,
      tags,
      platforms,
      examples,
      enabled,
      sourceType: this.overlayState?.index === null
        ? 'user'
        : entries[this.overlayState?.index ?? 0]?.sourceType || 'user',
    };

    if (this.overlayState?.index === null) {
      entries.unshift(entry);
    } else {
      const index = this.overlayState?.index ?? 0;
      entries[index] = entry;
    }

    await this.intelligence.saveMappings(entries);
    this.overlayState = null;
    this.draft = null;
    this.render();
  }

  private bindEvents() {
    this.body.querySelector('#mapping-add')?.addEventListener('click', () => {
      this.overlayState = { type: 'edit', index: null };
      this.draft = null;
      this.render();
    });

    this.body.querySelectorAll<HTMLElement>('[data-mapping-edit]').forEach((button) => {
      button.addEventListener('click', () => {
        this.overlayState = { type: 'edit', index: Number(button.dataset.mappingEdit) };
        this.draft = null;
        this.render();
      });
    });

    this.body.querySelectorAll<HTMLElement>('[data-mapping-delete]').forEach((button) => {
      button.addEventListener('click', async () => {
        const index = Number(button.dataset.mappingDelete);
        const next = [...this.intelligence.getMappings()];
        next.splice(index, 1);
        await this.intelligence.saveMappings(next);
      });
    });

    this.body.querySelectorAll<HTMLElement>('[data-mapping-toggle]').forEach((button) => {
      button.addEventListener('click', async () => {
        const index = Number(button.dataset.mappingToggle);
        const next = [...this.intelligence.getMappings()];
        const mapping = next[index];
        if (!mapping) return;
        next[index] = { ...mapping, enabled: !mapping.enabled };
        await this.intelligence.saveMappings(next);
      });
    });

  }

  openCreate(prefill?: Partial<CommandMapping>) {
    this.overlayState = { type: 'edit', index: null };
    this.draft = {
      ...emptyMapping(),
      ...prefill,
      id: '',
      tags: [...(prefill?.tags || [])],
      platforms: [...(prefill?.platforms || [])],
      examples: [...(prefill?.examples || [])],
    };
    this.render();
  }
}

function emptyMapping(): CommandMapping {
  return {
    id: '',
    trigger: '',
    command: '',
    description: '',
    tags: [],
    platforms: [],
    examples: [],
    hint: '',
    enabled: true,
    sourceType: 'user',
  };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function mappingIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M8 3H5a2 2 0 0 0-2 2v3"></path><path d="M16 3h3a2 2 0 0 1 2 2v3"></path><path d="M8 21H5a2 2 0 0 1-2-2v-3"></path><path d="M16 21h3a2 2 0 0 0 2-2v-3"></path><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>`;
}

function addIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
}

function switchIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><circle cx="9" cy="12" r="3"></circle><path d="M3 12h12"></path><path d="M15 9h2a4 4 0 1 1 0 8H9"></path></svg>`;
}

function editIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`;
}

function deleteIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
}
