import { invoke } from '@tauri-apps/api/core';
import { t, onLangChange, setLang } from './i18n';
import type { Lang } from './i18n';
import type { AppUpdater } from './app-update';

interface AppSettings {
  theme: string;
  language: string;
  autoCheckUpdate: boolean;
  lastUpdateCheck: string;
}

export class Settings {
  private container: HTMLDivElement;
  private currentTheme = 'dark';
  private currentLang: Lang = 'zh-CN';
  private autoCheckUpdate = true;
  private lastPersistedUpdateCheck = '';
  public ready: Promise<void>;
  public onThemeChange?: (theme: string) => void;

  constructor(container: HTMLDivElement, private updater: AppUpdater) {
    this.container = container;
    this.renderShell();
    this.ready = this.init();

    onLangChange(() => this.render());
    this.updater.onChange((state) => {
      if (state.lastChecked && state.lastChecked !== this.lastPersistedUpdateCheck) {
        this.lastPersistedUpdateCheck = state.lastChecked;
        void this.persistSettings(state.lastChecked);
      }
      this.render();
    });
  }

  private renderShell() {
    this.container.innerHTML = `
      <div class="panel-header">
        <h2>${gearIcon()} ${t('settings.title')}</h2>
      </div>
      <div class="panel-body">
        <div class="settings-section" id="settings-content"></div>
      </div>
    `;
  }

  private async init() {
    try {
      const settings = await invoke<AppSettings>('get_settings');
      this.currentTheme = settings.theme;
      this.currentLang = (settings.language as Lang) || 'zh-CN';
      this.autoCheckUpdate = settings.autoCheckUpdate ?? true;
      this.lastPersistedUpdateCheck = settings.lastUpdateCheck || '';
      this.updater.setLastChecked(settings.lastUpdateCheck || '');
      setLang(this.currentLang);
      this.applyTheme(settings.theme);
    } catch {
      this.applyTheme('dark');
    }
    this.render();
  }

  private render() {
    // Re-render shell to update title
    this.renderShell();

    const content = this.container.querySelector('#settings-content') as HTMLDivElement;
    if (!content) return;
    const updateState = this.updater.getState();

    content.innerHTML = `
      <h3>${t('settings.appearance')}</h3>
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
          <span class="theme-card-label">${t('settings.dark')}</span>
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
          <span class="theme-card-label">${t('settings.light')}</span>
        </div>
        <div class="theme-card ${this.currentTheme === 'warm' ? 'active' : ''}" data-theme="warm">
          <div class="theme-card-preview warm-card">
            <div class="tbar">
              <div class="tbar-header"><span></span><span></span><span></span></div>
              <div class="tbar-body">
                <span style="width:70%"></span>
                <span style="width:45%"></span>
                <span style="width:60%"></span>
              </div>
            </div>
          </div>
          <span class="theme-card-label">${t('settings.warm')}</span>
        </div>
      </div>

      <h3 style="margin-top:20px">${t('settings.language')}</h3>
      <div class="theme-cards">
        <div class="theme-card ${this.currentLang === 'zh-CN' ? 'active' : ''}" data-lang="zh-CN">
          <div class="theme-card-preview lang-preview">
            <span class="lang-char">中</span>
          </div>
          <span class="theme-card-label">${t('settings.langZh')}</span>
        </div>
        <div class="theme-card ${this.currentLang === 'en-US' ? 'active' : ''}" data-lang="en-US">
          <div class="theme-card-preview lang-preview">
            <span class="lang-char">En</span>
          </div>
          <span class="theme-card-label">${t('settings.langEn')}</span>
        </div>
      </div>

      <h3 style="margin-top:20px">${t('settings.update')}</h3>
      <div class="settings-update-card">
        <div class="settings-update-meta">
          <div><span>${t('settings.updateCurrent')}</span><strong>${escapeHtml(updateState.currentVersion)}</strong></div>
          <div><span>${t('settings.updateLastChecked')}</span><strong>${escapeHtml(formatLastChecked(updateState.lastChecked))}</strong></div>
        </div>
        <div class="settings-update-status">${escapeHtml(this.describeUpdateState())}</div>
        ${(updateState.status === 'downloading' || updateState.status === 'installing') && updateState.progressPercent !== null ? `
          <div class="settings-update-progress">
            <div class="settings-update-progress-head">
              <span>${updateState.status === 'downloading' ? 'Downloading' : 'Installing'}</span>
              <strong>${Math.round(updateState.progressPercent)}%</strong>
            </div>
            <div class="settings-update-progress-track">
              <div class="settings-update-progress-bar" style="width:${updateState.progressPercent}%"></div>
            </div>
          </div>
        ` : ''}
        <label class="mapping-toggle-row settings-toggle-row">
          <input id="settings-auto-check" type="checkbox" ${this.autoCheckUpdate ? 'checked' : ''}>
          <span>${t('settings.updateAutoCheck')}</span>
        </label>
        <div class="cmd-overlay-actions settings-update-actions">
          <button class="cmd-toolbar-btn primary" id="settings-check-update" ${updateState.status === 'checking' || updateState.status === 'downloading' || updateState.status === 'installing' ? 'disabled' : ''}>${t('settings.updateCheck')}</button>
          <button class="cmd-toolbar-btn" id="settings-install-update" ${updateState.status !== 'available' ? 'disabled' : ''}>${t('settings.updateInstall')}</button>
        </div>
      </div>
    `;

    // Theme cards
    content.querySelectorAll('.theme-card[data-theme]').forEach((card) => {
      card.addEventListener('click', async () => {
        const theme = (card as HTMLElement).dataset.theme!;
        if (theme === this.currentTheme) return;
        this.currentTheme = theme;
        this.applyTheme(theme);
        try {
          await invoke('save_settings', { settings: { theme, language: this.currentLang, autoCheckUpdate: this.autoCheckUpdate, lastUpdateCheck: updateState.lastChecked } });
        } catch (e) {
          console.error('Save settings failed:', e);
        }
        this.render();
      });
    });

    // Language cards
    content.querySelectorAll('.theme-card[data-lang]').forEach((card) => {
      card.addEventListener('click', async () => {
        const lang = (card as HTMLElement).dataset.lang as Lang;
        if (lang === this.currentLang) return;
        this.currentLang = lang;
        setLang(lang);
        try {
          await invoke('save_settings', { settings: { theme: this.currentTheme, language: lang, autoCheckUpdate: this.autoCheckUpdate, lastUpdateCheck: updateState.lastChecked } });
        } catch (e) {
          console.error('Save settings failed:', e);
        }
        this.render();
      });
    });

    content.querySelector('#settings-auto-check')?.addEventListener('change', async (event) => {
      this.autoCheckUpdate = (event.target as HTMLInputElement).checked;
      await this.persistSettings(updateState.lastChecked);
      this.render();
    });

    content.querySelector('#settings-check-update')?.addEventListener('click', async () => {
      await this.updater.checkForUpdates();
      await this.persistSettings(this.updater.getState().lastChecked);
    });

    content.querySelector('#settings-install-update')?.addEventListener('click', async () => {
      try {
        await this.updater.installUpdate();
      } catch (error) {
        console.error('Install update failed:', error);
      }
    });
  }

  private applyTheme(theme: string) {
    document.documentElement.setAttribute('data-theme', theme);
    this.onThemeChange?.(theme);
  }

  getTheme(): string {
    return this.currentTheme;
  }

  getAutoCheckUpdate(): boolean {
    return this.autoCheckUpdate;
  }

  private async persistSettings(lastUpdateCheck: string) {
    try {
      this.lastPersistedUpdateCheck = lastUpdateCheck;
      await invoke('save_settings', {
        settings: {
          theme: this.currentTheme,
          language: this.currentLang,
          autoCheckUpdate: this.autoCheckUpdate,
          lastUpdateCheck,
        },
      });
    } catch (error) {
      console.error('Save settings failed:', error);
    }
  }

  private describeUpdateState(): string {
    const state = this.updater.getState();
    if (state.status === 'checking') return t('settings.updateChecking');
    if (state.status === 'downloading') return t('settings.updateDownloading');
    if (state.status === 'installing') return t('settings.updateInstalling');
    if (state.status === 'up-to-date') return t('settings.updateUpToDate');
    if (state.status === 'available') return t('settings.updateAvailable', state.latestVersion);
    if (state.status === 'completed') return t('settings.updateReady');
    if (state.status === 'unsupported') return t('settings.updateUnsupported');
    if (state.status === 'error') return t('settings.updateFailed', state.error);
    return t('settings.updateIdle');
  }
}

function formatLastChecked(value: string): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function gearIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;
}
