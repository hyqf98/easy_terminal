import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { t } from './i18n';
import type { SSHProfile, TerminalLaunchOptions } from './types';
import { openLocalFileEditor, openRemoteFileEditor } from './file-editor';

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number;
  icon: string;
}

interface TerminalContext {
  cwd: string;
  launchOptions: TerminalLaunchOptions;
}

interface TransferProgressPayload {
  direction: 'upload' | 'download';
  status: 'starting' | 'progress' | 'success' | 'error';
  fileName: string;
  detail: string;
  transferredBytes: number;
  totalBytes: number;
  progressPercent: number;
}

const INTERNAL_DRAG_MIME = 'application/x-easy_terminal-paths';

type FileTreeSource =
  | { kind: 'local' }
  | { kind: 'remote'; profileId: string; home: string };

type SortKey = 'name' | 'modified' | 'size';
type SortDirection = 'asc' | 'desc';

export class FileTree {
  private container: HTMLDivElement;
  private platform = '';
  private source: FileTreeSource = { kind: 'local' };
  private rootPath = '';
  private currentPath = '';
  private selectedPaths = new Set<string>();
  private lastClickedPath = '';
  private allVisibleItems: string[] = [];
  private contextMenu: HTMLDivElement | null = null;
  private filterTimer: ReturnType<typeof setTimeout> | null = null;
  private preFilterExpanded = new Map<string, boolean>();
  private createModal: HTMLDivElement | null = null;
  private sshProfiles: SSHProfile[] = [];
  private remoteHomeCache = new Map<string, string>();
  private sortKey: SortKey = 'name';
  private sortDirection: SortDirection = 'asc';
  private transferBar: HTMLDivElement | null = null;
  private transferHideTimer: number | null = null;
  private activeDropTargetPath = '';

  public onOpenTerminal?: (dirPath: string) => void;

  constructor(container: HTMLDivElement) {
    this.container = container;
    this.renderShell();
    this.bindShellEvents();
    this.createTransferBar();
    void this.bindTransferEvents();
    void this.bindWindowDragDrop();
    void this.init();
  }

  setSshProfiles(profiles: SSHProfile[]) {
    this.sshProfiles = profiles.map((profile) => ({ ...profile }));
  }

  async syncToTerminal(context: TerminalContext | null) {
    if (!context) {
      await this.ensureLocalRoot();
      return;
    }

    const cwd = context.cwd || '';
    if (context.launchOptions.mode === 'ssh' && context.launchOptions.profileId) {
      const profile = this.sshProfiles.find((entry) => entry.id === context.launchOptions.profileId);
      if (!profile) return;
      await this.switchToRemote(profile, cwd);
      return;
    }

    await this.switchToLocal(cwd);
  }

  async revealPath(path: string) {
    if (!path) return;
    if (this.source.kind !== 'local') {
      await this.switchToLocal(path);
      return;
    }
    await this.revealCurrentPath(path);
  }

  async refresh() {
    if (this.source.kind === 'remote') {
      const profile = this.getCurrentRemoteProfile();
      if (!profile) return;
      await this.switchToRemote(profile, this.currentPath || this.rootPath);
      return;
    }
    await this.switchToLocal(this.currentPath || this.rootPath);
  }

  private renderShell() {
    this.container.innerHTML = `
      <div class="panel-header">
        <h2>${folderHeaderSvg()} ${t('file.title')}</h2>
      </div>
      <div class="file-tree-filter" id="file-tree-filter">
        <input type="text" class="file-filter-input" placeholder="${t('file.filterPlaceholder')}" spellcheck="false" />
        <select class="file-sort-select" id="file-sort-select">
          <option value="name">${t('file.sortName')}</option>
          <option value="modified">${t('file.sortModified')}</option>
          <option value="size">${t('file.sortSize')}</option>
        </select>
        <button class="file-sort-order-btn" id="file-sort-order-btn" title="${t('file.sortDirection')}">↓</button>
      </div>
      <div class="file-tree-columns">
        <span class="file-col-name">${t('file.sortName')}</span>
        <span class="file-col-modified">${t('file.modified')}</span>
        <span class="file-col-size">${t('file.sortSize')}</span>
      </div>
      <div class="panel-body">
        <div class="file-tree" id="file-tree-body"></div>
      </div>
    `;
  }

  private bindShellEvents() {
    const filterInput = this.container.querySelector('.file-filter-input') as HTMLInputElement;
    const sortSelect = this.container.querySelector('#file-sort-select') as HTMLSelectElement;
    const sortDirectionBtn = this.container.querySelector('#file-sort-order-btn') as HTMLButtonElement;

    filterInput.addEventListener('input', () => {
      if (this.filterTimer) clearTimeout(this.filterTimer);
      this.filterTimer = setTimeout(() => this.applyFilter(), 150);
    });

    sortSelect.addEventListener('change', () => {
      this.sortKey = sortSelect.value as SortKey;
      this.refresh().catch(console.error);
    });

    sortDirectionBtn.addEventListener('click', () => {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
      sortDirectionBtn.textContent = this.sortDirection === 'asc' ? '↑' : '↓';
      this.refresh().catch(console.error);
    });

    document.addEventListener('click', (event) => {
      if (!(event.target as HTMLElement).closest('.file-tree') && !(event.target as HTMLElement).closest('.context-menu')) {
        this.clearSelection();
        this.closeContextMenu();
      }
    });
  }

  private get body(): HTMLDivElement {
    return this.container.querySelector('#file-tree-body') as HTMLDivElement;
  }

  private async init() {
    try {
      this.platform = await invoke<string>('get_os_platform');
      await this.ensureLocalRoot();
    } catch (error) {
      console.error('Failed to init file tree:', error);
    }
  }

  private async ensureLocalRoot() {
    await this.switchToLocal(this.currentPath && this.source.kind === 'local' ? this.currentPath : '');
  }

  private async switchToLocal(revealPath = '') {
    this.source = { kind: 'local' };
    this.selectedPaths.clear();
    this.lastClickedPath = '';

    if (this.platform === 'windows') {
      this.rootPath = '';
      this.currentPath = normalizePath(revealPath);
      await this.renderMultiRoot();
      if (revealPath) {
        await this.revealCurrentPath(revealPath);
      }
    } else {
      const home = await invoke<string>('get_home_dir');
      const normalizedTarget = normalizePath(revealPath || home);
      this.rootPath = normalizedTarget.startsWith(home) ? home : '/';
      this.currentPath = normalizedTarget;
      await this.renderLevel(this.body, this.rootPath, 0);
      if (revealPath) {
        await this.revealCurrentPath(revealPath);
      }
    }

    this.updateContextHeader();
  }

  private async switchToRemote(profile: SSHProfile, revealPath = '') {
    const home = this.remoteHomeCache.get(profile.id)
      || await invoke<string>('get_remote_home', { profile, profiles: this.sshProfiles });
    this.remoteHomeCache.set(profile.id, home);
    this.source = { kind: 'remote', profileId: profile.id, home };

    const normalizedTarget = normalizeRemotePath(revealPath || home);
    this.rootPath = normalizedTarget.startsWith(home) ? home : '/';
    this.currentPath = normalizedTarget;
    this.selectedPaths.clear();
    this.lastClickedPath = '';

    await this.renderLevel(this.body, this.rootPath, 0);
    if (revealPath) {
      await this.revealCurrentPath(revealPath);
    }

    this.updateContextHeader();
  }

  private updateContextHeader() {
    const sourceBadge = this.container.querySelector('#file-tree-source-badge') as HTMLDivElement | null;
    const pathLabel = this.container.querySelector('#file-tree-current-path') as HTMLDivElement | null;
    if (!sourceBadge || !pathLabel) return;

    if (this.source.kind === 'remote') {
      const profile = this.getCurrentRemoteProfile();
      sourceBadge.textContent = profile ? `SSH · ${profile.name}` : 'SSH';
      sourceBadge.dataset.source = 'remote';
    } else {
      sourceBadge.textContent = this.platform === 'windows' ? 'Local · Windows' : 'Local';
      sourceBadge.dataset.source = 'local';
    }

    pathLabel.textContent = this.currentPath || this.rootPath || '/';
    pathLabel.title = pathLabel.textContent;
  }

  private async renderMultiRoot() {
    const drives = await invoke<FileEntry[]>('list_drives');
    this.body.innerHTML = '';
    this.allVisibleItems = [];
    this.sortEntries(drives).forEach((drive) => {
      this.body.appendChild(this.createDriveRoot(drive));
      this.allVisibleItems.push(drive.path);
    });
  }

  private createDriveRoot(drive: FileEntry): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'tree-node';

    const item = this.createTreeItemElement(drive, 0, true);
    wrapper.appendChild(item);

    const children = document.createElement('div');
    children.className = 'tree-children collapsed';
    wrapper.appendChild(children);

    let loaded = false;
    let expanded = false;

    const toggleExpand = async () => {
      expanded = !expanded;
      item.querySelector('.tree-arrow')?.classList.toggle('expanded', expanded);
      this.setChildrenExpanded(children, drive.path, expanded);
      if (expanded && !loaded) {
        loaded = true;
        await this.renderLevel(children, drive.path, 1);
      }
    };

    item.querySelector('.tree-arrow')?.addEventListener('click', async (event) => {
      event.stopPropagation();
      await toggleExpand();
    });
    item.addEventListener('click', async (event) => {
      event.stopPropagation();
      this.handleClick(drive.path, event.shiftKey);
      this.currentPath = drive.path;
      await toggleExpand();
      this.updateContextHeader();
    });
    item.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.selectSinglePath(drive.path, item);
      this.showContextMenu(event.clientX, event.clientY, drive);
    });

    return wrapper;
  }

  private async renderLevel(parent: HTMLElement, dirPath: string, depth: number) {
    try {
      const entries = await this.loadEntries(dirPath);
      parent.innerHTML = '';
      this.allVisibleItems = this.allVisibleItems.filter((path) => !path.startsWith(`${dirPath}/`) && !path.startsWith(`${dirPath}\\`));
      entries.forEach((entry) => this.allVisibleItems.push(entry.path));
      entries.forEach((entry) => parent.appendChild(this.createItem(entry, depth)));
    } catch (error) {
      console.error('read dir error:', error);
      parent.innerHTML = `<div class="file-no-results">Failed to load: ${escapeHtml(String(error))}</div>`;
    }
  }

  private async loadEntries(dirPath: string): Promise<FileEntry[]> {
    let entries: FileEntry[];
    if (this.source.kind === 'remote') {
      const profile = this.getCurrentRemoteProfile();
      if (!profile) return [];
      entries = await invoke<FileEntry[]>('read_remote_dir', {
        profile,
        path: dirPath,
        profiles: this.sshProfiles,
      });
    } else {
      entries = await invoke<FileEntry[]>('read_dir', { path: dirPath });
    }

    return this.sortEntries(entries);
  }

  private sortEntries(entries: FileEntry[]): FileEntry[] {
    const sorted = [...entries];
    const direction = this.sortDirection === 'asc' ? 1 : -1;
    sorted.sort((left, right) => {
      if (left.is_dir !== right.is_dir) return Number(right.is_dir) - Number(left.is_dir);
      if (this.sortKey === 'modified') {
        return (left.modified - right.modified) * direction;
      }
      if (this.sortKey === 'size') {
        return (left.size - right.size) * direction;
      }
      return left.name.localeCompare(right.name, 'zh-CN') * direction;
    });
    return sorted;
  }

  private createItem(entry: FileEntry, depth: number): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'tree-node';

    const item = this.createTreeItemElement(entry, depth);
    wrapper.appendChild(item);

    if (entry.is_dir) {
      const children = document.createElement('div');
      children.className = 'tree-children collapsed';
      wrapper.appendChild(children);

      let loaded = false;
      let expanded = false;
      const toggleExpand = async () => {
        expanded = !expanded;
        item.querySelector('.tree-arrow')?.classList.toggle('expanded', expanded);
        this.setChildrenExpanded(children, entry.path, expanded);
        if (expanded && !loaded) {
          loaded = true;
          await this.renderLevel(children, entry.path, depth + 1);
        }
      };

      item.querySelector('.tree-arrow')?.addEventListener('click', async (event) => {
        event.stopPropagation();
        await toggleExpand();
      });
      item.addEventListener('click', async (event) => {
        event.stopPropagation();
        this.handleClick(entry.path, event.shiftKey);
        this.currentPath = entry.path;
        await toggleExpand();
        this.updateContextHeader();
      });
    } else {
      item.addEventListener('click', (event) => {
        event.stopPropagation();
        this.handleClick(entry.path, event.shiftKey);
        this.currentPath = entry.path;
        this.updateContextHeader();
      });
      item.addEventListener('dblclick', (event) => {
        event.stopPropagation();
        this.openFileInEditor(entry);
      });
    }

    item.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.selectSinglePath(entry.path, item);
      this.showContextMenu(event.clientX, event.clientY, entry);
    });

    item.draggable = true;
    item.addEventListener('dragstart', (event) => {
      if (!this.selectedPaths.has(entry.path)) {
        this.selectSinglePath(entry.path, item);
      }
      const payload = JSON.stringify([...this.selectedPaths]);
      event.dataTransfer?.setData(INTERNAL_DRAG_MIME, payload);
      event.dataTransfer?.setData('text/plain', payload);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });

    if (entry.is_dir) {
      item.addEventListener('dragover', (event) => {
        event.preventDefault();
        item.classList.add('drop-target');
      });
      item.addEventListener('dragleave', () => item.classList.remove('drop-target'));
      item.addEventListener('drop', async (event) => {
        event.preventDefault();
        item.classList.remove('drop-target');
        try {
          const data = event.dataTransfer?.getData(INTERNAL_DRAG_MIME)
            || event.dataTransfer?.getData('text/plain')
            || '';
          if (!data) return;
          const sources: string[] = JSON.parse(data);
          await this.moveSelectedEntriesTo(entry.path, sources);
        } catch (error) {
          console.error('Move failed:', error);
          alert(`移动失败: ${String(error)}`);
        }
      });
    }

    return wrapper;
  }

  private createTreeItemElement(entry: FileEntry, depth: number, isDriveRoot = false): HTMLDivElement {
    const item = document.createElement('div');
    item.className = 'tree-item';
    item.dataset.path = entry.path;
    item.dataset.isDir = String(entry.is_dir);
    item.style.paddingLeft = `${depth * 16 + 8}px`;
    if (this.selectedPaths.has(entry.path)) item.classList.add('selected');

    const arrow = document.createElement('span');
    arrow.className = `tree-arrow${entry.is_dir ? '' : ' empty'}`;
    arrow.innerHTML = entry.is_dir ? chevronSvg() : '';

    const icon = document.createElement('span');
    icon.className = 'tree-icon';
    icon.innerHTML = isDriveRoot ? driveIconSvg() : (entry.is_dir ? folderIconSvg() : fileIconSvg(entry.icon));

    const name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = entry.name;

    const modified = document.createElement('span');
    modified.className = 'tree-modified';
    modified.textContent = formatModified(entry.modified);
    modified.title = modified.textContent;

    const size = document.createElement('span');
    size.className = 'tree-size';
    size.textContent = entry.is_dir ? '目录' : formatBytes(entry.size);
    size.title = size.textContent;

    item.append(arrow, icon, name, modified, size);
    return item;
  }

  private openFileInEditor(entry: FileEntry) {
    if (entry.is_dir) return;
    if (this.source.kind === 'remote') {
      openRemoteFileEditor(entry.path, this.getRemoteProfile(), this.sshProfiles);
    } else {
      openLocalFileEditor(entry.path);
    }
  }

  private getRemoteProfile(): SSHProfile {
    const source = this.source as { kind: 'remote'; profileId: string; home: string };
    return this.sshProfiles.find((p) => p.id === source.profileId) || this.sshProfiles[0];
  }

  private handleClick(path: string, shiftKey: boolean) {
    if (shiftKey && this.lastClickedPath) {
      const startIdx = this.allVisibleItems.indexOf(this.lastClickedPath);
      const endIdx = this.allVisibleItems.indexOf(path);
      if (startIdx >= 0 && endIdx >= 0) {
        const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
        this.clearSelectionUI();
        this.selectedPaths.clear();
        for (let index = lo; index <= hi; index += 1) {
          const targetPath = this.allVisibleItems[index];
          this.selectedPaths.add(targetPath);
          const el = this.container.querySelector(`[data-path="${CSS.escape(targetPath)}"]`);
          if (el) {
            el.classList.add('selected', 'shift-selected');
          }
        }
      }
    } else {
      this.clearSelectionUI();
      this.selectedPaths.clear();
      this.selectedPaths.add(path);
      this.container.querySelector(`[data-path="${CSS.escape(path)}"]`)?.classList.add('selected');
    }

    this.lastClickedPath = path;
    this.closeContextMenu();
  }

  private selectSinglePath(path: string, item: HTMLElement) {
    this.clearSelectionUI();
    this.selectedPaths.clear();
    this.selectedPaths.add(path);
    this.lastClickedPath = path;
    item.classList.add('selected');
  }

  private clearSelection() {
    this.clearSelectionUI();
    this.selectedPaths.clear();
    this.lastClickedPath = '';
  }

  private clearSelectionUI() {
    this.container.querySelectorAll('.tree-item.selected, .tree-item.shift-selected').forEach((element) => {
      element.classList.remove('selected', 'shift-selected');
    });
  }

  private showContextMenu(x: number, y: number, entry: FileEntry) {
    this.closeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    if (this.source.kind === 'remote') {
      menu.appendChild(this.menuItem('下载到本地', downloadSvg(), async () => {
        await this.downloadSelectedRemoteEntries();
        this.closeContextMenu();
      }));
      menu.appendChild(this.menuSeparator());
      menu.appendChild(this.menuItem(t('file.rename'), renameSvg(), () => {
        this.startRename(entry);
        this.closeContextMenu();
      }));
      menu.appendChild(this.menuItem(`${t('file.delete')} (${this.selectedPaths.size})`, trashSvg(), async () => {
        await this.deleteSelected();
        this.closeContextMenu();
      }, true));
      menu.appendChild(this.menuSeparator());
      menu.appendChild(this.menuItem('刷新目录', refreshSvg(), async () => {
        await this.refresh();
        this.closeContextMenu();
      }));
    } else {
      const dirPath = entry.is_dir ? entry.path : parentPath(entry.path, this.platform);
      if (entry.is_dir) {
        menu.appendChild(this.menuItem(t('file.openInTerminal'), terminalSvg(), async () => {
          this.onOpenTerminal?.(entry.path);
          this.closeContextMenu();
        }));
        menu.appendChild(this.menuSeparator());
      }
      menu.appendChild(this.menuItem(t('file.newFile'), filePlusSvg(), () => {
        this.openCreateDialog(dirPath, false);
        this.closeContextMenu();
      }));
      menu.appendChild(this.menuItem(t('file.newFolder'), folderPlusSvg(), () => {
        this.openCreateDialog(dirPath, true);
        this.closeContextMenu();
      }));
      menu.appendChild(this.menuSeparator());
      menu.appendChild(this.menuItem(t('file.rename'), renameSvg(), () => {
        this.startRename(entry);
        this.closeContextMenu();
      }));
      menu.appendChild(this.menuItem(`${t('file.delete')} (${this.selectedPaths.size})`, trashSvg(), async () => {
        await this.deleteSelected();
        this.closeContextMenu();
      }, true));
    }

    document.body.appendChild(menu);
    this.contextMenu = menu;

    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = `${x - rect.width}px`;
    if (rect.bottom > window.innerHeight) menu.style.top = `${y - rect.height}px`;
  }

  private menuItem(label: string, icon: string, action: () => void, danger = false): HTMLDivElement {
    const item = document.createElement('div');
    item.className = `context-menu-item${danger ? ' danger' : ''}`;
    item.innerHTML = `${icon}<span>${label}</span>`;
    item.addEventListener('click', action);
    return item;
  }

  private menuSeparator(): HTMLDivElement {
    const separator = document.createElement('div');
    separator.className = 'context-menu-separator';
    return separator;
  }

  private closeContextMenu() {
    if (!this.contextMenu) return;
    this.contextMenu.remove();
    this.contextMenu = null;
  }

  private openCreateDialog(parentDir: string, isDir: boolean) {
    if (this.source.kind === 'remote') return;
    this.closeCreateDialog();

    const overlay = document.createElement('div');
    overlay.className = 'cmd-overlay file-create-overlay';
    overlay.innerHTML = `
      <div class="cmd-overlay-card file-create-card">
        <div class="cmd-overlay-title">${isDir ? t('file.newFolder') : t('file.newFile')}</div>
        <div class="cmd-overlay-subtitle">${escapeHtml(parentDir)}</div>
        <label class="cmd-field">
          <span>${isDir ? t('file.folderName') : t('file.fileName')}</span>
          <input id="file-create-name" type="text" spellcheck="false" autocomplete="off" />
        </label>
        <div class="cmd-overlay-actions">
          <button class="cmd-toolbar-btn primary" id="file-create-confirm">${isDir ? t('file.newFolder') : t('file.newFile')}</button>
          <button class="cmd-toolbar-btn" id="file-create-cancel">${t('cmd.cancel')}</button>
        </div>
      </div>
    `;

    const input = overlay.querySelector('#file-create-name') as HTMLInputElement;
    overlay.querySelector('#file-create-confirm')?.addEventListener('click', async () => {
      await this.submitCreate(parentDir, isDir, input.value);
    });
    overlay.querySelector('#file-create-cancel')?.addEventListener('click', () => this.closeCreateDialog());
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) this.closeCreateDialog();
    });
    input.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        await this.submitCreate(parentDir, isDir, input.value);
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeCreateDialog();
      }
    });

    document.body.appendChild(overlay);
    this.createModal = overlay;
    setTimeout(() => input.focus(), 0);
  }

  private async submitCreate(parentDir: string, isDir: boolean, rawName: string) {
    const name = rawName.trim();
    if (!name) return;
    const separator = parentDir.includes('\\') ? '\\' : '/';
    const fullPath = `${parentDir.replace(/[\\/]+$/, '')}${separator}${name}`;
    try {
      await invoke(isDir ? 'create_dir' : 'create_file', { path: fullPath });
      this.closeCreateDialog();
      await this.refresh();
    } catch (error) {
      alert(t('file.createFailed', String(error)));
    }
  }

  private closeCreateDialog() {
    if (!this.createModal) return;
    this.createModal.remove();
    this.createModal = null;
  }

  private startRename(entry: FileEntry) {
    const item = this.container.querySelector(`[data-path="${CSS.escape(entry.path)}"]`);
    if (!item) return;
    const nameEl = item.querySelector('.tree-name') as HTMLSpanElement | null;
    if (!nameEl) return;

    const input = document.createElement('input');
    input.className = 'tree-name-input';
    input.value = entry.name;
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    const finish = async () => {
      const newName = input.value.trim();
      if (newName && newName !== entry.name) {
        const parentDir = parentPath(entry.path, this.source.kind === 'remote' ? 'unix' : this.platform);
        const newPath = joinPath(parentDir, newName, this.source.kind === 'remote' ? 'unix' : this.platform);
        try {
          if (this.source.kind === 'remote') {
            const profile = this.getCurrentRemoteProfile();
            if (!profile) throw new Error('missing remote profile');
            await invoke('rename_remote_entry', {
              profile,
              oldPath: entry.path,
              newPath,
              profiles: this.sshProfiles,
            });
          } else {
            await invoke('rename_entry', { oldPath: entry.path, newPath });
          }
        } catch (error) {
          alert(t('file.renameFailed', String(error)));
        }
      }
      await this.refresh();
    };

    input.addEventListener('blur', () => { void finish(); });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
      if (event.key === 'Escape') { input.value = entry.name; input.blur(); }
    });
  }

  private async deleteSelected() {
    const paths = [...this.selectedPaths];
    if (paths.length === 0) return;
    const message = paths.length === 1
      ? t('file.confirmDelete', paths[0].split(/[\\/]/).pop() || '')
      : t('file.confirmDeleteMulti', String(paths.length));
    if (!confirm(message)) return;
    try {
      if (this.source.kind === 'remote') {
        const profile = this.getCurrentRemoteProfile();
        if (!profile) throw new Error('missing remote profile');
        await invoke('delete_remote_entries', {
          profile,
          paths,
          profiles: this.sshProfiles,
        });
      } else {
        await invoke('delete_entries', { paths });
      }
      this.selectedPaths.clear();
      await this.refresh();
    } catch (error) {
      alert(t('file.deleteFailed', String(error)));
    }
  }

  private async revealCurrentPath(path: string) {
    const normalized = this.source.kind === 'remote' ? normalizeRemotePath(path) : normalizePath(path);
    if (!normalized) return;

    const segments = splitPathSegments(normalized, this.source.kind === 'remote' ? 'unix' : this.platform);
    let currentPath = this.platform === 'windows' && this.source.kind === 'local'
      ? segments[0]
      : this.rootPath || '/';
    let currentContainer: HTMLElement = this.body;

    if (this.platform === 'windows' && this.source.kind === 'local') {
      const rootItem = this.container.querySelector(`[data-path="${CSS.escape(currentPath)}"]`) as HTMLElement | null;
      if (!rootItem) return;
      await this.ensureExpanded(rootItem, currentPath, currentContainer);
      currentContainer = rootItem.parentElement?.querySelector(':scope > .tree-children') as HTMLElement || currentContainer;
    }

    for (const segment of segments.slice(this.platform === 'windows' && this.source.kind === 'local' ? 1 : startUnixIndex(segments, currentPath))) {
      currentPath = joinPath(currentPath, segment, this.source.kind === 'remote' ? 'unix' : this.platform);
      let item = this.container.querySelector(`[data-path="${CSS.escape(currentPath)}"]`) as HTMLElement | null;
      if (!item) {
        await this.renderLevel(currentContainer, parentPath(currentPath, this.source.kind === 'remote' ? 'unix' : this.platform), depthFromContainer(currentContainer));
        item = this.container.querySelector(`[data-path="${CSS.escape(currentPath)}"]`) as HTMLElement | null;
      }
      if (!item) break;

      if (item.dataset.isDir === 'true') {
        await this.ensureExpanded(item, currentPath, currentContainer);
        currentContainer = item.parentElement?.querySelector(':scope > .tree-children') as HTMLElement || currentContainer;
      }
    }

    const target = this.container.querySelector(`[data-path="${CSS.escape(normalized)}"]`) as HTMLElement | null;
    if (target) {
      this.clearSelectionUI();
      this.selectedPaths.clear();
      this.selectedPaths.add(normalized);
      this.lastClickedPath = normalized;
      target.classList.add('selected');
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      this.currentPath = normalized;
      this.updateContextHeader();
    }
  }

  private applyFilter() {
    const query = (this.container.querySelector('.file-filter-input') as HTMLInputElement | null)?.value.trim().toLowerCase() || '';
    const body = this.body;
    body.querySelector('.file-no-results')?.remove();

    const allItems = body.querySelectorAll('.tree-item') as NodeListOf<HTMLElement>;
    if (!query) {
      this.restoreFilterState();
      allItems.forEach((element) => { element.style.display = ''; });
      return;
    }

    if (this.preFilterExpanded.size === 0) {
      body.querySelectorAll<HTMLElement>('.tree-children').forEach((children) => {
        const parentItem = children.previousElementSibling as HTMLElement | null;
        const path = parentItem?.dataset.path;
        if (path) {
          this.preFilterExpanded.set(path, !children.classList.contains('collapsed'));
        }
      });
    }

    const matchedPaths = new Set<string>();
    allItems.forEach((element) => {
      const name = (element.querySelector('.tree-name')?.textContent || '').toLowerCase();
      if (name.includes(query)) {
        const path = element.dataset.path || '';
        matchedPaths.add(path);
        let parent = element.parentElement;
        while (parent && parent !== body) {
          if (parent.classList.contains('tree-node')) {
            const parentItem = parent.querySelector(':scope > .tree-item') as HTMLElement | null;
            if (parentItem?.dataset.path) matchedPaths.add(parentItem.dataset.path);
          }
          parent = parent.parentElement;
        }
      }
    });

    allItems.forEach((element) => {
      element.style.display = matchedPaths.has(element.dataset.path || '') ? '' : 'none';
    });

    body.querySelectorAll<HTMLElement>('.tree-children').forEach((children) => {
      const parentItem = children.previousElementSibling as HTMLElement | null;
      if (parentItem && matchedPaths.has(parentItem.dataset.path || '')) {
        children.style.display = '';
        children.classList.remove('collapsed');
        parentItem.querySelector('.tree-arrow')?.classList.add('expanded');
      } else {
        children.style.display = 'none';
      }
    });

    if (matchedPaths.size === 0) {
      const empty = document.createElement('div');
      empty.className = 'file-no-results';
      empty.textContent = t('file.noResults');
      body.appendChild(empty);
    }
  }

  private setChildrenExpanded(children: HTMLElement, path: string, expanded: boolean) {
    children.classList.toggle('collapsed', !expanded);
    children.dataset.path = path;
  }

  private restoreFilterState() {
    this.body.querySelectorAll<HTMLElement>('.tree-children').forEach((children) => {
      children.style.display = '';
      const parentItem = children.previousElementSibling as HTMLElement | null;
      const path = parentItem?.dataset.path;
      const wasExpanded = path ? this.preFilterExpanded.get(path) : undefined;
      if (wasExpanded === undefined) return;
      children.classList.toggle('collapsed', !wasExpanded);
      parentItem?.querySelector('.tree-arrow')?.classList.toggle('expanded', wasExpanded);
    });
    this.preFilterExpanded.clear();
  }

  private async ensureExpanded(item: HTMLElement, path: string, parentContainer: HTMLElement) {
    const children = item.parentElement?.querySelector(':scope > .tree-children') as HTMLElement | null;
    if (!children) return;
    children.classList.remove('collapsed');
    item.querySelector('.tree-arrow')?.classList.add('expanded');
    if (children.children.length === 0) {
      await this.renderLevel(children, path, depthFromContainer(parentContainer) + 1);
    }
  }

  private getCurrentRemoteProfile(): SSHProfile | null {
    if (this.source.kind !== 'remote') return null;
    const { profileId } = this.source;
    return this.sshProfiles.find((profile) => profile.id === profileId) || null;
  }

  private async downloadSelectedRemoteEntries() {
    if (this.source.kind !== 'remote') return;
    const profile = this.getCurrentRemoteProfile();
    if (!profile) return;
    const remotePaths = [...this.selectedPaths];
    if (remotePaths.length === 0) return;

    const localDir = await open({
      title: '选择本地下载目录',
      directory: true,
      multiple: false,
    });
    if (!localDir || Array.isArray(localDir)) return;

    await invoke('download_remote_entries', {
      profile,
      remotePaths,
      localDir,
      profiles: this.sshProfiles,
    });
  }

  private async uploadLocalEntriesToRemote(localPaths: string[], remoteDir: string) {
    if (this.source.kind !== 'remote') return;
    const profile = this.getCurrentRemoteProfile();
    if (!profile || localPaths.length === 0) return;

    try {
      await invoke('upload_local_entries', {
        profile,
        localPaths,
        remoteDir,
        profiles: this.sshProfiles,
      });
      await this.refresh();
    } catch (error) {
      this.updateTransferBar({
        direction: 'upload',
        status: 'error',
        fileName: localPaths[0] || '',
        detail: `上传失败: ${String(error)}`,
        transferredBytes: 0,
        totalBytes: 0,
        progressPercent: 0,
      });
    }
  }

  private async moveSelectedEntriesTo(destDir: string, sources: string[]) {
    if (!destDir || sources.length === 0) return;
    const normalizedDest = this.source.kind === 'remote' ? normalizeRemotePath(destDir) : normalizePath(destDir);
    const normalizedSources = sources.map((source) => (
      this.source.kind === 'remote' ? normalizeRemotePath(source) : normalizePath(source)
    ));
    const filtered = normalizedSources.filter((source) => source && source !== normalizedDest && !this.isAncestorPath(source, normalizedDest));
    if (filtered.length === 0) return;

    if (this.source.kind === 'remote') {
      const profile = this.getCurrentRemoteProfile();
      if (!profile) return;
      await invoke('move_remote_entries', {
        profile,
        sources: filtered,
        destDir: normalizedDest,
        profiles: this.sshProfiles,
      });
    } else {
      await invoke('move_entries', { sources: filtered, destDir: normalizedDest });
    }
    await this.refresh();
  }

  private isAncestorPath(ancestor: string, target: string): boolean {
    if (!ancestor || !target || ancestor === target) return false;
    const normalizedAncestor = this.source.kind === 'remote' ? normalizeRemotePath(ancestor) : normalizePath(ancestor);
    const normalizedTarget = this.source.kind === 'remote' ? normalizeRemotePath(target) : normalizePath(target);
    const separator = this.source.kind === 'remote' ? '/' : (this.platform === 'windows' ? '\\' : '/');
    return normalizedTarget.startsWith(`${normalizedAncestor}${separator}`);
  }

  private createTransferBar() {
    if (this.transferBar) return;
    const bar = document.createElement('div');
    bar.className = 'file-transfer-bar hidden';
    bar.innerHTML = `
      <div class="file-transfer-head">
        <span class="file-transfer-title">传输任务</span>
        <span class="file-transfer-percent">0%</span>
      </div>
      <div class="file-transfer-detail">等待任务</div>
      <div class="file-transfer-track">
        <div class="file-transfer-fill"></div>
      </div>
    `;
    document.body.appendChild(bar);
    this.transferBar = bar;
  }

  private async bindTransferEvents() {
    await listen<TransferProgressPayload>('file-transfer-progress', ({ payload }) => {
      this.updateTransferBar(payload);
    });
  }

  private updateTransferBar(payload: TransferProgressPayload) {
    if (!this.transferBar) return;
    if (this.transferHideTimer !== null) {
      window.clearTimeout(this.transferHideTimer);
      this.transferHideTimer = null;
    }

    this.transferBar.classList.remove('hidden', 'error', 'success');
    this.transferBar.classList.toggle('error', payload.status === 'error');
    this.transferBar.classList.toggle('success', payload.status === 'success');

    const title = this.transferBar.querySelector('.file-transfer-title') as HTMLSpanElement;
    const percent = this.transferBar.querySelector('.file-transfer-percent') as HTMLSpanElement;
    const detail = this.transferBar.querySelector('.file-transfer-detail') as HTMLDivElement;
    const fill = this.transferBar.querySelector('.file-transfer-fill') as HTMLDivElement;

    title.textContent = payload.direction === 'upload' ? '远程上传' : '远程下载';
    percent.textContent = `${payload.progressPercent}%`;
    detail.textContent = `${payload.detail} · ${shortName(payload.fileName)} · ${formatBytes(payload.transferredBytes)} / ${formatBytes(payload.totalBytes)}`;
    fill.style.width = `${Math.max(0, Math.min(payload.progressPercent, 100))}%`;

    if (payload.status === 'success' || payload.status === 'error') {
      this.transferHideTimer = window.setTimeout(() => {
        this.transferBar?.classList.add('hidden');
      }, 2800);
    }
  }

  private async bindWindowDragDrop() {
    const appWindow = getCurrentWindow();
    await appWindow.onDragDropEvent(async (event) => {
      if (this.source.kind !== 'remote') return;

      if (event.payload.type === 'leave') {
        this.highlightDropTarget('');
        return;
      }

      if (event.payload.type === 'enter' || event.payload.type === 'over') {
        const target = this.resolveDropTargetFromPoint(event.payload.position.x, event.payload.position.y);
        this.highlightDropTarget(target);
        return;
      }

      if (event.payload.type === 'drop') {
        const target = this.resolveDropTargetFromPoint(event.payload.position.x, event.payload.position.y)
          || this.currentPath
          || this.rootPath;
        this.highlightDropTarget('');
        await this.uploadLocalEntriesToRemote(event.payload.paths, target);
      }
    });
  }

  private resolveDropTargetFromPoint(physicalX: number, physicalY: number): string {
    const scale = window.devicePixelRatio || 1;
    const element = document.elementFromPoint(physicalX / scale, physicalY / scale) as HTMLElement | null;
    const item = element?.closest('.tree-item') as HTMLElement | null;
    if (!item || !this.container.contains(item)) return '';
    const path = item.dataset.path || '';
    if (!path) return '';
    if (item.dataset.isDir === 'true') return path;
    return parentPath(path, 'unix');
  }

  private highlightDropTarget(path: string) {
    if (this.activeDropTargetPath === path) return;
    if (this.activeDropTargetPath) {
      this.container.querySelector(`[data-path="${CSS.escape(this.activeDropTargetPath)}"]`)?.classList.remove('drop-target');
    }
    this.activeDropTargetPath = path;
    if (path) {
      this.container.querySelector(`[data-path="${CSS.escape(path)}"]`)?.classList.add('drop-target');
    }
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function normalizePath(path: string): string {
  if (!path) return '';
  if (/^[A-Za-z]:[\\/]/.test(path)) {
    const normalized = path.replace(/\//g, '\\');
    return /^[A-Za-z]:\\$/.test(normalized) ? normalized : normalized.replace(/\\+$/, '');
  }
  return path.replace(/\/+$/, '') || '/';
}

function normalizeRemotePath(path: string): string {
  if (!path) return '/';
  const normalized = path.replace(/\\/g, '/');
  return normalized === '/' ? '/' : normalized.replace(/\/+$/, '') || '/';
}

function splitPathSegments(path: string, platform: string): string[] {
  if (platform === 'windows') {
    const match = path.match(/^[A-Za-z]:\\/);
    const root = match?.[0] || '';
    const rest = path.slice(root.length).split(/\\+/).filter(Boolean);
    return [root, ...rest];
  }
  return path.split('/').filter(Boolean);
}

function joinPath(base: string, segment: string, platform: string): string {
  if (platform === 'windows') {
    return base.endsWith('\\') ? `${base}${segment}` : `${base}\\${segment}`;
  }
  if (base === '/') return `/${segment}`;
  return `${base}/${segment}`;
}

function parentPath(path: string, platform: string): string {
  if (platform === 'windows') {
    return path.replace(/\\[^\\]+$/, '') || path;
  }
  return path.replace(/\/[^/]+$/, '') || '/';
}

function depthFromContainer(container: HTMLElement): number {
  const parentItem = container.previousElementSibling as HTMLElement | null;
  if (!parentItem) return 0;
  const padding = Number.parseInt(parentItem.style.paddingLeft || '8', 10);
  return Math.max(0, Math.round((padding - 8) / 16) + 1);
}

function startUnixIndex(_segments: string[], currentPath: string): number {
  if (currentPath === '/') return 0;
  return currentPath.split('/').filter(Boolean).length;
}

function formatModified(value: number): string {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value * 1000));
  } catch {
    return '-';
  }
}

function formatBytes(size: number): string {
  if (!size) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = size;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 100 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function shortName(path: string): string {
  if (!path) return '-';
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function folderHeaderSvg(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
}

function driveIconSvg(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"></rect><circle cx="17" cy="14" r="1.5" fill="var(--accent)" stroke="none"></circle><line x1="6" y1="14" x2="12" y2="14"></line></svg>`;
}

function chevronSvg(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
}

function folderIconSvg(): string {
  return `<svg viewBox="0 0 24 24" fill="var(--yellow)" stroke="var(--yellow)" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
}

function fileIconSvg(iconType: string): string {
  const colors: Record<string, string> = {
    typescript: '#3178c6',
    javascript: '#f7df1e',
    rust: '#dea584',
    python: '#3572a5',
    css: '#563d7c',
    html: '#e34c26',
    json: '#a6e3a1',
    markdown: '#585b70',
    config: '#585b70',
    image: '#f38ba8',
    executable: '#a6e3a1',
    archive: '#f9e2af',
    file: '#585b70',
  };
  const color = colors[iconType] || colors.file;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`;
}

function terminalSvg(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>`;
}

function filePlusSvg(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg>`;
}

function folderPlusSvg(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><line x1="12" y1="11" x2="12" y2="17"></line><line x1="9" y1="14" x2="15" y2="14"></line></svg>`;
}

function renameSvg(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`;
}

function trashSvg(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
}

function downloadSvg(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
}

function refreshSvg(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10"></path><path d="M20.49 15A9 9 0 0 1 6.36 18.36L1 14"></path></svg>`;
}
