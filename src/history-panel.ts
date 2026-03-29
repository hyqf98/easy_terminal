import { onLangChange, t } from './i18n';
import type { CommandHistoryEntry } from './types';
import type { CommandIntelligence } from './command-intelligence';

export class HistoryPanel {
  private container: HTMLDivElement;
  private contextMenu: HTMLDivElement | null = null;

  constructor(
    container: HTMLDivElement,
    private intelligence: CommandIntelligence,
    private sendToTerminal: (command: string) => Promise<boolean>
  ) {
    this.container = container;
    this.renderShell();
    this.render();

    this.intelligence.onChange(() => this.render());
    onLangChange(() => {
      this.renderShell();
      this.render();
    });

    document.addEventListener('click', (event) => {
      if (!(event.target as HTMLElement).closest('.history-context-menu')) {
        this.closeContextMenu();
      }
    });
  }

  private renderShell() {
    this.container.innerHTML = `
      <div class="panel-header">
        <h2>${historyIcon()} ${t('history.title')}</h2>
      </div>
      <div class="panel-body history-panel-body"></div>
    `;
  }

  private get body(): HTMLDivElement {
    return this.container.querySelector('.history-panel-body') as HTMLDivElement;
  }

  private render() {
    const items = this.intelligence.getHistory();
    let html = `
      <div class="history-toolbar">
        <div class="history-summary">${t('history.summary', String(items.length))}</div>
        <button class="cmd-toolbar-btn" id="history-clear">${t('history.clear')}</button>
      </div>
      <div class="history-list">
    `;

    if (items.length === 0) {
      html += `<div class="cmd-empty">${t('history.empty')}</div>`;
    } else {
      html += items.map((item) => this.renderItem(item)).join('');
    }

    html += '</div>';
    this.body.innerHTML = html;
    this.bindEvents();
  }

  private renderItem(item: CommandHistoryEntry): string {
    return `
      <div class="history-item" data-history-id="${escapeHtml(item.id)}">
        <div class="history-main">
          <div class="history-command">${escapeHtml(item.command)}</div>
          <div class="history-meta">${escapeHtml(item.cwd || '-') } · ${formatTime(item.timestamp)} · ${t('history.count', String(item.count))}</div>
        </div>
        <button class="cmd-mini-btn" data-history-send="${escapeHtml(item.id)}" title="${t('cmd.sendToTerminal')}">${sendIcon()}</button>
      </div>
    `;
  }

  private bindEvents() {
    this.body.querySelector('#history-clear')?.addEventListener('click', async () => {
      await this.intelligence.saveHistory([]);
      this.render();
    });

    this.body.querySelectorAll<HTMLElement>('[data-history-send]').forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.stopPropagation();
        const id = button.dataset.historySend!;
        const item = this.intelligence.getHistory().find((entry) => entry.id === id);
        if (!item) return;
        const sent = await this.sendToTerminal(item.command);
        if (!sent) {
          alert(t('cmd.noActiveTerminal'));
        }
      });
    });

    this.body.querySelectorAll<HTMLElement>('.history-item').forEach((element) => {
      element.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        const id = element.dataset.historyId!;
        this.showContextMenu(event.clientX, event.clientY, id);
      });
    });
  }

  private showContextMenu(x: number, y: number, id: string) {
    this.closeContextMenu();
    const item = this.intelligence.getHistory().find((entry) => entry.id === id);
    if (!item) return;

    const menu = document.createElement('div');
    menu.className = 'context-menu history-context-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.appendChild(this.menuItem(t('cmd.sendToTerminal'), sendIcon(), async () => {
      const sent = await this.sendToTerminal(item.command);
      if (!sent) alert(t('cmd.noActiveTerminal'));
      this.closeContextMenu();
    }));
    menu.appendChild(this.menuItem(t('history.delete'), deleteIcon(), async () => {
      const next = this.intelligence.getHistory().filter((entry) => entry.id !== id);
      await this.intelligence.saveHistory(next);
      this.closeContextMenu();
    }, true));
    document.body.appendChild(menu);
    this.contextMenu = menu;
  }

  private menuItem(label: string, icon: string, handler: () => void | Promise<void>, danger = false): HTMLDivElement {
    const item = document.createElement('div');
    item.className = `context-menu-item${danger ? ' danger' : ''}`;
    item.innerHTML = `${icon}<span>${label}</span>`;
    item.addEventListener('click', () => {
      void handler();
    });
    return item;
  }

  private closeContextMenu() {
    if (!this.contextMenu) return;
    this.contextMenu.remove();
    this.contextMenu = null;
  }
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function historyIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M3 3v5h5"></path><path d="M3.05 13a9 9 0 1 0 .5-5.2L3 8"></path><path d="M12 7v5l4 2"></path></svg>`;
}

function sendIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
}

function deleteIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
}
