import { invoke } from '@tauri-apps/api/core';

interface AppSettings {
  theme: string;
}

export class Settings {
  private container: HTMLDivElement;
  private currentTheme = 'dark';

  constructor(container: HTMLDivElement) {
    this.container = container;
    this.container.innerHTML = `
      <div class="panel-header">
        <h2>${gearIcon()} 设置</h2>
      </div>
      <div class="panel-body">
        <div class="settings-section" id="settings-content"></div>
      </div>
    `;
    this.init();
  }

  private async init() {
    try {
      const settings = await invoke<AppSettings>('get_settings');
      this.currentTheme = settings.theme;
      this.applyTheme(settings.theme);
    } catch {
      this.applyTheme('dark');
    }
    this.render();
  }

  private render() {
    const content = this.container.querySelector('#settings-content') as HTMLDivElement;
    if (!content) return;

    content.innerHTML = `
      <h3>外观</h3>
      <div class="theme-cards">
        <div class="theme-card ${this.currentTheme === 'dark' ? 'active' : ''}" data-theme="dark">
          <div class="theme-card-preview dark-card">
            <div class="tbar">
              <div class="tbar-header"><span></span><span></span><span></span></div>
              <div class="tbar-body">
                <span style="width:70%"></span>
                <span style="width:45%"></span>
                <span style="width:60%"></span>
              </div>
            </div>
          </div>
          <span class="theme-card-label">暗色</span>
        </div>
        <div class="theme-card ${this.currentTheme === 'light' ? 'active' : ''}" data-theme="light">
          <div class="theme-card-preview light-card">
            <div class="tbar">
              <div class="tbar-header"><span></span><span></span><span></span></div>
              <div class="tbar-body">
                <span style="width:70%"></span>
                <span style="width:45%"></span>
                <span style="width:60%"></span>
              </div>
            </div>
          </div>
          <span class="theme-card-label">亮色</span>
        </div>
      </div>
    `;

    content.querySelectorAll('.theme-card').forEach((card) => {
      card.addEventListener('click', async () => {
        const theme = (card as HTMLElement).dataset.theme!;
        if (theme === this.currentTheme) return;
        this.currentTheme = theme;
        this.applyTheme(theme);
        try {
          await invoke('save_settings', { settings: { theme } });
        } catch (e) {
          console.error('Save settings failed:', e);
        }
        this.render();
      });
    });
  }

  private applyTheme(theme: string) {
    document.documentElement.setAttribute('data-theme', theme);
  }

  getTheme(): string {
    return this.currentTheme;
  }
}

function gearIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;
}
