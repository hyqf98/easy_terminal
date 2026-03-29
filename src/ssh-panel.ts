import { invoke } from '@tauri-apps/api/core';
import { onLangChange, t } from './i18n';
import { buildSshStartupCommand } from './command-intercept';
import type { SSHProfile } from './types';

type OverlayState = { index: number | null } | null;

export class SSHPanel {
  private container: HTMLDivElement;
  private profiles: SSHProfile[] = [];
  private selectedId = '';
  private activeDrawId = '';
  private overlayState: OverlayState = null;

  public onSelectionChange: ((profile: SSHProfile | null, profiles: SSHProfile[]) => void) | null = null;
  public onConnect: ((profile: SSHProfile, profiles: SSHProfile[]) => Promise<void>) | null = null;
  public onProfilesChange: ((profiles: SSHProfile[]) => void) | null = null;

  constructor(container: HTMLDivElement) {
    this.container = container;
    this.renderShell();
    void this.init();

    onLangChange(() => {
      this.renderShell();
      this.render();
    });
  }

  setActiveProfile(profileId: string | null) {
    this.activeDrawId = profileId || '';
    this.render();
  }

  private async init() {
    await this.reload();
    this.render();
  }

  private renderShell() {
    this.container.innerHTML = `
      <div class="panel-header">
        <h2>${sshIcon()} ${t('ssh.title')}</h2>
      </div>
      <div class="panel-body cmd-panel-body ssh-panel-body"></div>
    `;
  }

  private get body(): HTMLDivElement {
    return this.container.querySelector('.ssh-panel-body') as HTMLDivElement;
  }

  private async reload() {
    this.profiles = await invoke<SSHProfile[]>('load_ssh_profiles');
    if (!this.selectedId && this.profiles.length > 0) {
      this.selectedId = this.profiles[0].id;
    }
    if (this.selectedId && !this.profiles.some((profile) => profile.id === this.selectedId)) {
      this.selectedId = this.profiles[0]?.id || '';
    }
    if (this.activeDrawId && !this.profiles.some((profile) => profile.id === this.activeDrawId)) {
      this.activeDrawId = '';
      this.onSelectionChange?.(null, this.profiles);
    }
    this.onProfilesChange?.(this.profiles);
  }

  private render() {
    const selected = this.profiles.find((profile) => profile.id === this.selectedId) || null;

    let html = `
      <div class="cmd-toolbar">
        <button class="cmd-toolbar-btn primary" id="ssh-add">${addIcon()} ${t('ssh.add')}</button>
        <button class="cmd-toolbar-btn" id="ssh-local">${t('ssh.activateLocal')}</button>
      </div>
      <div class="ssh-status-row">
        <span class="cmd-chip ${this.activeDrawId ? 'accent' : ''}">${this.activeDrawId ? t('ssh.activeBadge') : t('ssh.localBadge')}</span>
        <span class="ssh-status-text">${this.activeDrawId ? escapeHtml(this.profiles.find((profile) => profile.id === this.activeDrawId)?.name || '') : escapeHtml(t('ssh.localBadge'))}</span>
      </div>
      <div class="cmd-master-detail">
        <aside class="cmd-card-list">
          ${this.profiles.length === 0 ? `<div class="cmd-empty">${t('ssh.empty')}</div>` : this.profiles.map((profile) => this.renderCard(profile)).join('')}
        </aside>
        <section class="cmd-detail-pane">
          ${selected ? this.renderDetail(selected) : `<div class="cmd-empty">${t('ssh.detailEmpty')}</div>`}
        </section>
      </div>
    `;

    if (this.overlayState) {
      html += this.renderOverlay();
    }

    this.body.innerHTML = html;
    this.bindEvents();
  }

  private renderCard(profile: SSHProfile): string {
    return `
      <button class="cmd-card-item${profile.id === this.selectedId ? ' active' : ''}" data-ssh-card="${escapeHtml(profile.id)}">
        <div class="cmd-card-head">
          <span class="cmd-card-title">${escapeHtml(profile.name)}</span>
          ${profile.id === this.activeDrawId ? `<span class="cmd-chip accent">${t('ssh.activeBadge')}</span>` : ''}
        </div>
        <div class="cmd-card-subtitle">${escapeHtml(profile.user)}@${escapeHtml(profile.host)}:${profile.port}</div>
        <div class="cmd-card-footer">
          <span class="cmd-chip">${escapeHtml(profile.group || 'default')}</span>
          <span class="cmd-count">${escapeHtml(profile.startupPath || '~')}</span>
        </div>
      </button>
    `;
  }

  private renderDetail(profile: SSHProfile): string {
    const command = buildSshStartupCommand(profile, this.profiles);
    return `
      <div class="cmd-detail-header">
        <div class="cmd-detail-header-main">
          <div class="cmd-detail-title-row">
            <h3>${escapeHtml(profile.name)}</h3>
            ${profile.id === this.activeDrawId ? `<span class="cmd-chip accent">${t('ssh.activeBadge')}</span>` : ''}
          </div>
          <div class="cmd-detail-subtitle">${escapeHtml(profile.user)}@${escapeHtml(profile.host)}:${profile.port}</div>
        </div>
        <div class="ssh-detail-actions">
          <button class="cmd-toolbar-btn primary" data-ssh-connect="${escapeHtml(profile.id)}">${t('ssh.connectNow')}</button>
          <button class="cmd-toolbar-btn" data-ssh-edit="${escapeHtml(profile.id)}">${t('cmd.edit')}</button>
          <button class="cmd-toolbar-btn" data-ssh-delete="${escapeHtml(profile.id)}">${t('cmd.delete')}</button>
        </div>
      </div>
      <div class="ssh-detail-grid">
        <div class="cmd-summary-card">
          <span>${t('ssh.group')}</span>
          <strong>${escapeHtml(profile.group || 'default')}</strong>
        </div>
        <div class="cmd-summary-card">
          <span>${t('ssh.startupPath')}</span>
          <strong>${escapeHtml(profile.startupPath || '~')}</strong>
        </div>
        <div class="cmd-summary-card">
          <span>${t('ssh.jumpServer')}</span>
          <strong>${escapeHtml(this.profiles.find((item) => item.id === profile.jumpProfileId)?.name || '-')}</strong>
        </div>
      </div>
      <div class="cmd-detail-section">${t('ssh.command')}</div>
      <div class="cmd-detail-code">${escapeHtml(command)}</div>
      <div class="cmd-overlay-actions ssh-inline-actions">
        <button class="cmd-toolbar-btn primary" data-ssh-activate="${escapeHtml(profile.id)}">${t('ssh.activate')}</button>
      </div>
    `;
  }

  private renderOverlay(): string {
    const profile = this.overlayState?.index === null
      ? emptyProfile()
      : this.profiles[this.overlayState?.index ?? -1] || emptyProfile();

    return `
      <div class="cmd-overlay">
        <div class="cmd-overlay-card ssh-overlay-card">
          <div class="cmd-overlay-title">${this.overlayState?.index === null ? t('ssh.add') : t('cmd.edit')}</div>
          <label class="cmd-field">
            <span>${t('cmd.name')}</span>
            <input id="ssh-name" type="text" value="${escapeHtml(profile.name)}" placeholder="Prod API">
          </label>
          <label class="cmd-field">
            <span>${t('ssh.group')}</span>
            <input id="ssh-group" type="text" value="${escapeHtml(profile.group)}" placeholder="生产环境">
          </label>
          <div class="ssh-form-grid">
            <label class="cmd-field">
              <span>${t('ssh.host')}</span>
              <input id="ssh-host" type="text" value="${escapeHtml(profile.host)}" placeholder="10.10.1.8">
            </label>
            <label class="cmd-field">
              <span>${t('ssh.port')}</span>
              <input id="ssh-port" type="number" value="${profile.port || 22}" placeholder="22">
            </label>
          </div>
          <label class="cmd-field">
            <span>${t('ssh.user')}</span>
            <input id="ssh-user" type="text" value="${escapeHtml(profile.user)}" placeholder="ubuntu">
          </label>
          <label class="cmd-field">
            <span>${t('ssh.startupPath')}</span>
            <input id="ssh-startup-path" type="text" value="${escapeHtml(profile.startupPath)}" placeholder="/srv/project">
          </label>
          <label class="cmd-field">
            <span>${t('ssh.jumpServer')}</span>
            <select id="ssh-jump-profile">
              <option value="">${escapeHtml(t('ssh.noJumpServer'))}</option>
              ${this.profiles
                .filter((item) => item.id !== profile.id)
                .map((item) => `<option value="${escapeHtml(item.id)}"${item.id === profile.jumpProfileId ? ' selected' : ''}>${escapeHtml(item.name)} (${escapeHtml(item.user)}@${escapeHtml(item.host)})</option>`)
                .join('')}
            </select>
          </label>
          <div class="cmd-overlay-actions">
            <button class="cmd-toolbar-btn primary" id="ssh-save">${t('cmd.save')}</button>
            <button class="cmd-toolbar-btn" id="ssh-cancel">${t('cmd.cancel')}</button>
          </div>
        </div>
      </div>
    `;
  }

  private bindEvents() {
    this.body.querySelector('#ssh-add')?.addEventListener('click', () => {
      this.overlayState = { index: null };
      this.render();
    });

    this.body.querySelector('#ssh-local')?.addEventListener('click', () => {
      this.activeDrawId = '';
      this.onSelectionChange?.(null, this.profiles);
      this.render();
    });

    this.body.querySelectorAll<HTMLElement>('[data-ssh-card]').forEach((button) => {
      button.addEventListener('click', () => {
        this.selectedId = button.dataset.sshCard || '';
        const profile = this.profiles.find((item) => item.id === this.selectedId) || null;
        this.activeDrawId = profile?.id || '';
        this.onSelectionChange?.(profile, this.profiles);
        this.render();
      });
    });

    this.body.querySelectorAll<HTMLElement>('[data-ssh-edit]').forEach((button) => {
      button.addEventListener('click', () => {
        const index = this.profiles.findIndex((profile) => profile.id === button.dataset.sshEdit);
        this.overlayState = { index };
        this.render();
      });
    });

    this.body.querySelectorAll<HTMLElement>('[data-ssh-delete]').forEach((button) => {
      button.addEventListener('click', async () => {
        const next = this.profiles.filter((profile) => profile.id !== button.dataset.sshDelete);
        await this.saveProfiles(next);
      });
    });

    this.body.querySelectorAll<HTMLElement>('[data-ssh-activate]').forEach((button) => {
      button.addEventListener('click', () => {
        this.activeDrawId = button.dataset.sshActivate || '';
        const profile = this.profiles.find((item) => item.id === this.activeDrawId) || null;
        this.onSelectionChange?.(profile, this.profiles);
        this.render();
      });
    });

    this.body.querySelectorAll<HTMLElement>('[data-ssh-connect]').forEach((button) => {
      button.addEventListener('click', async () => {
        const profile = this.profiles.find((item) => item.id === button.dataset.sshConnect);
        if (profile) {
          await this.onConnect?.(profile, this.profiles);
        }
      });
    });

    this.body.querySelector('#ssh-cancel')?.addEventListener('click', () => {
      this.overlayState = null;
      this.render();
    });

    this.body.querySelector('#ssh-save')?.addEventListener('click', async () => {
      await this.saveCurrentProfile();
    });
  }

  private async saveCurrentProfile() {
    const name = (this.body.querySelector('#ssh-name') as HTMLInputElement | null)?.value.trim() || '';
    const group = (this.body.querySelector('#ssh-group') as HTMLInputElement | null)?.value.trim() || '';
    const host = (this.body.querySelector('#ssh-host') as HTMLInputElement | null)?.value.trim() || '';
    const port = Number((this.body.querySelector('#ssh-port') as HTMLInputElement | null)?.value || 22) || 22;
    const user = (this.body.querySelector('#ssh-user') as HTMLInputElement | null)?.value.trim() || '';
    const startupPath = (this.body.querySelector('#ssh-startup-path') as HTMLInputElement | null)?.value.trim() || '';
    const jumpProfileId = (this.body.querySelector('#ssh-jump-profile') as HTMLSelectElement | null)?.value.trim() || '';

    if (!name || !host || !user) {
      alert(t('ssh.required'));
      return;
    }

    const next = [...this.profiles];
    const entry: SSHProfile = {
      id: this.overlayState?.index === null ? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` : next[this.overlayState?.index ?? 0]?.id || '',
      name,
      group,
      host,
      port,
      user,
      startupPath,
      jumpProfileId,
    };

    if (this.overlayState?.index === null) {
      next.unshift(entry);
    } else {
      next[this.overlayState?.index ?? 0] = entry;
    }

    await this.saveProfiles(next, entry.id);
  }

  private async saveProfiles(next: SSHProfile[], selectedId = this.selectedId) {
    await invoke('save_ssh_profiles', { entries: next });
    this.overlayState = null;
    await this.reload();
    this.selectedId = selectedId && next.some((profile) => profile.id === selectedId) ? selectedId : next[0]?.id || '';
    if (this.activeDrawId && !next.some((profile) => profile.id === this.activeDrawId)) {
      this.activeDrawId = '';
      this.onSelectionChange?.(null, next);
    }
    this.onProfilesChange?.(next);
    this.render();
  }
}

function emptyProfile(): SSHProfile {
  return {
    id: '',
    name: '',
    group: '',
    host: '',
    port: 22,
    user: '',
    startupPath: '',
    jumpProfileId: '',
  };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sshIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path><path d="M5 5v14"></path></svg>`;
}

function addIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
}
