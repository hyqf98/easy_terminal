import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { onLangChange, t } from './i18n';
import type { SSHProfile } from './types';
import { Perf } from './perf';

type OverlayState = { index: number | null } | null;

export class SSHPanel {
  private container: HTMLDivElement;
  private profiles: SSHProfile[] = [];
  private activeDrawId = '';
  private overlayState: OverlayState = null;
  private groupCollapsed: Record<string, boolean> = {};
  public ready: Promise<void>;

  public onSelectionChange: ((profile: SSHProfile | null, profiles: SSHProfile[]) => void) | null = null;
  public onConnect: ((profile: SSHProfile, profiles: SSHProfile[]) => Promise<void>) | null = null;
  public onProfilesChange: ((profiles: SSHProfile[]) => void) | null = null;

  constructor(container: HTMLDivElement) {
    this.container = container;
    this.renderShell();
    this.ready = this.init();

    onLangChange(() => {
      this.renderShell();
      this.render();
      this.renderOverlayToBody();
    });
  }

  setActiveProfile(profileId: string | null) {
    this.activeDrawId = profileId || '';
    const active = this.profiles.find((profile) => profile.id === this.activeDrawId) || null;
    this.onSelectionChange?.(active, this.profiles);
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
    if (this.activeDrawId && !this.profiles.some((profile) => profile.id === this.activeDrawId)) {
      this.activeDrawId = '';
      this.onSelectionChange?.(null, this.profiles);
    }
    this.onProfilesChange?.(this.profiles);
  }

  private render() {
    const grouped = this.buildGroupedList();

    let html = `
      <div class="cmd-toolbar">
        <button class="cmd-toolbar-btn primary" id="ssh-add">${addIcon()} ${t('ssh.add')}</button>
      </div>
      <div class="ssh-profile-list">
        ${grouped.length === 0 ? `<div class="cmd-empty">${t('ssh.empty')}</div>` : grouped.map((g) => this.renderGroup(g)).join('')}
      </div>
    `;

    this.body.innerHTML = html;
    this.bindEvents();
    this.renderOverlayToBody();
  }

  private buildGroupedList(): { name: string; profiles: SSHProfile[] }[] {
    const map = new Map<string, SSHProfile[]>();
    for (const p of this.profiles) {
      const key = p.group || 'default';
      let list = map.get(key);
      if (!list) { list = []; map.set(key, list); }
      list.push(p);
    }
    const result: { name: string; profiles: SSHProfile[] }[] = [];
    for (const [name, profiles] of map) {
      result.push({ name, profiles });
    }
    return result;
  }

  private renderGroup(group: { name: string; profiles: SSHProfile[] }): string {
    const collapsed = this.groupCollapsed[group.name] ?? false;
    return `
      <div class="ssh-group" data-ssh-group="${escapeHtml(group.name)}">
        <div class="ssh-group-header" data-ssh-group-toggle="${escapeHtml(group.name)}">
          <span class="ssh-group-arrow${collapsed ? '' : ' open'}">${chevronIcon()}</span>
          <span class="ssh-group-name">${escapeHtml(group.name)}</span>
          <span class="ssh-group-count">${group.profiles.length}</span>
        </div>
        <div class="ssh-group-body"${collapsed ? ' style="display:none"' : ''}>
          ${group.profiles.map((profile) => this.renderCard(profile)).join('')}
        </div>
      </div>
    `;
  }

  private renderCard(profile: SSHProfile): string {
    const isActive = profile.id === this.activeDrawId;
    return `
      <div class="ssh-profile-item${isActive ? ' active' : ''}" data-ssh-profile="${escapeHtml(profile.id)}">
        <div class="ssh-profile-main">
          <div class="ssh-profile-name-row">
            <span class="ssh-profile-name">${escapeHtml(profile.name)}</span>
          </div>
          <div class="ssh-profile-host">${escapeHtml(profile.user)}@${escapeHtml(profile.host)}:${profile.port}</div>
        </div>
        <div class="ssh-profile-actions">
          <button class="ssh-action-btn" data-ssh-connect="${escapeHtml(profile.id)}" title="${t('ssh.connectNow')}">${connectIcon()}</button>
          <button class="ssh-action-btn" data-ssh-edit="${escapeHtml(profile.id)}" title="${t('cmd.edit')}">${editIcon()}</button>
          <button class="ssh-action-btn danger" data-ssh-delete="${escapeHtml(profile.id)}" title="${t('cmd.delete')}">${deleteIcon()}</button>
        </div>
      </div>
    `;
  }

  private renderOverlayHTML(): string {
    const profile = this.overlayState?.index === null
      ? emptyProfile()
      : this.profiles[this.overlayState?.index ?? -1] || emptyProfile();

    const groups = [...new Set(this.profiles.map((p) => p.group).filter(Boolean))];
    const authType = profile.authType || 'password';
    const isKey = authType === 'key';

    return `
      <div class="cmd-overlay-card ssh-overlay-card">
        <div class="cmd-overlay-title">${this.overlayState?.index === null ? t('ssh.add') : t('cmd.edit')}</div>
        <label class="cmd-field">
          <span>${t('cmd.name')}<em class="ssh-required">*</em></span>
          <input id="ssh-name" type="text" value="${escapeHtml(profile.name)}" placeholder="Prod API">
        </label>
        <label class="cmd-field">
          <span>${t('ssh.group')}</span>
          <input id="ssh-group" type="text" value="${escapeHtml(profile.group)}" placeholder="${t('ssh.group')}" list="ssh-group-list">
          <datalist id="ssh-group-list">
            ${groups.map((g) => `<option value="${escapeHtml(g)}">`).join('')}
          </datalist>
        </label>
        <div class="ssh-form-grid">
          <label class="cmd-field">
            <span>${t('ssh.host')}<em class="ssh-required">*</em></span>
            <input id="ssh-host" type="text" value="${escapeHtml(profile.host)}" placeholder="10.10.1.8">
          </label>
          <label class="cmd-field">
            <span>${t('ssh.port')}</span>
            <input id="ssh-port" type="number" value="${profile.port || 22}" placeholder="22">
          </label>
        </div>
        <label class="cmd-field">
          <span>${t('ssh.user')}<em class="ssh-required">*</em></span>
          <input id="ssh-user" type="text" value="${escapeHtml(profile.user)}" placeholder="ubuntu">
        </label>
        <label class="cmd-field">
          <span>${t('ssh.authType')}</span>
          <select id="ssh-auth-type">
            <option value="password"${!isKey ? ' selected' : ''}>${t('ssh.authPassword')}</option>
            <option value="key"${isKey ? ' selected' : ''}>${t('ssh.authKey')}</option>
          </select>
        </label>
        <label class="cmd-field ssh-password-field" style="display:${!isKey ? 'flex' : 'none'}">
          <span>${t('ssh.password')}</span>
          <input id="ssh-password" type="password" value="${escapeHtml(profile.password || '')}" placeholder="${t('ssh.passwordPlaceholder')}">
        </label>
        <div class="cmd-field ssh-key-field" style="display:${isKey ? 'flex' : 'none'}">
          <span>${t('ssh.privateKeyPath')}<em class="ssh-required">*</em></span>
          <div class="ssh-file-row">
            <input id="ssh-key-path" type="text" value="${escapeHtml(profile.privateKeyPath || '')}" placeholder="${t('ssh.privateKeyPathPlaceholder')}">
            <button type="button" class="ssh-file-btn" id="ssh-pick-key">${folderIcon()}</button>
          </div>
        </div>
        <label class="cmd-field">
          <span>${t('ssh.proxyJump')}</span>
          <select id="ssh-jump-profile">
            ${(() => {
              const items = this.profiles.filter((item) => item.id !== profile.id);
              if (items.length === 0) {
                return `<option value="" disabled selected>${t('ssh.noJumpServer')}</option>`;
              }
              return `<option value="">${t('ssh.noJumpServer')}</option>` +
                items.map((item) => `<option value="${escapeHtml(item.id)}"${item.id === profile.jumpProfileId ? ' selected' : ''}>${escapeHtml(item.name)} (${escapeHtml(item.user)}@${escapeHtml(item.host)})</option>`).join('');
            })()}
          </select>
        </label>
        <div class="cmd-overlay-actions">
          <button class="cmd-toolbar-btn primary" id="ssh-save">${t('cmd.save')}</button>
          <button class="cmd-toolbar-btn" id="ssh-test">${t('ssh.testConnection')}</button>
          <button class="cmd-toolbar-btn" id="ssh-cancel">${t('cmd.cancel')}</button>
        </div>
      </div>
    `;
  }

  private renderOverlayToBody() {
    const existing = document.getElementById('ssh-overlay-root');
    if (existing) {
      existing.remove();
    }

    if (!this.overlayState) return;

    const root = document.createElement('div');
    root.id = 'ssh-overlay-root';
    root.className = 'cmd-overlay';
    root.innerHTML = this.renderOverlayHTML();
    document.body.appendChild(root);
    this.bindOverlayEvents(root);
  }

  private bindOverlayEvents(root: HTMLElement) {
    // Auth type toggle
    const authSelect = root.querySelector('#ssh-auth-type') as HTMLSelectElement | null;
    const keyField = root.querySelector('.ssh-key-field') as HTMLElement | null;
    const passwordField = root.querySelector('.ssh-password-field') as HTMLElement | null;
    authSelect?.addEventListener('change', () => {
      const isKey = authSelect.value === 'key';
      if (keyField) {
        keyField.style.display = isKey ? 'flex' : 'none';
      }
      if (passwordField) {
        passwordField.style.display = isKey ? 'none' : 'flex';
      }
    });

    // Pick key file
    root.querySelector('#ssh-pick-key')?.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        const selected = await open({
          title: t('ssh.privateKeyPath'),
          multiple: false,
          directory: false,
        });
        if (selected) {
          const input = root.querySelector('#ssh-key-path') as HTMLInputElement | null;
          if (input) input.value = selected;
        }
      } catch {
        // User cancelled dialog
      }
    });

    // Save
    root.querySelector('#ssh-save')?.addEventListener('click', async () => {
      await this.saveCurrentProfile(root);
    });

    // Test connection
    root.querySelector('#ssh-test')?.addEventListener('click', async () => {
      await this.testConnection(root);
    });

    // Cancel
    root.querySelector('#ssh-cancel')?.addEventListener('click', () => {
      this.overlayState = null;
      this.renderOverlayToBody();
    });

    // Click outside to close
    root.addEventListener('click', (e) => {
      if (e.target === root) {
        this.overlayState = null;
        this.renderOverlayToBody();
      }
    });
  }

  private async testConnection(root: HTMLElement) {
    Perf.mark('ssh.testConnection');
    const host = (root.querySelector('#ssh-host') as HTMLInputElement | null)?.value.trim() || '';
    const port = Number((root.querySelector('#ssh-port') as HTMLInputElement | null)?.value || 22) || 22;
    const user = (root.querySelector('#ssh-user') as HTMLInputElement | null)?.value.trim() || '';
    const authType = (root.querySelector('#ssh-auth-type') as HTMLSelectElement | null)?.value || 'password';
    const password = (root.querySelector('#ssh-password') as HTMLInputElement | null)?.value || '';
    const privateKeyPath = (root.querySelector('#ssh-key-path') as HTMLInputElement | null)?.value.trim() || '';
    const jumpProfileId = (root.querySelector('#ssh-jump-profile') as HTMLSelectElement | null)?.value.trim() || '';

    if (!host || !user) {
      alert(t('ssh.required'));
      return;
    }

    const testBtn = root.querySelector('#ssh-test') as HTMLButtonElement | null;
    if (testBtn) {
      testBtn.disabled = true;
      testBtn.textContent = t('ssh.testing');
    }

    try {
      await invoke<string>('test_ssh_connection', {
        host, port, user, authType, password, privateKeyPath, jumpProfileId,
        profiles: this.profiles,
      });
      this.showToast(t('ssh.testSuccess'), 'success');
    } catch (err) {
      this.showToast(t('ssh.testFailed', String(err)), 'error');
    } finally {
      if (testBtn) {
        testBtn.disabled = false;
        testBtn.textContent = t('ssh.testConnection');
      }
      Perf.end('ssh.testConnection');
    }
  }

  private showToast(message: string, type: 'success' | 'error') {
    const existing = document.getElementById('ssh-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'ssh-toast';
    toast.className = `ssh-toast ssh-toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('ssh-toast-visible'));
    setTimeout(() => {
      toast.classList.remove('ssh-toast-visible');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  private bindEvents() {
    // Group toggle
    this.body.querySelectorAll<HTMLElement>('[data-ssh-group-toggle]').forEach((header) => {
      header.addEventListener('click', () => {
        const name = header.dataset.sshGroupToggle || '';
        this.groupCollapsed[name] = !(this.groupCollapsed[name] ?? false);
        this.render();
      });
    });

    this.body.querySelector('#ssh-add')?.addEventListener('click', () => {
      this.overlayState = { index: null };
      this.renderOverlayToBody();
    });

    this.body.querySelectorAll<HTMLElement>('[data-ssh-edit]').forEach((button) => {
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = this.profiles.findIndex((profile) => profile.id === button.dataset.sshEdit);
        this.overlayState = { index };
        this.renderOverlayToBody();
      });
    });

    this.body.querySelectorAll<HTMLElement>('[data-ssh-delete]').forEach((button) => {
      button.addEventListener('click', async (e) => {
        e.stopPropagation();
        const next = this.profiles.filter((profile) => profile.id !== button.dataset.sshDelete);
        await this.saveProfiles(next);
      });
    });

    this.body.querySelectorAll<HTMLElement>('[data-ssh-connect]').forEach((button) => {
      button.addEventListener('click', async (e) => {
        e.stopPropagation();
        const profile = this.profiles.find((item) => item.id === button.dataset.sshConnect);
        if (profile) {
          this.activeDrawId = profile.id;
          this.render();
          this.onSelectionChange?.(profile, this.profiles);
          await this.onConnect?.(profile, this.profiles);
        }
      });
    });

    this.body.querySelectorAll<HTMLElement>('[data-ssh-profile]').forEach((card) => {
      card.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('[data-ssh-connect],[data-ssh-edit],[data-ssh-delete]')) return;
        const profileId = card.dataset.sshProfile || '';
        this.activeDrawId = this.activeDrawId === profileId ? '' : profileId;
        const active = this.profiles.find((p) => p.id === this.activeDrawId) || null;
        this.onSelectionChange?.(active, this.profiles);
        this.render();
      });

      card.addEventListener('dblclick', async (e) => {
        e.stopPropagation();
        const profile = this.profiles.find((item) => item.id === card.dataset.sshProfile);
        if (profile) {
          this.activeDrawId = profile.id;
          this.render();
          this.onSelectionChange?.(profile, this.profiles);
          await this.onConnect?.(profile, this.profiles);
        }
      });
    });
  }

  private async saveCurrentProfile(root: HTMLElement) {
    const name = (root.querySelector('#ssh-name') as HTMLInputElement | null)?.value.trim() || '';
    const group = (root.querySelector('#ssh-group') as HTMLInputElement | null)?.value.trim() || '';
    const host = (root.querySelector('#ssh-host') as HTMLInputElement | null)?.value.trim() || '';
    const port = Number((root.querySelector('#ssh-port') as HTMLInputElement | null)?.value || 22) || 22;
    const user = (root.querySelector('#ssh-user') as HTMLInputElement | null)?.value.trim() || '';
    const authType = ((root.querySelector('#ssh-auth-type') as HTMLSelectElement | null)?.value || 'password') as 'password' | 'key';
    const password = (root.querySelector('#ssh-password') as HTMLInputElement | null)?.value || '';
    const privateKeyPath = (root.querySelector('#ssh-key-path') as HTMLInputElement | null)?.value.trim() || '';
    const jumpProfileId = (root.querySelector('#ssh-jump-profile') as HTMLSelectElement | null)?.value.trim() || '';

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
      authType,
      password,
      privateKeyPath,
      jumpProfileId,
    };

    if (this.overlayState?.index === null) {
      next.unshift(entry);
    } else {
      next[this.overlayState?.index ?? 0] = entry;
    }

    await this.saveProfiles(next);
  }

  private async saveProfiles(next: SSHProfile[]) {
    await invoke('save_ssh_profiles', { entries: next });
    this.overlayState = null;
    this.renderOverlayToBody();
    await this.reload();
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
    authType: 'password',
    password: '',
    privateKeyPath: '',
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

function connectIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg>`;
}

function editIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`;
}

function deleteIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
}

function folderIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
}

function chevronIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
}
