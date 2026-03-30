import { invoke } from '@tauri-apps/api/core';
import { onLangChange, t } from './i18n';
import type { CommandConfig, CommandEntry } from './types';
import { normalizeCommandEntry } from './command-intelligence';

type OverlayState =
  | { type: 'category'; id: string; label: string }
  | { type: 'command'; categoryId: string; index: number | null };

interface CategoryView {
  id: string;
  title: string;
  subtitle: string;
  kind: 'system' | 'custom';
  source: 'system' | 'builtin' | 'user';
  commands: CommandEntry[];
  current: boolean;
  canAdd: boolean;
  canDelete: boolean;
}

const BUILTIN_LIBRARY_IDS = new Set(['java', 'python', 'conda', 'npm', 'docker', 'rust']);

export class CommandConfigPanel {
  private container: HTMLDivElement;
  private configs: CommandConfig[] = [];
  private currentPlatforms: string[] = [];
  private overlayState: OverlayState | null = null;
  private commandContext: HTMLDivElement | null = null;
  private activeCategoryId = '';

  constructor(
    container: HTMLDivElement,
    private sendToTerminal: (command: string) => Promise<boolean>,
    private onLibraryChanged: (() => Promise<void>) | null = null
  ) {
    this.container = container;
    this.renderShell();
    this.init();

    document.addEventListener('click', (event) => {
      if (!(event.target as HTMLElement).closest('.cmd-context-menu')) {
        this.closeContextMenu();
      }
    });

    onLangChange(() => {
      this.renderShell();
      this.render();
    });
  }

  private renderShell() {
    this.container.innerHTML = `
      <div class="panel-header">
        <h2>${commandIcon()} ${t('cmd.config.title')}</h2>
      </div>
      <div class="panel-body cmd-panel-body"></div>
    `;
  }

  private get body(): HTMLDivElement {
    return this.container.querySelector('.cmd-panel-body') as HTMLDivElement;
  }

  private async init() {
    await this.reload();
    this.render();
  }

  private async reload() {
    try {
      const [platforms, configs] = await Promise.all([
        invoke<string[]>('get_platforms'),
        invoke<CommandConfig[]>('load_commands'),
      ]);
      this.currentPlatforms = platforms;
      this.configs = configs.map((config) => ({
        ...config,
        commands: config.commands.map((command) => normalizeCommandEntry(command)),
      }));
      this.ensureActiveCategory();
    } catch (error) {
      console.error('Failed to load command library:', error);
      this.currentPlatforms = [];
      this.configs = [];
      this.activeCategoryId = '';
    }
  }

  private ensureActiveCategory() {
    const categories = this.getAllCategories();
    if (categories.length === 0) {
      this.activeCategoryId = '';
      return;
    }
    const hasActive = categories.some((category) => category.id === this.activeCategoryId);
    if (hasActive) return;
    this.activeCategoryId = categories.find((category) => category.current)?.id || categories[0].id;
  }

  private getAllCategories(): CategoryView[] {
    const categories: CategoryView[] = this.configs.map((config) => {
      const id = config.id || config.platform;
      const current = config.kind === 'system'
        && (config.platforms.some((platform) => this.currentPlatforms.includes(platform))
          || this.currentPlatforms.includes(config.platform));
      const source: CategoryView['source'] = config.kind === 'system'
        ? 'system'
        : BUILTIN_LIBRARY_IDS.has(id)
          ? 'builtin'
          : 'user';

      return {
        id,
        title: formatCategoryTitle(id),
        subtitle: config.kind === 'system'
          ? this.describePlatforms(config)
          : source === 'builtin'
            ? t('cmd.sourceBuiltin')
            : t('cmd.sourceUser'),
        kind: config.kind === 'system' ? 'system' : 'custom',
        source,
        commands: config.commands,
        current,
        canAdd: config.kind !== 'system',
        canDelete: config.kind !== 'system',
      };
    });

    categories.sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === 'system' ? -1 : 1;
      }
      if (left.current !== right.current) {
        return left.current ? -1 : 1;
      }
      return left.title.localeCompare(right.title, 'zh-CN');
    });

    return categories;
  }

  private get activeCategory(): CategoryView | null {
    return this.getAllCategories().find((category) => category.id === this.activeCategoryId) || null;
  }

  private render() {
    const categories = this.getAllCategories();
    const totalCommands = categories.reduce((sum, category) => sum + category.commands.length, 0);
    const active = this.activeCategory;

    let html = `
      <div class="cmd-summary cmd-summary-grid">
        <div class="cmd-summary-card">
          <span>${t('cmd.loaded', String(totalCommands))}</span>
          <strong>${categories.length}</strong>
        </div>
        <div class="cmd-summary-card">
          <span>${t('cmd.system')}</span>
          <strong>${categories.filter((category) => category.kind === 'system').length}</strong>
        </div>
        <div class="cmd-summary-card">
          <span>${t('cmd.other')}</span>
          <strong>${categories.filter((category) => category.kind === 'custom').length}</strong>
        </div>
      </div>
      <div class="cmd-toolbar">
        <button class="cmd-toolbar-btn primary" id="cmd-add-category">${addIcon()} ${t('cmd.addCategory')}</button>
        <button class="cmd-toolbar-btn" id="cmd-import-btn">${uploadIcon()} ${t('cmd.import')}</button>
      </div>
      <div class="cmd-platform-hint">${t('cmd.platformHint', this.currentPlatforms.map(formatCategoryTitle).join(', '))}</div>
      <div class="cmd-master-detail">
        <aside class="cmd-card-list">
          ${categories.length === 0 ? `<div class="cmd-empty">${t('cmd.emptySection')}</div>` : categories.map((category) => this.renderCategoryCard(category)).join('')}
        </aside>
        <section class="cmd-detail-pane">
          ${active ? this.renderCategoryDetail(active) : `<div class="cmd-empty">${t('cmd.emptySection')}</div>`}
        </section>
      </div>
    `;

    this.body.innerHTML = html;
    this.bindEvents();
    this.renderOverlayInline();
  }

  private renderCategoryCard(category: CategoryView): string {
    return `
      <button class="cmd-card-item${category.id === this.activeCategoryId ? ' active' : ''}" data-category-card="${escapeHtml(category.id)}">
        <div class="cmd-card-head">
          <span class="cmd-card-title">${escapeHtml(category.title)}</span>
          ${category.current ? `<span class="cmd-chip accent">${t('cmd.current')}</span>` : ''}
        </div>
        <div class="cmd-card-subtitle">${escapeHtml(category.subtitle)}</div>
        <div class="cmd-card-footer">
          <span class="cmd-chip">${category.source === 'system' ? t('cmd.sourceSystem') : category.source === 'builtin' ? t('cmd.sourceBuiltin') : t('cmd.sourceUser')}</span>
          <span class="cmd-count">${t('cmd.count', String(category.commands.length))}</span>
        </div>
      </button>
    `;
  }

  private renderCategoryDetail(category: CategoryView): string {
    return `
      <div class="cmd-detail-header">
        <div class="cmd-detail-header-main">
          <div class="cmd-detail-title-row">
            <h3>${escapeHtml(category.title)}</h3>
            <span class="cmd-chip">${category.source === 'system' ? t('cmd.sourceSystem') : category.source === 'builtin' ? t('cmd.sourceBuiltin') : t('cmd.sourceUser')}</span>
          </div>
          <div class="cmd-detail-subtitle">${escapeHtml(category.subtitle)}</div>
        </div>
        ${category.canAdd ? `<button class="cmd-toolbar-btn primary" data-add-command="${escapeHtml(category.id)}">${addIcon()} ${t('cmd.addCmd')}</button>` : ''}
      </div>
      <div class="cmd-detail-list">
        ${category.commands.length === 0 ? `<div class="cmd-empty">${t('cmd.emptySection')}</div>` : category.commands.map((command, index) => this.renderCommand(category, command, index)).join('')}
      </div>
    `;
  }

  private renderCommand(category: CategoryView, command: CommandEntry, index: number): string {
    const commandText = command.command || command.name;
    return `
      <div class="cmd-command-item ${category.canDelete ? 'editable' : ''}" data-command-category="${escapeHtml(category.id)}" data-command-index="${index}">
        <div class="cmd-command-main">
          <div class="cmd-command-name-row">
            <span class="cmd-command-name">${escapeHtml(command.name)}</span>
            ${command.name_cn ? `<span class="cmd-command-cn">${escapeHtml(command.name_cn)}</span>` : ''}
          </div>
          ${command.description ? `<div class="cmd-command-desc">${escapeHtml(command.description)}</div>` : ''}
          ${command.tags.length ? `<div class="cmd-command-tags">${command.tags.map((tag) => `<span class="cmd-tag">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
          <div class="cmd-command-text">${escapeHtml(commandText)}</div>
        </div>
        <div class="cmd-command-actions">
          <button class="cmd-mini-btn" data-send-command="${escapeHtml(category.id)}:${index}" title="${t('cmd.sendToTerminal')}">${sendIcon()}</button>
          <button class="cmd-mini-btn" data-edit-command="${escapeHtml(category.id)}:${index}" title="${t('cmd.edit')}">${editIcon()}</button>
        </div>
      </div>
    `;
  }

  private renderOverlay(): string {
    const overlay = this.overlayState;
    if (!overlay) return '';

    if (overlay.type === 'category') {
      return `
          <div class="cmd-overlay-card">
            <div class="cmd-overlay-title">${t('cmd.addCategory')}</div>
            <label class="cmd-field">
              <span>${t('cmd.categoryName')}</span>
              <input id="cmd-category-label" type="text" value="${escapeHtml(overlay.label)}" placeholder="Team Tools">
            </label>
            <label class="cmd-field">
              <span>${t('cmd.categoryId')}</span>
              <input id="cmd-category-id" type="text" value="${escapeHtml(overlay.id)}" placeholder="team-tools">
            </label>
            <div class="cmd-overlay-actions">
              <button class="cmd-toolbar-btn primary" id="cmd-save-category">${t('cmd.save')}</button>
              <button class="cmd-toolbar-btn" id="cmd-cancel-overlay">${t('cmd.cancel')}</button>
            </div>
          </div>
      `;
    }

    const category = this.getConfigById(overlay.categoryId);
    const entry = overlay.index === null
      ? emptyCommandEntry()
      : category?.commands[overlay.index] || emptyCommandEntry();

    return `
        <div class="cmd-overlay-card wide">
          <div class="cmd-overlay-title">${overlay.index === null ? t('cmd.addCmd') : t('cmd.editCmd')}</div>
          <div class="cmd-overlay-subtitle">${escapeHtml(formatCategoryTitle(overlay.categoryId))}</div>
          <label class="cmd-field">
            <span>${t('cmd.name')}</span>
            <input id="cmd-name" type="text" value="${escapeHtml(entry.name)}" placeholder="npm run dev">
          </label>
          <label class="cmd-field">
            <span>${t('cmd.command')}</span>
            <textarea id="cmd-command" rows="5" placeholder="npm run dev">${escapeHtml(entry.command || entry.name)}</textarea>
          </label>
          <label class="cmd-field">
            <span>${t('cmd.nameCn')}</span>
            <input id="cmd-name-cn" type="text" value="${escapeHtml(entry.name_cn)}" placeholder="启动开发服务">
          </label>
          <label class="cmd-field">
            <span>${t('cmd.description')}</span>
            <input id="cmd-description" type="text" value="${escapeHtml(entry.description)}" placeholder="${t('cmd.description')}">
          </label>
          <label class="cmd-field">
            <span>${t('cmd.alias')}</span>
            <input id="cmd-aliases" type="text" value="${escapeHtml(entry.alias.join(', '))}" placeholder="dev, start">
          </label>
          <label class="cmd-field">
            <span>${t('cmd.tags')}</span>
            <input id="cmd-tags" type="text" value="${escapeHtml(entry.tags.join(', '))}" placeholder="删除, remove, file">
          </label>
          <label class="cmd-field">
            <span>${t('cmd.hint')}</span>
            <input id="cmd-hint" type="text" value="${escapeHtml(entry.hint || '')}" placeholder="-r 递归 -f 强制">
          </label>
          <label class="cmd-field">
            <span>${t('cmd.examples')}</span>
            <textarea id="cmd-examples" rows="4" placeholder="rm -rf dist&#10;rm file.txt">${escapeHtml(entry.examples.join('\n'))}</textarea>
          </label>
          <div class="cmd-overlay-actions">
            <button class="cmd-toolbar-btn primary" id="cmd-save-command">${t('cmd.save')}</button>
            <button class="cmd-toolbar-btn" id="cmd-cancel-overlay">${t('cmd.cancel')}</button>
          </div>
        </div>
    `;
  }

  private bindEvents() {
    this.body.querySelectorAll<HTMLElement>('[data-category-card]').forEach((button) => {
      button.addEventListener('click', () => {
        this.activeCategoryId = button.dataset.categoryCard || '';
        this.render();
      });
    });

    this.body.querySelector('#cmd-add-category')?.addEventListener('click', () => {
      this.overlayState = { type: 'category', id: '', label: '' };
      this.render();
    });

    this.body.querySelector('#cmd-import-btn')?.addEventListener('click', () => {
      this.importFile();
    });

    this.body.querySelectorAll<HTMLElement>('[data-add-command]').forEach((button) => {
      button.addEventListener('click', () => {
        this.overlayState = { type: 'command', categoryId: button.dataset.addCommand!, index: null };
        this.render();
      });
    });

    this.body.querySelectorAll<HTMLElement>('[data-send-command]').forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.stopPropagation();
        const [categoryId, indexText] = (button.dataset.sendCommand || '').split(':');
        await this.sendCommand(categoryId, Number(indexText));
      });
    });

    this.body.querySelectorAll<HTMLElement>('[data-edit-command]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const [categoryId, indexText] = (button.dataset.editCommand || '').split(':');
        this.overlayState = { type: 'command', categoryId, index: Number(indexText) };
        this.render();
      });
    });

    this.body.querySelectorAll<HTMLElement>('.cmd-command-item').forEach((item) => {
      item.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        const categoryId = item.dataset.commandCategory!;
        const index = Number(item.dataset.commandIndex);
        this.showContextMenu(event.clientX, event.clientY, categoryId, index);
      });
    });
  }

  private renderOverlayInline() {
    const existing = this.container.querySelector(':scope > .cmd-overlay-inline');
    if (existing) existing.remove();
    if (!this.overlayState) return;

    const overlay = document.createElement('div');
    overlay.className = 'cmd-overlay-inline';
    overlay.innerHTML = this.renderOverlay();
    this.container.appendChild(overlay);
    this.bindOverlayEvents(overlay);
  }

  private bindOverlayEvents(overlay: HTMLElement) {
    overlay.querySelector('#cmd-save-category')?.addEventListener('click', async () => {
      await this.saveCategory();
    });
    overlay.querySelector('#cmd-save-command')?.addEventListener('click', async () => {
      await this.saveCommand();
    });
    overlay.querySelector('#cmd-cancel-overlay')?.addEventListener('click', () => {
      this.overlayState = null;
      this.render();
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this.overlayState = null;
        this.render();
      }
    });
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
        const parsed = JSON.parse(text) as Partial<CommandConfig>;
        if (!Array.isArray(parsed.commands)) {
          throw new Error(t('cmd.jsonError'));
        }
        const id = parsed.id?.trim() || slugify(file.name.replace(/\.json$/i, ''));
        const config: CommandConfig = {
          id,
          kind: 'custom',
          platforms: [],
          commands: parsed.commands.map((command) => normalizeCommandEntry(command)),
          platform: '',
        };
        await invoke('save_commands', { config });
        await this.reload();
        await this.onLibraryChanged?.();
        this.activeCategoryId = id;
        this.render();
      } catch (error) {
        alert(t('cmd.importFailed', String(error)));
      }
    });
    input.click();
  }

  private async saveCategory() {
    const root = this.container.querySelector('.cmd-overlay-inline');
    const label = (root?.querySelector('#cmd-category-label') as HTMLInputElement | null)?.value.trim() || '';
    const rawId = (root?.querySelector('#cmd-category-id') as HTMLInputElement | null)?.value.trim() || label;
    const id = slugify(rawId);

    if (!label || !id) {
      alert(t('cmd.categoryRequired'));
      return;
    }
    if (this.getConfigById(id)) {
      alert(t('cmd.categoryExists'));
      return;
    }

    const config: CommandConfig = {
      id,
      kind: 'custom',
      platforms: [],
      commands: [],
      platform: '',
    };
    await invoke('save_commands', { config });
    await this.reload();
    await this.onLibraryChanged?.();
    this.activeCategoryId = id;
    this.overlayState = null;
    this.render();
  }

  private async saveCommand() {
    if (!this.overlayState || this.overlayState.type !== 'command') return;
    const config = this.getConfigById(this.overlayState.categoryId);
    if (!config) return;

    const root = this.container.querySelector('.cmd-overlay-inline');
    const name = (root?.querySelector('#cmd-name') as HTMLInputElement | null)?.value.trim() || '';
    const command = (root?.querySelector('#cmd-command') as HTMLTextAreaElement | null)?.value.trim() || '';
    const nameCn = (root?.querySelector('#cmd-name-cn') as HTMLInputElement | null)?.value.trim() || '';
    const description = (root?.querySelector('#cmd-description') as HTMLInputElement | null)?.value.trim() || '';
    const aliasInput = (root?.querySelector('#cmd-aliases') as HTMLInputElement | null)?.value.trim() || '';
    const tagsInput = (root?.querySelector('#cmd-tags') as HTMLInputElement | null)?.value.trim() || '';
    const hint = (root?.querySelector('#cmd-hint') as HTMLInputElement | null)?.value.trim() || '';
    const examplesInput = (root?.querySelector('#cmd-examples') as HTMLTextAreaElement | null)?.value.trim() || '';

    if (!name || !command) {
      alert(t('cmd.nameRequired'));
      return;
    }

    const entry: CommandEntry = {
      name,
      command,
      name_cn: nameCn,
      description,
      alias: aliasInput.split(',').map((value) => value.trim()).filter(Boolean),
      usage: command,
      category: formatCategoryTitle(config.id),
      tags: tagsInput.split(',').map((value) => value.trim()).filter(Boolean),
      examples: examplesInput.split('\n').map((value) => value.trim()).filter(Boolean),
      hint,
    };

    const commands = [...config.commands];
    if (this.overlayState.index === null) {
      commands.push(entry);
    } else {
      commands[this.overlayState.index] = entry;
    }

    await invoke('save_commands', {
      config: {
        ...config,
        commands,
      },
    });
    await this.reload();
    await this.onLibraryChanged?.();
    this.activeCategoryId = config.id;
    this.overlayState = null;
    this.render();
  }

  private async deleteCommand(categoryId: string, index: number) {
    const config = this.getConfigById(categoryId);
    if (!config) return;
    const commands = [...config.commands];
    commands.splice(index, 1);
    await invoke('save_commands', {
      config: {
        ...config,
        commands,
      },
    });
    await this.reload();
    await this.onLibraryChanged?.();
    this.render();
  }

  private async sendCommand(categoryId: string, index: number) {
    const command = this.getCommand(categoryId, index);
    if (!command) return;
    const sent = await this.sendToTerminal(command.command || command.name);
    if (!sent) {
      alert(t('cmd.noActiveTerminal'));
    }
  }

  private showContextMenu(x: number, y: number, categoryId: string, index: number) {
    this.closeContextMenu();
    const category = this.getAllCategories().find((item) => item.id === categoryId);
    if (!category) return;

    const menu = document.createElement('div');
    menu.className = 'context-menu cmd-context-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    menu.appendChild(this.createMenuItem(t('cmd.sendToTerminal'), sendIcon(), async () => {
      await this.sendCommand(categoryId, index);
      this.closeContextMenu();
    }));

    if (category.canDelete) {
      menu.appendChild(this.createMenuItem(t('cmd.edit'), editIcon(), () => {
        this.overlayState = { type: 'command', categoryId, index };
        this.closeContextMenu();
        this.render();
      }));
      menu.appendChild(this.createMenuItem(t('cmd.delete'), deleteIcon(), async () => {
        await this.deleteCommand(categoryId, index);
        this.closeContextMenu();
      }, true));
    }

    document.body.appendChild(menu);
    this.commandContext = menu;
  }

  private createMenuItem(label: string, icon: string, handler: () => void | Promise<void>, danger = false): HTMLDivElement {
    const item = document.createElement('div');
    item.className = `context-menu-item${danger ? ' danger' : ''}`;
    item.innerHTML = `${icon}<span>${label}</span>`;
    item.addEventListener('click', () => {
      void handler();
    });
    return item;
  }

  private closeContextMenu() {
    if (!this.commandContext) return;
    this.commandContext.remove();
    this.commandContext = null;
  }

  private getConfigById(id: string): CommandConfig | undefined {
    return this.configs.find((config) => config.id === id || config.platform === id);
  }

  private getCommand(categoryId: string, index: number): CommandEntry | undefined {
    const command = this.getConfigById(categoryId)?.commands[index];
    return command ? normalizeCommandEntry(command) : undefined;
  }

  private describePlatforms(config: CommandConfig): string {
    const platforms = config.platforms.length > 0 ? config.platforms : [config.platform];
    return platforms.filter(Boolean).map(formatCategoryTitle).join(', ');
  }
}

function emptyCommandEntry(): CommandEntry {
  return {
    name: '',
    alias: [],
    name_cn: '',
    description: '',
    usage: '',
    category: '',
    command: '',
    tags: [],
    examples: [],
    hint: '',
  };
}

function formatCategoryTitle(id: string): string {
  const titles: Record<string, string> = {
    darwin: 'macOS',
    'quick-commands': t('cmd.quickLegacy'),
  };
  return titles[id] || id.replace(/[-_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function commandIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>`;
}

function addIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
}

function uploadIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>`;
}

function sendIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
}

function editIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`;
}

function deleteIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
}
