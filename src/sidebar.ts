export class Sidebar {
  private el: HTMLDivElement;
  private activeTab = '';
  private panelArea: HTMLDivElement;
  private tabs: Map<string, HTMLButtonElement> = new Map();

  constructor(container: HTMLDivElement, panelArea: HTMLDivElement) {
    this.panelArea = panelArea;
    this.el = document.createElement('div');
    this.el.id = 'sidebar';

    this.addTab('files', folderIcon(), '文件管理');
    this.addTab('commands', commandIcon(), '命令配置');
    this.addTab('settings', gearIcon(), '设置');

    const spacer = document.createElement('div');
    spacer.className = 'sidebar-spacer';
    this.el.appendChild(spacer);

    container.appendChild(this.el);
  }

  private addTab(id: string, iconHtml: string, _label: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'sidebar-tab';
    btn.dataset.tab = id;
    btn.innerHTML = iconHtml;
    btn.title = _label;
    btn.addEventListener('click', () => this.switchTab(id));
    this.tabs.set(id, btn);
    this.el.appendChild(btn);
    return btn;
  }

  private switchTab(tab: string) {
    if (this.activeTab === tab) {
      this.collapse();
      return;
    }
    this.activeTab = tab;

    // Update tab styles
    this.tabs.forEach((btn, id) => {
      btn.classList.toggle('active', id === tab);
    });

    // Show panel
    this.panelArea.classList.add('open');
    this.panelArea.querySelectorAll('.panel-content').forEach((p) => {
      (p as HTMLDivElement).classList.toggle('active', (p as HTMLDivElement).id === `panel-${tab}`);
    });
  }

  private collapse() {
    this.activeTab = '';
    this.panelArea.classList.remove('open');
    this.tabs.forEach((btn) => btn.classList.remove('active'));
    this.panelArea.querySelectorAll('.panel-content').forEach((p) => {
      (p as HTMLDivElement).classList.remove('active');
    });
  }

  getActiveTab(): string {
    return this.activeTab;
  }
}

// ===== SVG Icons =====
function folderIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
}

function gearIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;
}

function commandIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line><line x1="12" y1="5" x2="20" y2="5"></line></svg>`;
}
