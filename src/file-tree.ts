import { invoke } from '@tauri-apps/api/core';

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number;
  icon: string;
}

export class FileTree {
  private container: HTMLDivElement;
  private platform = '';
  private selectedPaths = new Set<string>();
  private lastClickedPath = '';
  private allVisibleItems: string[] = [];
  private contextMenu: HTMLDivElement | null = null;

  public onOpenTerminal?: (dirPath: string) => void;

  constructor(container: HTMLDivElement) {
    this.container = container;
    this.container.innerHTML = `
      <div class="panel-header">
        <h2>${folderHeaderSvg()} 文件管理</h2>
      </div>
      <div class="panel-body" id="file-tree-body"></div>
    `;

    document.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('.file-tree') && !(e.target as HTMLElement).closest('.context-menu')) {
        this.clearSelection();
        this.closeContextMenu();
      }
    });

    this.init();
  }

  private get body(): HTMLDivElement {
    return this.container.querySelector('#file-tree-body') as HTMLDivElement;
  }

  private async init() {
    try {
      this.platform = await invoke<string>('get_os_platform');
      if (this.platform === 'windows') {
        const drives = await invoke<FileEntry[]>('list_drives');
        this.renderMultiRoot(drives);
      } else {
        const home = await invoke<string>('get_home_dir');
        await this.renderLevel(this.body, home, 0);
      }
    } catch (e) {
      console.error('Failed to init file tree:', e);
    }
  }

  private renderMultiRoot(drives: FileEntry[]) {
    this.body.innerHTML = '';
    this.allVisibleItems = [];
    for (const drive of drives) {
      const item = this.createDriveRoot(drive);
      this.body.appendChild(item);
      this.allVisibleItems.push(drive.path);
    }
  }

  private createDriveRoot(drive: FileEntry): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'tree-node';

    const item = document.createElement('div');
    item.className = 'tree-item tree-drive-root';
    item.dataset.path = drive.path;
    item.dataset.isDir = 'true';
    item.style.paddingLeft = '8px';

    // Arrow
    const arrow = document.createElement('span');
    arrow.className = 'tree-arrow';
    arrow.innerHTML = chevronSvg();
    item.appendChild(arrow);

    // Drive icon
    const icon = document.createElement('span');
    icon.className = 'tree-icon';
    icon.innerHTML = driveIconSvg();
    item.appendChild(icon);

    // Name
    const name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = drive.name;
    item.appendChild(name);

    wrapper.appendChild(item);

    // Children container
    const children = document.createElement('div');
    children.className = 'tree-children collapsed';
    wrapper.appendChild(children);

    let loaded = false;
    let expanded = false;

    const toggleExpand = async () => {
      expanded = !expanded;
      arrow.classList.toggle('expanded', expanded);
      children.classList.toggle('collapsed', !expanded);
      if (!loaded) {
        loaded = true;
        await this.renderLevel(children, drive.path, 1);
      }
    };

    arrow.addEventListener('click', async (e) => { e.stopPropagation(); await toggleExpand(); });
    item.addEventListener('dblclick', async () => { if (!expanded) await toggleExpand(); });

    // Click to select
    item.addEventListener('click', (e) => { e.stopPropagation(); this.handleClick(drive.path, e.shiftKey); });

    // Right-click
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!this.selectedPaths.has(drive.path)) {
        this.clearSelection();
        this.selectedPaths.add(drive.path);
        item.classList.add('selected');
      }
      this.showContextMenu(e.clientX, e.clientY, drive);
    });

    // Drop target
    item.addEventListener('dragover', (e) => { e.preventDefault(); item.classList.add('drop-target'); });
    item.addEventListener('dragleave', () => { item.classList.remove('drop-target'); });
    item.addEventListener('drop', async (e) => {
      e.preventDefault();
      item.classList.remove('drop-target');
      try {
        const data = e.dataTransfer!.getData('text/plain');
        const sources: string[] = JSON.parse(data);
        await invoke('move_entries', { sources, destDir: drive.path });
        this.refresh();
      } catch (err) { console.error('Move failed:', err); }
    });

    return wrapper;
  }

  private async renderLevel(parent: HTMLElement, dirPath: string, depth: number) {
    try {
      const entries = await invoke<FileEntry[]>('read_dir', { path: dirPath });
      parent.innerHTML = '';
      for (const entry of entries) {
        this.allVisibleItems.push(entry.path);
      }
      for (const entry of entries) {
        const item = this.createItem(entry, depth);
        parent.appendChild(item);
      }
    } catch (e) {
      console.error('read_dir error:', e);
      parent.innerHTML = `<div style="padding:8px;color:var(--text-muted);font-size:12px;">Failed to load</div>`;
    }
  }

  private createItem(entry: FileEntry, depth: number): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'tree-node';

    const item = document.createElement('div');
    item.className = 'tree-item';
    if (this.selectedPaths.has(entry.path)) item.classList.add('selected');
    item.dataset.path = entry.path;
    item.dataset.isDir = String(entry.is_dir);
    item.style.paddingLeft = `${depth * 16 + 8}px`;

    const arrow = document.createElement('span');
    arrow.className = 'tree-arrow' + (entry.is_dir ? '' : ' empty');
    arrow.innerHTML = entry.is_dir ? chevronSvg() : '';
    item.appendChild(arrow);

    const icon = document.createElement('span');
    icon.className = 'tree-icon';
    icon.innerHTML = entry.is_dir ? folderIconSvg() : fileIconSvg(entry.icon);
    item.appendChild(icon);

    const name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = entry.name;
    item.appendChild(name);

    wrapper.appendChild(item);

    if (entry.is_dir) {
      const children = document.createElement('div');
      children.className = 'tree-children collapsed';
      wrapper.appendChild(children);

      let loaded = false;
      let expanded = false;

      arrow.addEventListener('click', async (e) => {
        e.stopPropagation();
        expanded = !expanded;
        arrow.classList.toggle('expanded', expanded);
        children.classList.toggle('collapsed', !expanded);
        if (!loaded) {
          loaded = true;
          await this.renderLevel(children, entry.path, depth + 1);
        }
      });

      item.addEventListener('dblclick', async () => {
        if (!expanded) {
          expanded = true;
          arrow.classList.add('expanded');
          children.classList.remove('collapsed');
          if (!loaded) {
            loaded = true;
            await this.renderLevel(children, entry.path, depth + 1);
          }
        }
      });
    }

    item.addEventListener('click', (e) => { e.stopPropagation(); this.handleClick(entry.path, e.shiftKey); });

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!this.selectedPaths.has(entry.path)) {
        this.clearSelection();
        this.selectedPaths.add(entry.path);
        item.classList.add('selected');
      }
      this.showContextMenu(e.clientX, e.clientY, entry);
    });

    item.draggable = true;
    item.addEventListener('dragstart', (e) => {
      if (!this.selectedPaths.has(entry.path)) {
        this.clearSelection();
        this.selectedPaths.add(entry.path);
        item.classList.add('selected');
      }
      e.dataTransfer!.setData('text/plain', JSON.stringify([...this.selectedPaths]));
      e.dataTransfer!.effectAllowed = 'move';
    });

    if (entry.is_dir) {
      item.addEventListener('dragover', (e) => { e.preventDefault(); item.classList.add('drop-target'); });
      item.addEventListener('dragleave', () => { item.classList.remove('drop-target'); });
      item.addEventListener('drop', async (e) => {
        e.preventDefault();
        item.classList.remove('drop-target');
        try {
          const data = e.dataTransfer!.getData('text/plain');
          const sources: string[] = JSON.parse(data);
          await invoke('move_entries', { sources, destDir: entry.path });
          this.refresh();
        } catch (err) { console.error('Move failed:', err); }
      });
    }

    return wrapper;
  }

  private handleClick(path: string, shiftKey: boolean) {
    if (shiftKey && this.lastClickedPath) {
      const startIdx = this.allVisibleItems.indexOf(this.lastClickedPath);
      const endIdx = this.allVisibleItems.indexOf(path);
      if (startIdx >= 0 && endIdx >= 0) {
        const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
        this.clearSelectionUI();
        this.selectedPaths.clear();
        for (let i = lo; i <= hi; i++) {
          this.selectedPaths.add(this.allVisibleItems[i]);
          const el = this.container.querySelector(`[data-path="${CSS.escape(this.allVisibleItems[i])}"]`);
          if (el) { el.classList.add('selected'); el.classList.add('shift-selected'); }
        }
      }
    } else {
      this.clearSelectionUI();
      this.selectedPaths.clear();
      this.selectedPaths.add(path);
      const el = this.container.querySelector(`[data-path="${CSS.escape(path)}"]`);
      if (el) el.classList.add('selected');
    }
    this.lastClickedPath = path;
    this.closeContextMenu();
  }

  private clearSelection() { this.clearSelectionUI(); this.selectedPaths.clear(); this.lastClickedPath = ''; }

  private clearSelectionUI() {
    this.container.querySelectorAll('.tree-item.selected, .tree-item.shift-selected').forEach((el) => {
      el.classList.remove('selected', 'shift-selected');
    });
  }

  private showContextMenu(x: number, y: number, entry: FileEntry) {
    this.closeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    const dirPath = entry.is_dir ? entry.path : entry.path.replace(/[\\/][^\\/]+$/, '');

    if (entry.is_dir) {
      menu.appendChild(this.menuItem('在终端中打开', terminalSvg(), async () => {
        this.onOpenTerminal?.(entry.path);
        this.closeContextMenu();
      }));
      menu.appendChild(this.menuSeparator());
    }

    menu.appendChild(this.menuItem('新建文件', filePlusSvg(), async () => {
      await this.promptCreate(dirPath, false);
      this.closeContextMenu();
    }));
    menu.appendChild(this.menuItem('新建文件夹', folderPlusSvg(), async () => {
      await this.promptCreate(dirPath, true);
      this.closeContextMenu();
    }));
    menu.appendChild(this.menuSeparator());
    menu.appendChild(this.menuItem('重命名', renameSvg(), () => {
      this.startRename(entry);
      this.closeContextMenu();
    }));

    const count = this.selectedPaths.size;
    menu.appendChild(this.menuItem(`删除 (${count})`, trashSvg(), async () => {
      await this.deleteSelected();
      this.closeContextMenu();
    }, true));

    document.body.appendChild(menu);
    this.contextMenu = menu;

    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = `${x - rect.width}px`;
    if (rect.bottom > window.innerHeight) menu.style.top = `${y - rect.height}px`;
  }

  private menuItem(label: string, icon: string, action: () => void, danger = false): HTMLDivElement {
    const item = document.createElement('div');
    item.className = 'context-menu-item' + (danger ? ' danger' : '');
    item.innerHTML = `${icon}<span>${label}</span>`;
    item.addEventListener('click', action);
    return item;
  }

  private menuSeparator(): HTMLDivElement {
    const sep = document.createElement('div');
    sep.className = 'context-menu-separator';
    return sep;
  }

  private closeContextMenu() {
    if (this.contextMenu) { this.contextMenu.remove(); this.contextMenu = null; }
  }

  private async promptCreate(parentDir: string, isDir: boolean) {
    const name = prompt(isDir ? '文件夹名称:' : '文件名称:');
    if (!name || !name.trim()) return;
    const fullPath = parentDir + '\\' + name.trim();
    try {
      await invoke(isDir ? 'create_dir' : 'create_file', { path: fullPath });
      this.refresh();
    } catch (e) { alert('创建失败: ' + e); }
  }

  private startRename(entry: FileEntry) {
    const item = this.container.querySelector(`[data-path="${CSS.escape(entry.path)}"]`);
    if (!item) return;
    const nameEl = item.querySelector('.tree-name') as HTMLSpanElement;
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
        const sep = entry.path.includes('\\') ? '\\' : '/';
        const parentPath = entry.path.replace(/[\\/][^\\/]+$/, '');
        const newPath = parentPath + sep + newName;
        try {
          await invoke('rename_entry', { oldPath: entry.path, newPath });
          this.refresh();
        } catch (e) { alert('重命名失败: ' + e); this.refresh(); }
      } else { this.refresh(); }
    };

    input.addEventListener('blur', finish);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = entry.name; input.blur(); }
    });
  }

  private async deleteSelected() {
    const paths = [...this.selectedPaths];
    if (paths.length === 0) return;
    const msg = paths.length === 1
      ? `确定删除 ${paths[0].split(/[\\/]/).pop()} ?`
      : `确定删除 ${paths.length} 个项目?`;
    if (!confirm(msg)) return;
    try {
      await invoke('delete_entries', { paths });
      this.selectedPaths.clear();
      this.refresh();
    } catch (e) { alert('删除失败: ' + e); }
  }

  async refresh() {
    this.init();
  }
}

// ===== SVG Icons =====
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
    typescript: '#3178c6', javascript: '#f7df1e', rust: '#dea584', python: '#3572a5',
    css: '#563d7c', html: '#e34c26', json: '#a6e3a1', markdown: '#585b70',
    config: '#585b70', image: '#f38ba8', executable: '#a6e3a1', archive: '#f9e2af', file: '#585b70',
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
