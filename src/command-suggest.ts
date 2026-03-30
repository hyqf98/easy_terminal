import { t } from './i18n';
import { CommandIntelligence, type ExecutionResolution, type GhostSuggestion } from './command-intelligence';
import type { SuggestionItem } from './types';

export class CommandSuggest {
  private popup: HTMLDivElement | null = null;
  private detailPopup: HTMLDivElement | null = null;
  private activeIndex: number | null = null;
  private filteredItems: SuggestionItem[] = [];
  private visible = false;

  public onSelect?: (item: SuggestionItem) => void;

  constructor(private intelligence: CommandIntelligence) {}

  async init() {
    await this.intelligence.init();
  }

  async refresh(): Promise<void> {
    await this.intelligence.reloadAll();
  }

  async reloadCommands(): Promise<void> {
    await this.intelligence.reloadCommands();
  }

  getGhostSuggestion(input: string): GhostSuggestion | null {
    return this.intelligence.getGhostSuggestion(input);
  }

  getSuggestions(input: string): SuggestionItem[] {
    return this.intelligence.getSuggestionItems(input);
  }

  resolveExecution(input: string): ExecutionResolution {
    return this.intelligence.resolveExecution(input);
  }

  update(input: string): boolean {
    const trimmed = input.trimStart();
    if (!trimmed) {
      this.hide();
      return false;
    }

    this.filteredItems = this.intelligence.getSuggestionItems(trimmed);
    if (this.filteredItems.length === 0) {
      this.hide();
      return false;
    }

    this.activeIndex = null;
    this.show();
    return true;
  }

  hide() {
    if (this.popup) {
      this.popup.remove();
      this.popup = null;
    }
    this.hideDetail();
    this.filteredItems = [];
    this.activeIndex = null;
    this.visible = false;
  }

  isVisible(): boolean {
    return this.visible;
  }

  positionAt(terminalEl: HTMLElement, cursorX: number, cursorY: number) {
    if (!this.popup) return;

    const rect = terminalEl.getBoundingClientRect();
    let left = rect.left + cursorX;
    let top = rect.top + cursorY + 12;
    const popupWidth = Math.max(280, Math.min(420, rect.width * 0.62));

    // Calculate available space below and above the cursor
    const spaceBelow = window.innerHeight - top - 8;
    const spaceAbove = rect.top + cursorY - 8;
    const preferBelow = spaceBelow >= spaceAbove;

    let maxH: number;
    if (preferBelow) {
      maxH = Math.min(320, Math.max(160, spaceBelow));
    } else {
      // Flip above: position popup above the cursor line
      maxH = Math.min(320, Math.max(160, spaceAbove));
      top = Math.max(8, top - maxH - 24);
    }

    this.popup.style.minWidth = '240px';
    this.popup.style.maxWidth = `${popupWidth}px`;
    this.popup.style.maxHeight = `${maxH}px`;

    if (left + popupWidth > window.innerWidth) {
      left = window.innerWidth - popupWidth - 8;
    }
    if (left < 8) left = 8;

    // Final clamp: ensure popup stays in viewport
    if (top + maxH > window.innerHeight) {
      top = Math.max(8, window.innerHeight - maxH - 8);
    }

    this.popup.style.left = `${left}px`;
    this.popup.style.top = `${top}px`;
  }

  handleKey(e: KeyboardEvent): boolean {
    if (!this.visible) return false;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.activeIndex = this.activeIndex === null
          ? 0
          : Math.min(this.activeIndex + 1, this.filteredItems.length - 1);
        this.highlightActive();
        this.showDetail(this.activeIndex === null ? null : this.filteredItems[this.activeIndex]);
        return true;
      case 'ArrowUp':
        e.preventDefault();
        if (this.activeIndex === null) {
          this.activeIndex = this.filteredItems.length - 1;
        } else if (this.activeIndex === 0) {
          this.activeIndex = null;
        } else {
          this.activeIndex -= 1;
        }
        this.highlightActive();
        this.showDetail(this.activeIndex === null ? null : this.filteredItems[this.activeIndex]);
        return true;
      case 'Enter':
        if (this.activeIndex !== null && this.filteredItems[this.activeIndex]) {
          e.preventDefault();
          this.selectItem(this.filteredItems[this.activeIndex]);
          return true;
        }
        return false;
      case 'Tab':
        if (this.activeIndex === null || !this.filteredItems[this.activeIndex]) {
          return false;
        }
        e.preventDefault();
        this.selectItem(this.filteredItems[this.activeIndex]);
        return true;
      case 'Escape':
        e.preventDefault();
        this.hide();
        return true;
      default:
        return false;
    }
  }

  private show() {
    if (!this.popup) {
      this.popup = document.createElement('div');
      this.popup.className = 'cmd-suggest-popup simple';
      document.body.appendChild(this.popup);
    }
    this.visible = true;
    this.render();
  }

  private render() {
    if (!this.popup) return;

    this.popup.innerHTML = `
      ${this.filteredItems.map((item, index) => `
      <div class="cmd-suggest-item simple${index === this.activeIndex ? ' active' : ''}" data-index="${index}">
        <div class="cmd-suggest-line">
          <span class="cmd-suggest-title">${escapeHtml(item.title)}</span>
          ${item.description || item.subtitle ? `<span class="cmd-suggest-inline-note">(${escapeHtml(item.description || item.subtitle)})</span>` : ''}
        </div>
      </div>
    `).join('')}
    `;

    this.popup.querySelectorAll<HTMLElement>('.cmd-suggest-item').forEach((element) => {
      element.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const index = Number(element.dataset.index || '0');
        const item = this.filteredItems[index];
        if (item) {
          this.selectItem(item);
        }
      });

      element.addEventListener('mouseenter', () => {
        const index = Number(element.dataset.index || '0');
        this.activeIndex = index;
        this.highlightActive();
        this.showDetail(this.filteredItems[index]);
      });
    });

    this.showDetail(this.activeIndex === null ? null : this.filteredItems[this.activeIndex]);
  }

  private selectItem(item: SuggestionItem) {
    this.onSelect?.(item);
    this.hide();
  }

  private highlightActive() {
    if (!this.popup) return;
    this.popup.querySelectorAll('.cmd-suggest-item').forEach((element, index) => {
      element.classList.toggle('active', this.activeIndex !== null && index === this.activeIndex);
    });
  }

  private showDetail(item: SuggestionItem | null) {
    this.hideDetail();
    if (!item || !this.popup) return;

    const popup = document.createElement('div');
    popup.className = 'cmd-detail-popup simple';

    let html = `<div class="cmd-detail-title">${escapeHtml(item.title)}</div>`;
    if (item.subtitle) {
      html += `<div class="cmd-detail-cn">${escapeHtml(item.subtitle)}</div>`;
    }
    if (item.description) {
      html += `<div class="cmd-detail-desc">${escapeHtml(item.description)}</div>`;
    }
    html += `<div class="cmd-detail-section">${t('suggest.usage')}</div>`;
    html += `<div class="cmd-detail-code">${escapeHtml(item.usage || item.executeText)}</div>`;

    if (item.tags.length) {
      html += `<div class="cmd-detail-section">${t('suggest.tags')}</div>`;
      html += `<div class="cmd-detail-text">${escapeHtml(item.tags.join(' / '))}</div>`;
    }
    if (item.aliases.length) {
      html += `<div class="cmd-detail-section">${t('suggest.aliases')}</div>`;
      html += `<div class="cmd-detail-code">${escapeHtml(item.aliases.join(', '))}</div>`;
    }
    if (item.examples.length) {
      html += `<div class="cmd-detail-section">${t('suggest.examples')}</div>`;
      html += item.examples.map((example) => `<div class="cmd-detail-code">${escapeHtml(example)}</div>`).join('');
    }
    html += `<div class="cmd-detail-section">${t('suggest.source')}</div>`;
    html += `<div class="cmd-detail-text">${escapeHtml(item.sourceLabel)}</div>`;

    popup.innerHTML = html;
    document.body.appendChild(popup);
    this.detailPopup = popup;

    const popupRect = this.popup.getBoundingClientRect();
    let left = popupRect.right + 8;
    let top = popupRect.top;

    if (left + 320 > window.innerWidth) {
      left = Math.max(8, popupRect.left - 328);
    }
    if (top + popup.offsetHeight > window.innerHeight) {
      top = Math.max(8, window.innerHeight - popup.offsetHeight - 8);
    }

    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  }

  private hideDetail() {
    if (!this.detailPopup) return;
    this.detailPopup.remove();
    this.detailPopup = null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
