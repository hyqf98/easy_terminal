import { t, onLangChange } from './i18n';

export class Sidebar {
  private el: HTMLDivElement;
  private activeTab = '';
  private panelArea: HTMLDivElement;
  private tabs: Map<string, HTMLButtonElement> = new Map();
  public onTabChange: ((tab: string | null) => void) | null = null;

  constructor(container: HTMLDivElement, panelArea: HTMLDivElement) {
    this.panelArea = panelArea;
    this.el = document.createElement('div');
    this.el.id = 'sidebar';

    this.addTab('files', folderIcon(), t('sidebar.files'));
    this.addTab('commands', commandIcon(), t('sidebar.commands'));
    this.addTab('market', marketIcon(), t('sidebar.market'));
    this.addTab('history', historyIcon(), t('sidebar.history'));
    this.addTab('mappings', mappingIcon(), t('sidebar.mappings'));
    this.addTab('ssh', sshIcon(), t('sidebar.ssh'));
    this.addTab('shortcuts', shortcutIcon(), t('sidebar.shortcuts'));
    this.addTab('settings', gearIcon(), t('sidebar.settings'));

    const spacer = document.createElement('div');
    spacer.className = 'sidebar-spacer';
    this.el.appendChild(spacer);

    container.appendChild(this.el);

    // Update titles on language change
    onLangChange(() => {
      const titleMap: Record<string, string> = {
        files: t('sidebar.files'),
        commands: t('sidebar.commands'),
        market: t('sidebar.market'),
        history: t('sidebar.history'),
        mappings: t('sidebar.mappings'),
        ssh: t('sidebar.ssh'),
        shortcuts: t('sidebar.shortcuts'),
        settings: t('sidebar.settings'),
      };
      this.tabs.forEach((btn, id) => {
        const label = titleMap[id] || id;
        btn.title = label;
        btn.dataset.tooltip = label;
      });
    });
  }

  private addTab(id: string, iconHtml: string, _label: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'sidebar-tab';
    btn.dataset.tab = id;
    btn.dataset.tooltip = _label;
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
    this.onTabChange?.(tab);
  }

  openTab(tab: string) {
    if (this.activeTab === tab) {
      this.panelArea.classList.add('open');
      return;
    }
    this.switchTab(tab);
  }

  private collapse() {
    this.activeTab = '';
    this.panelArea.classList.remove('open');
    this.tabs.forEach((btn) => btn.classList.remove('active'));
    this.panelArea.querySelectorAll('.panel-content').forEach((p) => {
      (p as HTMLDivElement).classList.remove('active');
    });
    this.onTabChange?.(null);
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

function historyIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v5h5"></path><path d="M3.05 13a9 9 0 1 0 .5-5.2L3 8"></path><path d="M12 7v5l4 2"></path></svg>`;
}

function mappingIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"></path><path d="M16 3h3a2 2 0 0 1 2 2v3"></path><path d="M8 21H5a2 2 0 0 1-2-2v-3"></path><path d="M16 21h3a2 2 0 0 0 2-2v-3"></path><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>`;
}

function sshIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path><path d="M5 5v14"></path></svg>`;
}

function shortcutIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 8h10"></path><path d="M4 8h2"></path><path d="M4 16h16"></path><path d="M8 12h8"></path></svg>`;
}

function marketIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path></svg>`;
}
