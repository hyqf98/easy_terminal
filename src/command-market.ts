import { invoke } from '@tauri-apps/api/core';
import { onLangChange, t } from './i18n';
import type {
  CommandEntry,
  CommandLibrarySummary,
  RemoteCommandLibrary,
} from './types';

const REPO_OWNER = 'hyqf98';
const REPO_NAME = 'easy_terminal';
const COMMANDS_BASE = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/src-tauri/commands`;
const RAW_BASE = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/src-tauri/commands`;

interface GithubContentEntry {
  name: string;
  path: string;
  size: number;
  sha: string;
  download_url: string | null;
  type: string;
}

export class CommandMarketPanel {
  private container: HTMLDivElement;
  private body: HTMLDivElement;
  private remoteLibraries: RemoteCommandLibrary[] = [];
  private localLibraries: CommandLibrarySummary[] = [];
  private activeLibrary: RemoteCommandLibrary | null = null;
  private previewCommands: CommandEntry[] = [];
  private keyword = '';
  private loading = false;
  private loadingPreview = false;
  private searchTimer: number | null = null;
  private errorMsg = '';

  constructor(
    container: HTMLDivElement,
    private onLibraryChanged: (() => Promise<void>) | null = null
  ) {
    this.container = container;
    this.container.innerHTML = `
      <div class="panel-header">
        <h2>${shopIcon()} ${t('market.title')}</h2>
      </div>
      <div class="panel-body market-panel-body"></div>
    `;
    this.body = this.container.querySelector('.market-panel-body') as HTMLDivElement;

    onLangChange(() => {
      this.container.querySelector('.panel-header h2')!.innerHTML = `${shopIcon()} ${t('market.title')}`;
      void this.render();
    });
  }

  async init() {
    await this.reloadLocalLibraries();
    await this.fetchRemoteList();
    await this.render();
  }

  private async reloadLocalLibraries() {
    this.localLibraries = await invoke<CommandLibrarySummary[]>('list_command_libraries');
  }

  private async fetchRemoteList() {
    this.loading = true;
    this.errorMsg = '';
    await this.render();

    try {
      if (isDevRuntime()) {
        await this.fetchLocalList();
      } else {
        await this.fetchGithubList();
      }
    } catch (e) {
      this.remoteLibraries = [];
      this.errorMsg = t('market.loadFailed') + (e instanceof Error ? ` (${e.message})` : '');
    } finally {
      this.loading = false;
    }
  }

  private async fetchLocalList() {
    const entries = await invoke<{ name: string; directory: string }[]>('list_bundled_command_libraries');
    const localIds = new Set(this.localLibraries.map((lib) => lib.id));

    const systemLibs: RemoteCommandLibrary[] = [];
    const customLibs: RemoteCommandLibrary[] = [];

    for (const entry of entries) {
      const lib: RemoteCommandLibrary = {
        name: entry.name,
        path: `commands/${entry.directory}/${entry.name}.json`,
        size: 0,
        sha: '',
        downloadUrl: '',
        directory: entry.directory as 'system' | 'custom',
        isInstalled: localIds.has(entry.name),
        commandCount: 0,
        label: formatTitle(entry.name),
        description: '',
        loaded: false,
      };
      if (entry.directory === 'system') {
        systemLibs.push(lib);
      } else {
        customLibs.push(lib);
      }
    }

    systemLibs.sort((a, b) => a.label.localeCompare(b.label));
    customLibs.sort((a, b) => a.label.localeCompare(b.label));
    this.remoteLibraries = [...systemLibs, ...customLibs];
  }

  private async fetchGithubList() {
    const [customEntries, systemEntries] = await Promise.all([
      fetchDirectory('custom'),
      fetchDirectory('system'),
    ]);

    const localIds = new Set(this.localLibraries.map((lib) => lib.id));

    const customLibs = customEntries.map((entry) => buildRemoteLibrary(entry, 'custom', localIds));
    const systemLibs = systemEntries.map((entry) => buildRemoteLibrary(entry, 'system', localIds));

    systemLibs.sort((a, b) => a.label.localeCompare(b.label));
    customLibs.sort((a, b) => a.label.localeCompare(b.label));

    this.remoteLibraries = [...systemLibs, ...customLibs];
  }

  private get filteredLibraries(): RemoteCommandLibrary[] {
    if (!this.keyword) return this.remoteLibraries;
    const lower = this.keyword.toLowerCase();
    return this.remoteLibraries.filter(
      (lib) =>
        lib.name.toLowerCase().includes(lower) ||
        lib.label.toLowerCase().includes(lower) ||
        lib.description.toLowerCase().includes(lower)
    );
  }

  private async render() {
    const libs = this.filteredLibraries;
    const installedCount = libs.filter((lib) => lib.isInstalled).length;
    const active = this.activeLibrary;

    this.body.innerHTML = `
      <div class="market-toolbar">
        <button class="cmd-toolbar-btn" id="market-refresh">${refreshIcon()} ${t('market.refresh')}</button>
        <input id="market-search" class="cmd-search-input" type="text" value="${escapeHtml(this.keyword)}" placeholder="${escapeHtml(t('market.searchPlaceholder'))}">
      </div>
      ${this.loading ? `<div class="market-loading">${spinIcon()} ${t('market.loading')}</div>` : ''}
      ${!this.loading && this.errorMsg ? `<div class="cmd-empty market-error">${escapeHtml(this.errorMsg)}</div>` : ''}
      ${!this.loading && !this.errorMsg && libs.length > 0 ? `<div class="market-summary">${t('market.summary', String(libs.length), String(installedCount))}</div>` : ''}
      ${!this.loading && !this.errorMsg && libs.length === 0 ? `<div class="cmd-empty">${t('market.noResults')}</div>` : ''}
      <div class="cmd-master-detail">
        <aside class="cmd-card-list market-card-list">
          ${libs.map((lib) => this.renderCard(lib)).join('')}
        </aside>
        <section class="cmd-detail-pane market-detail-pane">
          ${active ? this.renderDetail(active) : `<div class="cmd-empty">${t('market.emptyPreview')}</div>`}
        </section>
      </div>
    `;

    this.bindEvents();
  }

  private renderCard(lib: RemoteCommandLibrary): string {
    const isActive = this.activeLibrary?.name === lib.name;
    const isSystem = lib.directory === 'system';
    const badge = isSystem
      ? `<span class="cmd-chip accent">${t('market.systemBuiltin')}</span>`
      : lib.isInstalled
        ? `<span class="cmd-chip installed">${t('market.installed')}</span>`
        : '';

    return `
      <button class="cmd-card-item market-card-item${isActive ? ' active' : ''}" data-market-card="${escapeHtml(lib.name)}">
        <div class="cmd-card-head">
          <span class="cmd-card-title">${escapeHtml(lib.label)}</span>
          ${badge}
        </div>
        <div class="cmd-card-subtitle">${escapeHtml(lib.directory === 'system' ? t('market.systemCategory') : t('market.customCategory'))}</div>
        <div class="cmd-card-footer">
          ${lib.commandCount > 0 ? `<span class="cmd-count">${t('market.commands', String(lib.commandCount))}</span>` : ''}
        </div>
      </button>
    `;
  }

  private renderDetail(lib: RemoteCommandLibrary): string {
    const isSystem = lib.directory === 'system';
    const isInstalled = lib.isInstalled;

    let actionButtons = '';
    if (isSystem) {
      actionButtons = `<span class="cmd-chip accent">${t('market.systemHint')}</span>`;
    } else if (isInstalled) {
      actionButtons = `
        <button class="cmd-toolbar-btn primary" data-market-sync="${escapeHtml(lib.name)}">${syncIcon()} ${t('market.sync')}</button>
        <button class="cmd-toolbar-btn danger" data-market-uninstall="${escapeHtml(lib.name)}">${deleteIcon()} ${t('market.uninstall')}</button>
      `;
    } else {
      actionButtons = `
        <button class="cmd-toolbar-btn primary" data-market-install="${escapeHtml(lib.name)}">${downloadIcon()} ${t('market.install')}</button>
      `;
    }

    const previewHtml = this.loadingPreview
      ? `<div class="market-loading">${spinIcon()} ${t('market.loading')}</div>`
      : this.previewCommands.length > 0
        ? `
          <div class="market-detail-section-title">${t('market.commandPreview')}</div>
          <div class="market-cmd-master-detail">
            <aside class="market-cmd-list">
              ${this.previewCommands.map((cmd) => this.renderPreviewLeft(cmd)).join('')}
            </aside>
            <section class="market-cmd-detail-pane">
              ${this.renderPreviewRight()}
            </section>
          </div>
        `
        : '';

    return `
      <div class="cmd-detail-header">
        <div class="cmd-detail-header-main">
          <div class="cmd-detail-title-row">
            <h3>${escapeHtml(lib.label)}</h3>
            <span class="cmd-chip">${escapeHtml(lib.directory === 'system' ? t('market.systemCategory') : t('market.customCategory'))}</span>
          </div>
        </div>
        <div class="cmd-detail-actions">${actionButtons}</div>
      </div>
      <div class="market-detail-section">
        ${previewHtml}
      </div>
    `;
  }

  private activeCommandKey: string | null = null;

  private renderPreviewLeft(cmd: CommandEntry): string {
    const key = cmd.command || cmd.name;
    const isActive = this.activeCommandKey === key;
    return `
      <button class="market-cmd-list-item${isActive ? ' active' : ''}" data-market-cmd="${escapeHtml(key)}">
        <span class="market-cmd-item-name">${escapeHtml(cmd.name)}</span>
        ${cmd.name_cn ? `<span class="market-cmd-item-cn">${escapeHtml(cmd.name_cn)}</span>` : ''}
      </button>
    `;
  }

  private renderPreviewRight(): string {
    if (!this.activeCommandKey) {
      return `<div class="cmd-empty">${t('market.emptyPreview')}</div>`;
    }
    const cmd = this.previewCommands.find((c) => (c.command || c.name) === this.activeCommandKey);
    if (!cmd) {
      return `<div class="cmd-empty">${t('market.emptyPreview')}</div>`;
    }
    return `<div class="market-cmd-detail-scroll">${this.renderCommandDetail(cmd)}</div>`;
  }

  private renderCommandDetail(cmd: CommandEntry): string {
    const sections: string[] = [];

    if (cmd.usage) {
      sections.push(`
        <div class="cmd-detail-section">
          <div class="cmd-detail-label">${t('market.cmdUsage')}</div>
          <code class="cmd-detail-code">${escapeHtml(cmd.usage)}</code>
        </div>
      `);
    }

    const usageParams = this.extractParams(cmd.usage);
    if (usageParams.length > 0) {
      const paramItems = usageParams.map((p) => `<li><code>${escapeHtml(p)}</code></li>`).join('');
      sections.push(`
        <div class="cmd-detail-section">
          <div class="cmd-detail-label">${t('market.cmdParams')}</div>
          <ul class="cmd-detail-params">${paramItems}</ul>
        </div>
      `);
    }

    if (cmd.alias && cmd.alias.length > 0) {
      const aliasHtml = cmd.alias.map((a) => `<code class="cmd-detail-chip">${escapeHtml(a)}</code>`).join(' ');
      sections.push(`
        <div class="cmd-detail-section">
          <div class="cmd-detail-label">${t('market.cmdAlias')}</div>
          <div class="cmd-detail-chips">${aliasHtml}</div>
        </div>
      `);
    }

    if (cmd.category) {
      sections.push(`
        <div class="cmd-detail-section">
          <div class="cmd-detail-label">${t('market.cmdCategory')}</div>
          <span class="cmd-detail-chip">${escapeHtml(cmd.category)}</span>
        </div>
      `);
    }

    if (cmd.tags && cmd.tags.length > 0) {
      const tagsHtml = cmd.tags.map((tag) => `<code class="cmd-detail-chip">${escapeHtml(tag)}</code>`).join(' ');
      sections.push(`
        <div class="cmd-detail-section">
          <div class="cmd-detail-label">${t('market.cmdTags')}</div>
          <div class="cmd-detail-chips">${tagsHtml}</div>
        </div>
      `);
    }

    if (cmd.examples && cmd.examples.length > 0) {
      const examplesHtml = cmd.examples.map((ex) => {
        const parts = ex.split(' # ');
        const code = parts[0];
        const comment = parts.length > 1 ? parts.slice(1).join(' # ') : '';
        return `<div class="cmd-detail-example"><code>${escapeHtml(code)}</code>${comment ? `<span class="cmd-example-comment"># ${escapeHtml(comment)}</span>` : ''}</div>`;
      }).join('');
      sections.push(`
        <div class="cmd-detail-section">
          <div class="cmd-detail-label">${t('market.cmdExamples')}</div>
          <div class="cmd-detail-examples">${examplesHtml}</div>
        </div>
      `);
    }

    if (cmd.hint) {
      sections.push(`
        <div class="cmd-detail-section">
          <div class="cmd-detail-label">${t('market.cmdHint')}</div>
          <div class="cmd-detail-hint">${escapeHtml(cmd.hint)}</div>
        </div>
      `);
    }

    return sections.join('');
  }

  private extractParams(usage: string): string[] {
    if (!usage) return [];
    const params: string[] = [];
    const regex = /(<[^>]+>|\[[^\]]+\]|\{[^}]+\})/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(usage)) !== null) {
      const p = match[1];
      if (!params.includes(p)) params.push(p);
    }
    return params;
  }

  private bindEvents() {
    this.body.querySelectorAll<HTMLElement>('[data-market-card]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const name = btn.dataset.marketCard || '';
        const lib = this.remoteLibraries.find((l) => l.name === name);
        if (!lib) return;
        this.activeLibrary = lib;
        this.activeCommandKey = null;
        this.previewCommands = [];
        await this.render();
        void this.loadPreview(lib);
      });
    });

    this.body.querySelectorAll<HTMLElement>('[data-market-cmd]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = el.dataset.marketCmd || '';
        if (this.activeCommandKey === key) return;
        this.activeCommandKey = key;
        const detailPane = this.body.querySelector('.market-cmd-detail-pane');
        if (detailPane) {
          detailPane.innerHTML = this.renderPreviewRight();
        }
        this.body.querySelectorAll<HTMLElement>('.market-cmd-list-item').forEach((btn) => {
          btn.classList.toggle('active', btn.dataset.marketCmd === key);
        });
      });
    });

    this.body.querySelector('#market-refresh')?.addEventListener('click', async () => {
      await this.reloadLocalLibraries();
      this.activeLibrary = null;
      this.previewCommands = [];
      await this.fetchRemoteList();
      await this.render();
    });

    this.body.querySelector('#market-search')?.addEventListener('input', (event) => {
      this.keyword = (event.target as HTMLInputElement).value.trim();
      if (this.searchTimer !== null) {
        window.clearTimeout(this.searchTimer);
      }
      this.searchTimer = window.setTimeout(async () => {
        await this.render();
      }, 180);
    });

    this.body.querySelector('[data-market-install]')?.addEventListener('click', async () => {
      const name = (this.body.querySelector('[data-market-install]') as HTMLElement)?.dataset.marketInstall || '';
      await this.installLibrary(name);
    });

    this.body.querySelector('[data-market-sync]')?.addEventListener('click', async () => {
      const name = (this.body.querySelector('[data-market-sync]') as HTMLElement)?.dataset.marketSync || '';
      await this.syncLibrary(name);
    });

    this.body.querySelector('[data-market-uninstall]')?.addEventListener('click', async () => {
      const name = (this.body.querySelector('[data-market-uninstall]') as HTMLElement)?.dataset.marketUninstall || '';
      await this.uninstallLibrary(name);
    });
  }

  private async loadPreview(lib: RemoteCommandLibrary) {
    this.loadingPreview = true;
    await this.render();

    try {
      let json: { commands?: CommandEntry[]; label?: string; kind?: string };
      if (isDevRuntime()) {
        const raw = await invoke<string>('read_bundled_command_file', { name: lib.name });
        json = JSON.parse(raw);
      } else {
        const url = `${RAW_BASE}/${lib.directory}/${lib.name}.json`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        json = await response.json();
      }
      const commands: CommandEntry[] = json.commands || [];
      this.previewCommands = commands;
      lib.commandCount = commands.length;
      lib.label = json.label || lib.name;
      lib.description = json.kind || '';
      lib.loaded = true;
    } catch (e) {
      this.previewCommands = [];
      this.errorMsg = t('market.loadFailed') + (e instanceof Error ? ` (${e.message})` : '');
    } finally {
      this.loadingPreview = false;
      await this.render();
    }
  }

  private async fetchLibraryJson(lib: RemoteCommandLibrary): Promise<string> {
    if (isDevRuntime()) {
      return await invoke<string>('read_bundled_command_file', { name: lib.name });
    }
    const url = `${RAW_BASE}/${lib.directory}/${lib.name}.json`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  }

  private async installLibrary(name: string) {
    const lib = this.remoteLibraries.find((l) => l.name === name);
    if (!lib) return;

    try {
      const json = await this.fetchLibraryJson(lib);
      await invoke('import_command_library', { json });
      await this.reloadLocalLibraries();
      lib.isInstalled = true;
      await this.onLibraryChanged?.();
      await this.render();
    } catch (error) {
      alert(t('cmd.importFailed', String(error)));
    }
  }

  private async syncLibrary(name: string) {
    const lib = this.remoteLibraries.find((l) => l.name === name);
    if (!lib) return;

    try {
      await invoke('delete_command_library', { libraryId: name });
      const json = await this.fetchLibraryJson(lib);
      await invoke('import_command_library', { json });
      await this.reloadLocalLibraries();
      lib.isInstalled = true;
      await this.onLibraryChanged?.();
      await this.render();
      const label = lib.label || lib.name;
      alert(t('market.syncSuccess', label));
    } catch (error) {
      alert(t('cmd.importFailed', String(error)));
    }
  }

  private async uninstallLibrary(name: string) {
    const lib = this.remoteLibraries.find((l) => l.name === name);
    if (!lib) return;

    const label = lib.label || lib.name;
    if (!confirm(t('market.uninstallConfirm', label))) return;

    try {
      await invoke('delete_command_library', { libraryId: name });
      await this.reloadLocalLibraries();
      lib.isInstalled = false;
      await this.onLibraryChanged?.();
      await this.render();
    } catch (error) {
      alert(t('cmd.importFailed', String(error)));
    }
  }
}

async function fetchDirectory(subdir: string): Promise<GithubContentEntry[]> {
  const url = `${COMMANDS_BASE}/${subdir}`;
  const response = await fetch(url);
  if (!response.ok) return [];
  const entries: GithubContentEntry[] = await response.json();
  return entries.filter((entry) => entry.type === 'file' && entry.name.endsWith('.json'));
}

function buildRemoteLibrary(
  entry: GithubContentEntry,
  directory: 'system' | 'custom',
  localIds: Set<string>
): RemoteCommandLibrary {
  const name = entry.name.replace(/\.json$/, '');
  return {
    name,
    path: entry.path,
    size: entry.size,
    sha: entry.sha,
    downloadUrl: entry.download_url || `${RAW_BASE}/${directory}/${entry.name}`,
    directory,
    isInstalled: localIds.has(name),
    commandCount: 0,
    label: formatTitle(name),
    description: '',
    loaded: false,
  };
}

function formatTitle(id: string): string {
  const titles: Record<string, string> = {
    darwin: 'macOS',
    linux: 'Linux',
    windows: 'Windows',
    ubuntu: 'Ubuntu',
    arch: 'Arch Linux',
  };
  return titles[id] || id.replace(/[-_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isDevRuntime(): boolean {
  return /localhost|127\.0\.0\.1/.test(window.location.hostname);
}

function shopIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path></svg>`;
}

function refreshIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 .49-9"></path></svg>`;
}

function downloadIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
}

function syncIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>`;
}

function deleteIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
}

function spinIcon(): string {
  return `<svg class="market-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>`;
}
