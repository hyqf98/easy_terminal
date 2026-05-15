import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { onLangChange, t } from './i18n';
import type {
  CommandDetail,
  CommandLibraryPayload,
  CommandLibrarySummary,
  CommandPayload,
  CommandSummary,
  CommandSummaryPage,
} from './types';

type OverlayState =
  | { type: 'library'; mode: 'create' | 'edit'; payload: CommandLibraryPayload }
  | { type: 'command'; libraryId: string; detail: CommandDetail | null };

interface LibraryView extends CommandLibrarySummary {
  canDelete: boolean;
  canReset: boolean;
}

const SEARCH_DEBOUNCE_MS = 180;

export class CommandConfigPanel {
  private container: HTMLDivElement;
  private libraries: CommandLibrarySummary[] = [];
  private currentPlatforms: string[] = [];
  private activeLibraryId = '';
  private activePage: CommandSummaryPage = { items: [], total: 0, page: 1, pageSize: 100 };
  private keyword = '';
  private overlayState: OverlayState | null = null;
  private commandContext: HTMLDivElement | null = null;
  private searchTimer: number | null = null;

  constructor(
    container: HTMLDivElement,
    private onLibraryChanged: (() => Promise<void>) | null = null
  ) {
    this.container = container;
    this.renderShell();
    this.setupBodyDelegation();
    void this.init();

    document.addEventListener('click', (event) => {
      if (!(event.target as HTMLElement).closest('.cmd-context-menu')) {
        this.closeContextMenu();
      }
    });

    onLangChange(() => {
      this.renderShell();
      void this.render();
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

  private setupBodyDelegation() {
    this.container.addEventListener('click', async (event) => {
      const target = event.target as HTMLElement;

      const editBtn = target.closest('[data-edit-command]') as HTMLElement | null;
      if (editBtn) {
        event.stopImmediatePropagation();
        event.stopPropagation();
        await this.openCommandEditor(Number(editBtn.dataset.editCommand));
        return;
      }

    });
  }

  private async init() {
    await this.reloadLibraries();
    await this.reloadActiveCommands();
    await this.render();
  }

  private async reloadLibraries() {
    const [platforms, libraries] = await Promise.all([
      invoke<string[]>('get_platforms'),
      invoke<CommandLibrarySummary[]>('list_command_libraries'),
    ]);
    this.currentPlatforms = platforms;
    this.libraries = libraries;
    this.ensureActiveLibrary();
  }

  private async reloadActiveCommands(page = 1) {
    if (!this.activeLibraryId) {
      this.activePage = { items: [], total: 0, page: 1, pageSize: 100 };
      return;
    }
    this.activePage = await invoke<CommandSummaryPage>('query_command_summaries', {
      params: {
        libraryId: this.activeLibraryId,
        keyword: this.keyword,
        page,
        pageSize: 200,
      },
    });
  }

  private ensureActiveLibrary() {
    if (this.libraries.length === 0) {
      this.activeLibraryId = '';
      return;
    }
    if (!this.libraries.some((library) => library.id === this.activeLibraryId)) {
      this.activeLibraryId = this.libraries.find((library) => library.current)?.id || this.libraries[0].id;
    }
  }

  private get activeLibrary(): LibraryView | null {
    const library = this.libraries.find((item) => item.id === this.activeLibraryId);
    if (!library) return null;
    return {
      ...library,
      canDelete: !['builtin', 'system'].includes(library.sourceType),
      canReset: library.sourceType === 'builtin',
    };
  }

  private get allLibraries(): LibraryView[] {
    return this.libraries.map((library) => ({
      ...library,
      canDelete: !['builtin', 'system'].includes(library.sourceType),
      canReset: library.sourceType === 'builtin',
    }));
  }

  private async render() {
    const libraries = this.allLibraries;
    const totalCommands = libraries.reduce((sum, library) => sum + library.commandCount, 0);
    const active = this.activeLibrary;

    this.body.innerHTML = `
      <div class="cmd-summary cmd-summary-grid">
        <div class="cmd-summary-card">
          <span>${t('cmd.loaded', String(totalCommands))}</span>
          <strong>${libraries.length}</strong>
        </div>
        <div class="cmd-summary-card">
          <span>${t('cmd.system')}</span>
          <strong>${libraries.filter((item) => item.kind === 'system').length}</strong>
        </div>
        <div class="cmd-summary-card">
          <span>${t('cmd.other')}</span>
          <strong>${libraries.filter((item) => item.kind !== 'system').length}</strong>
        </div>
      </div>
      <div class="cmd-toolbar">
        <button class="cmd-toolbar-btn primary" id="cmd-add-library">${addIcon()} ${t('cmd.addCategory')}</button>
        <button class="cmd-toolbar-btn" id="cmd-import-btn">${uploadIcon()} ${t('cmd.import')}</button>
      </div>
      <div class="cmd-platform-hint">${t('cmd.platformHint', this.currentPlatforms.map(formatCategoryTitle).join(', '))}</div>
      <div class="cmd-master-detail">
        <aside class="cmd-card-list">
          ${libraries.length === 0 ? `<div class="cmd-empty">${t('cmd.emptySection')}</div>` : libraries.map((library) => this.renderLibraryCard(library)).join('')}
        </aside>
        <section class="cmd-detail-pane">
          ${active ? this.renderLibraryDetail(active) : `<div class="cmd-empty">${t('cmd.emptySection')}</div>`}
        </section>
      </div>
    `;

    this.bindEvents();
    this.renderOverlayInline();
  }

  private renderLibraryCard(library: LibraryView): string {
    return `
      <button class="cmd-card-item${library.id === this.activeLibraryId ? ' active' : ''}" data-library-card="${escapeHtml(library.id)}">
        <div class="cmd-card-head">
          <span class="cmd-card-title">${escapeHtml(library.label || formatCategoryTitle(library.id))}</span>
          ${library.current ? `<span class="cmd-chip accent">${t('cmd.current')}</span>` : ''}
        </div>
        <div class="cmd-card-subtitle">${escapeHtml(this.describeLibrary(library))}</div>
        <div class="cmd-card-footer">
          <span class="cmd-chip">${escapeHtml(this.describeSource(library))}</span>
          <span class="cmd-count">${t('cmd.count', String(library.commandCount))}</span>
        </div>
      </button>
    `;
  }

  private renderLibraryDetail(library: LibraryView): string {
    const commands = this.activePage.items;
    const buttons = [
      `<button class="cmd-toolbar-btn primary" data-add-command="${escapeHtml(library.id)}">${addIcon()} ${t('cmd.addCmd')}</button>`,
      `<button class="cmd-toolbar-btn" data-export-library="${escapeHtml(library.id)}">${downloadIcon()} ${t('cmd.export')}</button>`,
      library.canReset ? `<button class="cmd-toolbar-btn" data-reset-library="${escapeHtml(library.id)}">${resetIcon()} ${t('cmd.reset')}</button>` : '',
      `<button class="cmd-toolbar-btn" data-edit-library="${escapeHtml(library.id)}">${editIcon()} ${t('cmd.edit')}</button>`,
      library.canDelete ? `<button class="cmd-toolbar-btn danger" data-delete-library="${escapeHtml(library.id)}">${deleteIcon()} ${t('cmd.delete')}</button>` : '',
    ].filter(Boolean).join('');

    return `
      <div class="cmd-detail-header">
        <div class="cmd-detail-header-main">
          <div class="cmd-detail-title-row">
            <h3>${escapeHtml(library.label || formatCategoryTitle(library.id))}</h3>
            <span class="cmd-chip">${escapeHtml(this.describeSource(library))}</span>
            ${library.enabled ? '' : `<span class="cmd-chip">${t('mapping.disabled')}</span>`}
          </div>
          <div class="cmd-detail-subtitle">${escapeHtml(this.describeLibrary(library))}</div>
        </div>
        <div class="cmd-detail-actions">${buttons}</div>
      </div>
      <div class="cmd-detail-search">
        <input id="cmd-library-search" class="cmd-search-input" type="text" value="${escapeHtml(this.keyword)}" placeholder="${escapeHtml(t('cmd.searchPlaceholder'))}">
      </div>
      <div class="cmd-detail-list">
        ${commands.length === 0 ? `<div class="cmd-empty">${t('cmd.emptySection')}</div>` : commands.map((command) => this.renderCommand(command)).join('')}
      </div>
    `;
  }

  private renderCommand(command: CommandSummary): string {
    const preview = command.firstExample ? `<div class="cmd-command-example">${escapeHtml(command.firstExample)}</div>` : '';
    return `
      <div class="cmd-command-item editable" data-command-id="${command.id}">
        <div class="cmd-command-main">
          <div class="cmd-command-name-row">
            <span class="cmd-command-name">${escapeHtml(command.name)}</span>
            ${command.name_cn ? `<span class="cmd-command-cn">${escapeHtml(command.name_cn)}</span>` : ''}
            ${command.enabled ? '' : `<span class="cmd-chip">${t('mapping.disabled')}</span>`}
          </div>
          ${command.description ? `<div class="cmd-command-desc">${escapeHtml(command.description)}</div>` : ''}
          ${command.tags.length ? `<div class="cmd-command-tags">${command.tags.map((tag) => `<span class="cmd-tag">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
          <div class="cmd-command-text">${escapeHtml(command.command || command.name)}</div>
          ${preview}
        </div>
        <div class="cmd-command-actions">
          <button class="cmd-mini-btn" data-edit-command="${command.id}" title="${t('cmd.edit')}">${editIcon()}</button>
        </div>
      </div>
    `;
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

  private renderOverlay(): string {
    if (!this.overlayState) return '';
    if (this.overlayState.type === 'library') {
      const payload = this.overlayState.payload;
      return `
        <div class="cmd-overlay-card">
          <div class="cmd-overlay-title">${this.overlayState.mode === 'create' ? t('cmd.addCategory') : t('cmd.edit')}</div>
          <label class="cmd-field">
            <span>${t('cmd.categoryName')}</span>
            <input id="cmd-library-label" type="text" value="${escapeHtml(payload.label)}" placeholder="Team Tools">
          </label>
          <label class="cmd-field">
            <span>${t('cmd.categoryId')}</span>
            <input id="cmd-library-id" type="text" value="${escapeHtml(payload.id)}" ${this.overlayState.mode === 'edit' ? 'disabled' : ''} placeholder="team-tools">
          </label>
          <label class="cmd-field">
            <span>${t('cmd.platforms')}</span>
            <input id="cmd-library-platforms" type="text" value="${escapeHtml(payload.platforms.join(', '))}" placeholder="darwin, linux">
          </label>
          <label class="cmd-field">
            <span>${t('cmd.languageField')}</span>
            <input id="cmd-library-language" type="text" value="${escapeHtml(payload.language)}" placeholder="python">
          </label>
          <label class="mapping-toggle-row settings-toggle-row">
            <input id="cmd-library-enabled" type="checkbox" ${payload.enabled ? 'checked' : ''}>
            <span>${t('mapping.enabled')}</span>
          </label>
          <div class="cmd-overlay-actions">
            <button class="cmd-toolbar-btn primary" id="cmd-save-library">${t('cmd.save')}</button>
            <button class="cmd-toolbar-btn" id="cmd-cancel-overlay">${t('cmd.cancel')}</button>
          </div>
        </div>
      `;
    }

    const raw = this.overlayState.detail || emptyCommandDetail(this.overlayState.libraryId);
    const detail = {
      ...raw,
      alias: raw.alias || [],
      tags: raw.tags || [],
      triggers: raw.triggers || [],
      keywords: raw.keywords || [],
      examples: raw.examples || [],
    };
    return `
      <div class="cmd-overlay-card wide">
        <div class="cmd-overlay-title">${detail.id ? t('cmd.editCmd') : t('cmd.addCmd')}</div>
        <div class="cmd-overlay-subtitle">${escapeHtml(formatCategoryTitle(this.overlayState.libraryId))}</div>
        <label class="cmd-field">
          <span>${t('cmd.name')}</span>
          <input id="cmd-name" type="text" value="${escapeHtml(detail.name)}" placeholder="npm run dev">
        </label>
        <label class="cmd-field">
          <span>${t('cmd.command')}</span>
          <textarea id="cmd-command" rows="4" placeholder="npm run dev&#10;支持 [%s:参数名] 占位符自动跳转光标">${escapeHtml(detail.command || detail.name)}</textarea>
        </label>
        <label class="cmd-field">
          <span>${t('cmd.nameCn')}</span>
          <input id="cmd-name-cn" type="text" value="${escapeHtml(detail.name_cn)}" placeholder="启动开发服务">
        </label>
        <label class="cmd-field">
          <span>${t('cmd.description')}</span>
          <input id="cmd-description" type="text" value="${escapeHtml(detail.description)}" placeholder="${t('cmd.description')}">
        </label>
        <label class="cmd-field">
          <span>${t('cmd.category')}</span>
          <input id="cmd-category" type="text" value="${escapeHtml(detail.category)}" placeholder="${escapeHtml(formatCategoryTitle(this.overlayState.libraryId))}">
        </label>
        <label class="cmd-field">
          <span>${t('cmd.alias')}</span>
          <input id="cmd-aliases" type="text" value="${escapeHtml(detail.alias.join(', '))}" placeholder="dev, start">
        </label>
        <label class="cmd-field">
          <span>${t('cmd.tags')}</span>
          <input id="cmd-tags" type="text" value="${escapeHtml(detail.tags.join(', '))}" placeholder="build, dev">
        </label>
        <label class="cmd-field">
          <span>${t('cmd.triggers')}</span>
          <input id="cmd-triggers" type="text" value="${escapeHtml(detail.triggers.join(', '))}" placeholder="pnpm, script">
        </label>
        <label class="cmd-field">
          <span>${t('cmd.keywords')}</span>
          <input id="cmd-keywords" type="text" value="${escapeHtml(detail.keywords.join(', '))}" placeholder="workspace, node">
        </label>
        <label class="cmd-field">
          <span>${t('cmd.languageField')}</span>
          <input id="cmd-language" type="text" value="${escapeHtml(detail.language || '')}" placeholder="node">
        </label>
        <label class="cmd-field">
          <span>${t('cmd.hint')}</span>
          <input id="cmd-hint" type="text" value="${escapeHtml(detail.hint || '')}" placeholder="run <script>">
        </label>
        <label class="cmd-field">
          <span>${t('cmd.examples')}</span>
          <textarea id="cmd-examples" rows="5" placeholder="npm run dev&#10;npm run build">${escapeHtml(detail.examples.join('\n'))}</textarea>
        </label>
        <label class="mapping-toggle-row settings-toggle-row">
          <input id="cmd-enabled" type="checkbox" ${detail.enabled ? 'checked' : ''}>
          <span>${t('mapping.enabled')}</span>
        </label>
        <div class="cmd-overlay-actions">
          <button class="cmd-toolbar-btn primary" id="cmd-save-command">${t('cmd.save')}</button>
          <button class="cmd-toolbar-btn" id="cmd-cancel-overlay">${t('cmd.cancel')}</button>
        </div>
      </div>
    `;
  }

  private bindEvents() {
    this.body.querySelectorAll<HTMLElement>('[data-library-card]').forEach((button) => {
      button.addEventListener('click', async () => {
        this.activeLibraryId = button.dataset.libraryCard || '';
        await this.reloadActiveCommands();
        await this.render();
      });
    });

    this.body.querySelector('#cmd-add-library')?.addEventListener('click', () => {
      this.overlayState = {
        type: 'library',
        mode: 'create',
        payload: {
          id: '',
          label: '',
          kind: 'custom',
          sourceType: 'user',
          platforms: [],
          language: '',
          enabled: true,
        },
      };
      this.renderOverlayInline();
    });

    this.body.querySelector('#cmd-import-btn')?.addEventListener('click', () => {
      void this.importFile();
    });

    this.body.querySelector('#cmd-library-search')?.addEventListener('input', (event) => {
      this.keyword = (event.target as HTMLInputElement).value.trim();
      if (this.searchTimer !== null) {
        window.clearTimeout(this.searchTimer);
      }
      this.searchTimer = window.setTimeout(async () => {
        await this.reloadActiveCommands();
        await this.render();
      }, SEARCH_DEBOUNCE_MS);
    });

    this.body.querySelector('[data-add-command]')?.addEventListener('click', async () => {
      this.overlayState = { type: 'command', libraryId: this.activeLibraryId, detail: null };
      this.renderOverlayInline();
    });

    this.body.querySelector('[data-edit-library]')?.addEventListener('click', () => {
      const active = this.activeLibrary;
      if (!active) return;
      this.overlayState = {
        type: 'library',
        mode: 'edit',
        payload: {
          id: active.id,
          label: active.label,
          kind: active.kind,
          sourceType: active.sourceType,
          platforms: [...active.platforms],
          language: active.language,
          enabled: active.enabled,
        },
      };
      this.renderOverlayInline();
    });

    this.body.querySelector('[data-delete-library]')?.addEventListener('click', async () => {
      if (!this.activeLibrary) return;
      await invoke('delete_command_library', { libraryId: this.activeLibrary.id });
      await this.reloadLibraries();
      await this.reloadActiveCommands();
      await this.onLibraryChanged?.();
      await this.render();
    });

    this.body.querySelector('[data-reset-library]')?.addEventListener('click', async () => {
      if (!this.activeLibrary) return;
      await invoke('reset_builtin_library', { libraryId: this.activeLibrary.id });
      await this.reloadLibraries();
      await this.reloadActiveCommands();
      await this.onLibraryChanged?.();
      await this.render();
    });

    this.body.querySelector('[data-export-library]')?.addEventListener('click', async () => {
      await this.exportActiveLibrary();
    });

    this.body.querySelectorAll<HTMLElement>('.cmd-command-item').forEach((item) => {
      item.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        const commandId = Number(item.dataset.commandId || '0');
        this.showContextMenu(event.clientX, event.clientY, commandId);
      });
    });
  }

  private bindOverlayEvents(overlay: HTMLElement) {
    overlay.querySelector('#cmd-save-library')?.addEventListener('click', async () => {
      await this.saveLibrary();
    });
    overlay.querySelector('#cmd-save-command')?.addEventListener('click', async () => {
      await this.saveCommand();
    });
    overlay.querySelector('#cmd-cancel-overlay')?.addEventListener('click', async () => {
      this.overlayState = null;
      await this.render();
    });
    overlay.addEventListener('click', async (event) => {
      if (event.target === overlay) {
        this.overlayState = null;
        await this.render();
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
        const library = await invoke<CommandLibrarySummary>('import_command_library', { json: text });
        this.activeLibraryId = library.id;
        this.keyword = '';
        await this.reloadLibraries();
        await this.reloadActiveCommands();
        await this.onLibraryChanged?.();
        await this.render();
      } catch (error) {
        alert(t('cmd.importFailed', String(error)));
      }
    });
    input.click();
  }

  private async exportActiveLibrary() {
    const active = this.activeLibrary;
    if (!active) return;
    const json = await invoke<string>('export_command_library', { libraryId: active.id });
    const target = await save({
      defaultPath: `${active.id}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!target) return;
    await invoke('write_text_file', { path: target, content: json });
  }

  private async openCommandEditor(commandId: number) {
    const detail = await invoke<CommandDetail | null>('get_command_detail', { id: commandId });
    if (!detail) return;
    this.overlayState = {
      type: 'command',
      libraryId: detail.libraryId,
      detail,
    };
    this.renderOverlayInline();
  }

  private async saveLibrary() {
    if (!this.overlayState || this.overlayState.type !== 'library') return;
    const root = this.container.querySelector('.cmd-overlay-inline');
    const payload: CommandLibraryPayload = {
      id: ((root?.querySelector('#cmd-library-id') as HTMLInputElement | null)?.value || this.overlayState.payload.id).trim(),
      label: ((root?.querySelector('#cmd-library-label') as HTMLInputElement | null)?.value || '').trim(),
      kind: this.overlayState.payload.kind || 'custom',
      sourceType: this.overlayState.payload.sourceType || 'user',
      platforms: (((root?.querySelector('#cmd-library-platforms') as HTMLInputElement | null)?.value || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)),
      language: ((root?.querySelector('#cmd-library-language') as HTMLInputElement | null)?.value || '').trim(),
      enabled: (root?.querySelector('#cmd-library-enabled') as HTMLInputElement | null)?.checked ?? true,
    };
    if (!payload.id || !payload.label) {
      alert(t('cmd.categoryRequired'));
      return;
    }

    if (this.overlayState.mode === 'create') {
      await invoke('create_command_library', { payload });
    } else {
      await invoke('update_command_library', { payload });
    }

    this.activeLibraryId = payload.id;
    this.overlayState = null;
    await this.reloadLibraries();
    await this.reloadActiveCommands();
    await this.onLibraryChanged?.();
    await this.render();
  }

  private async saveCommand() {
    if (!this.overlayState || this.overlayState.type !== 'command') return;
    const root = this.container.querySelector('.cmd-overlay-inline');
    const current = this.overlayState.detail;
    const payload: CommandPayload = {
      id: current?.id ?? null,
      libraryId: this.overlayState.libraryId,
      commandKey: current?.commandKey || '',
      name: ((root?.querySelector('#cmd-name') as HTMLInputElement | null)?.value || '').trim(),
      command: ((root?.querySelector('#cmd-command') as HTMLTextAreaElement | null)?.value || '').trim(),
      name_cn: ((root?.querySelector('#cmd-name-cn') as HTMLInputElement | null)?.value || '').trim(),
      description: ((root?.querySelector('#cmd-description') as HTMLInputElement | null)?.value || '').trim(),
      usage: ((root?.querySelector('#cmd-command') as HTMLTextAreaElement | null)?.value || '').trim(),
      category: ((root?.querySelector('#cmd-category') as HTMLInputElement | null)?.value || '').trim() || formatCategoryTitle(this.overlayState.libraryId),
      alias: splitCsv((root?.querySelector('#cmd-aliases') as HTMLInputElement | null)?.value || ''),
      tags: splitCsv((root?.querySelector('#cmd-tags') as HTMLInputElement | null)?.value || ''),
      examples: splitLines((root?.querySelector('#cmd-examples') as HTMLTextAreaElement | null)?.value || ''),
      hint: ((root?.querySelector('#cmd-hint') as HTMLInputElement | null)?.value || '').trim(),
      language: ((root?.querySelector('#cmd-language') as HTMLInputElement | null)?.value || '').trim(),
      triggers: splitCsv((root?.querySelector('#cmd-triggers') as HTMLInputElement | null)?.value || ''),
      keywords: splitCsv((root?.querySelector('#cmd-keywords') as HTMLInputElement | null)?.value || ''),
      weight: current?.weight || 0,
      enabled: (root?.querySelector('#cmd-enabled') as HTMLInputElement | null)?.checked ?? true,
    };
    if (!payload.name || !payload.command) {
      alert(t('cmd.nameRequired'));
      return;
    }

    if (payload.id) {
      await invoke('update_command', { payload });
    } else {
      await invoke('create_command', { payload });
    }

    this.overlayState = null;
    await this.reloadActiveCommands(this.activePage.page);
    await this.onLibraryChanged?.();
    await this.render();
  }

  private async deleteCommand(id: number) {
    await invoke('delete_command_entry', { id });
    await this.reloadActiveCommands(this.activePage.page);
    await this.onLibraryChanged?.();
    await this.render();
  }

  private async showContextMenu(x: number, y: number, commandId: number) {
    this.closeContextMenu();
    const command = this.activePage.items.find((item) => item.id === commandId);
    if (!command) return;

    const menu = document.createElement('div');
    menu.className = 'context-menu cmd-context-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    menu.appendChild(this.createMenuItem(t('cmd.edit'), editIcon(), async () => {
      await this.openCommandEditor(commandId);
      this.closeContextMenu();
    }));
    menu.appendChild(this.createMenuItem(t('cmd.delete'), deleteIcon(), async () => {
      await this.deleteCommand(commandId);
      this.closeContextMenu();
    }, true));

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

  private describeLibrary(library: CommandLibrarySummary): string {
    const parts = [
      library.platforms.length ? library.platforms.map(formatCategoryTitle).join(', ') : '',
      library.language,
    ].filter(Boolean);
    return parts.join(' · ') || formatCategoryTitle(library.id);
  }

  private describeSource(library: CommandLibrarySummary): string {
    if (library.kind === 'system') return t('cmd.sourceSystem');
    if (library.sourceType === 'builtin') return t('cmd.sourceBuiltin');
    return t('cmd.sourceUser');
  }
}

function emptyCommandDetail(libraryId: string): CommandDetail {
  return {
    id: 0,
    libraryId,
    commandKey: '',
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
    language: '',
    triggers: [],
    keywords: [],
    weight: 0,
    enabled: true,
    exampleCount: 0,
    firstExample: '',
    libraryKind: '',
    sourceType: '',
    libraryLabel: '',
  };
}

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitLines(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatCategoryTitle(id: string): string {
  const titles: Record<string, string> = {
    darwin: 'macOS',
    'quick-commands': t('cmd.quickLegacy'),
  };
  return titles[id] || id.replace(/[-_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function escapeHtml(value: string | undefined | null): string {
  if (value == null) return '';
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

function downloadIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
}

function resetIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 .49-9"></path></svg>`;
}

function editIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`;
}

function deleteIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
}
