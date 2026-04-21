import { t } from './i18n';
import { CommandIntelligence, type ExecutionResolution, type GhostSuggestion } from './command-intelligence';
import type { SuggestionItem } from './types';

const VIEWPORT_EDGE = 8;
const POPUP_GAP = 8;
const LIST_MIN_WIDTH = 220;
const LIST_MAX_WIDTH = 520;
const DETAIL_MIN_WIDTH = 260;
const DETAIL_MAX_WIDTH = 420;

interface SuggestionSelectOptions {
  submit?: boolean;
}

type PopupPlacement = 'above' | 'below';

export class CommandSuggest {
  private popup: HTMLDivElement | null = null;
  private detailPopup: HTMLDivElement | null = null;
  private activeIndex: number | null = null;
  private enterSelectionArmed = false;
  private filteredItems: SuggestionItem[] = [];
  private temporaryItems: SuggestionItem[] = [];
  private visible = false;
  private requestSeq = 0;
  private detailSeq = 0;
  private anchorScreenX = VIEWPORT_EDGE;
  private anchorScreenTop = VIEWPORT_EDGE;
  private anchorScreenBottom = VIEWPORT_EDGE;
  private popupPlacement: PopupPlacement = 'below';

  public onSelect?: (item: SuggestionItem, options?: SuggestionSelectOptions) => void;
  public onActiveChange?: (item: SuggestionItem | null) => void;

  constructor(private intelligence: CommandIntelligence) {
    document.addEventListener('mousedown', (event) => {
      if (!this.visible) return;
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('.cmd-suggest-popup, .cmd-detail-popup')) return;
      if (target.closest('.terminal-window.focused')) return;
      this.hide();
    });
  }

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

  getGhostSuggestionForItem(input: string, item: SuggestionItem | null): GhostSuggestion | null {
    return this.intelligence.getGhostSuggestionForItem(input, item);
  }

  async getSuggestions(input: string): Promise<SuggestionItem[]> {
    return this.intelligence.searchSuggestions(input);
  }

  resolveExecution(input: string): ExecutionResolution {
    return this.intelligence.resolveExecution(input);
  }

  getActiveItem(): SuggestionItem | null {
    return this.activeIndex === null ? null : this.filteredItems[this.activeIndex] || null;
  }

  getVisibleItems(): SuggestionItem[] {
    return [...this.filteredItems];
  }

  async update(input: string): Promise<boolean> {
    const trimmed = input.trimStart();
    const requestId = ++this.requestSeq;
    if (!trimmed) {
      this.hide();
      return false;
    }

    this.temporaryItems = [];
    const items = await this.intelligence.searchSuggestions(trimmed);
    if (requestId !== this.requestSeq) {
      return false;
    }
    this.filteredItems = items;
    if (this.filteredItems.length === 0) {
      this.hide();
      return false;
    }

    this.activeIndex = null;
    this.enterSelectionArmed = false;
    this.show();
    return true;
  }

  showTemporaryItems(items: SuggestionItem[]): boolean {
    if (items.length === 0) {
      this.hide();
      return false;
    }

    this.temporaryItems = [...items];
    this.filteredItems = [...items];
    this.activeIndex = null;
    this.enterSelectionArmed = false;
    this.show();
    this.emitActiveChange();
    return true;
  }

  clearTemporaryItems() {
    if (this.temporaryItems.length === 0) return;
    this.temporaryItems = [];
  }

  hide(notifyActiveChange = true) {
    this.requestSeq += 1;
    if (this.popup) {
      this.popup.remove();
      this.popup = null;
    }
    this.hideDetail();
    this.temporaryItems = [];
    this.filteredItems = [];
    this.activeIndex = null;
    this.enterSelectionArmed = false;
    this.visible = false;
    this.popupPlacement = 'below';
    if (notifyActiveChange) {
      this.emitActiveChange();
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  positionAt(terminalEl: HTMLElement, cursorX: number, cursorY: number) {
    if (!this.popup) return;

    const rect = terminalEl.getBoundingClientRect();
    this.anchorScreenX = rect.left + Math.max(0, cursorX);
    this.anchorScreenTop = rect.top + Math.max(0, cursorY);
    this.anchorScreenBottom = this.anchorScreenTop;
    this.layoutPopups();
  }

  positionAtScreen(screenX: number, screenTop: number, screenBottom = screenTop) {
    if (!this.popup) return;
    this.anchorScreenX = screenX;
    this.anchorScreenTop = screenTop;
    this.anchorScreenBottom = screenBottom;
    this.layoutPopups();
  }

  private applyPopupPosition(cursorScreenX: number, anchorScreenTop: number, anchorScreenBottom: number) {
    const popup = this.popup!;
    const detailVisible = Boolean(this.detailPopup);
    const layout = this.computePopupLayout(detailVisible);
    const popupWidth = layout.listWidth;
    const totalWidth = layout.totalWidth;
    const naturalHeight = Math.max(popup.scrollHeight, 56);
    const desiredHeight = Math.min(320, naturalHeight);
    const spaceBelow = Math.max(window.innerHeight - anchorScreenBottom - POPUP_GAP - VIEWPORT_EDGE, 0);
    const spaceAbove = Math.max(anchorScreenTop - POPUP_GAP - VIEWPORT_EDGE, 0);

    let placeBelow = spaceBelow >= desiredHeight;
    if (!placeBelow && spaceAbove <= 0 && spaceBelow > 0) {
      placeBelow = true;
    }

    const availableHeight = Math.max(placeBelow ? spaceBelow : spaceAbove, 0);
    const maxH = Math.max(Math.min(desiredHeight, availableHeight), 0);
    const top = placeBelow
      ? anchorScreenBottom + POPUP_GAP
      : Math.max(VIEWPORT_EDGE, anchorScreenTop - POPUP_GAP - maxH);
    this.popupPlacement = placeBelow ? 'below' : 'above';

    let left = cursorScreenX;
    if (left + totalWidth > window.innerWidth - VIEWPORT_EDGE) {
      left = Math.max(VIEWPORT_EDGE, window.innerWidth - totalWidth - VIEWPORT_EDGE);
    }
    left = Math.max(VIEWPORT_EDGE, left);

    popup.dataset.placement = this.popupPlacement;
    popup.style.minWidth = `${popupWidth}px`;
    popup.style.width = `${popupWidth}px`;
    popup.style.maxWidth = `${Math.min(popupWidth, window.innerWidth - VIEWPORT_EDGE * 2)}px`;
    popup.style.maxHeight = `${maxH}px`;
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  }

  private layoutPopups() {
    if (!this.popup) return;
    this.applyPopupPosition(this.anchorScreenX, this.anchorScreenTop, this.anchorScreenBottom);
    this.positionDetailPopup();
  }

  handleKey(e: KeyboardEvent): boolean {
    if (!this.visible) return false;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.activeIndex = this.activeIndex === null
          ? 0
          : Math.min(this.activeIndex + 1, this.filteredItems.length - 1);
        this.enterSelectionArmed = this.activeIndex !== null;
        this.highlightActive();
        void this.showDetail(this.activeIndex === null ? null : this.filteredItems[this.activeIndex]);
        this.emitActiveChange();
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
        this.enterSelectionArmed = this.activeIndex !== null;
        this.highlightActive();
        void this.showDetail(this.activeIndex === null ? null : this.filteredItems[this.activeIndex]);
        this.emitActiveChange();
        return true;
      case 'Escape':
        e.preventDefault();
        this.hide();
        return true;
      case 'Enter': {
        if (e.key === 'Enter' && (!this.enterSelectionArmed || this.activeIndex === null)) {
          return false;
        }

        const item = this.activeIndex === null
          ? this.filteredItems[0] || null
          : this.filteredItems[this.activeIndex] || null;
        if (!item) return false;
        e.preventDefault();
        this.selectItem(item);
        return true;
      }
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
      ${this.filteredItems.map((item, index) => {
        const examplePreview = this.buildExamplePreviewHtml(item);
        return `
      <div class="cmd-suggest-item simple${index === this.activeIndex ? ' active' : ''}" data-index="${index}">
        <div class="cmd-suggest-line">
          <span class="cmd-suggest-title">${escapeHtml(item.title)}</span>
          ${item.description || item.subtitle ? `<span class="cmd-suggest-inline-note">(${escapeHtml(item.description || item.subtitle)})</span>` : ''}
        </div>
        <div class="cmd-suggest-meta-line">
          <span class="cmd-chip">${escapeHtml(item.sourceLabel)}</span>
          ${item.matchedField ? `<span class="cmd-chip">${escapeHtml(item.matchedField)}</span>` : ''}
          ${item.language ? `<span class="cmd-chip">${escapeHtml(item.language)}</span>` : ''}
        </div>
        ${examplePreview}
      </div>
    `;
      }).join('')}
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
        this.enterSelectionArmed = false;
        this.highlightActive();
        void this.showDetail(this.filteredItems[index]);
        this.emitActiveChange();
      });
    });

    void this.showDetail(this.activeIndex === null ? null : this.filteredItems[this.activeIndex]);
  }

  private selectItem(item: SuggestionItem, options?: SuggestionSelectOptions) {
    this.onSelect?.(item, options);
    this.hide(false);
  }

  private buildExamplePreviewHtml(item: SuggestionItem): string {
    const previewSource = item.examples.length > 0
      ? item.examples
      : item.firstExample
        ? [item.firstExample]
        : [];
    if (previewSource.length === 0) return '';
    const preview = previewSource.slice(0, MAX_PREVIEW_CHIPS);
    const remaining = Math.max((item.exampleCount || previewSource.length) - preview.length, 0);
    const chips = preview
      .map((ex) => {
        const parsed = parseExample(ex);
        return `<span class="cmd-suggest-example-chip">${escapeHtml(parsed.command)}</span>`;
      })
      .join('');
    const moreTag = remaining > 0
      ? `<span class="cmd-suggest-example-more">+${remaining}</span>`
      : '';
    return `<div class="cmd-suggest-examples-preview">${chips}${moreTag}</div>`;
  }

  private emitActiveChange() {
    this.onActiveChange?.(this.activeIndex === null ? null : this.filteredItems[this.activeIndex] || null);
  }

  private highlightActive() {
    if (!this.popup) return;
    this.popup.querySelectorAll<HTMLElement>('.cmd-suggest-item').forEach((element, index) => {
      const isActive = this.activeIndex !== null && index === this.activeIndex;
      element.classList.toggle('active', isActive);
      if (isActive) {
        element.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  private async showDetail(item: SuggestionItem | null) {
    this.hideDetail();
    if (!item || !this.popup) return;
    if (item.type === 'completion') return;

    const requestId = ++this.detailSeq;
    const popup = document.createElement('div');
    popup.className = 'cmd-detail-popup simple';
    popup.dataset.itemId = item.id;
    popup.innerHTML = this.buildDetailHtml(item);
    document.body.appendChild(popup);
    this.detailPopup = popup;
    this.bindExampleClicks(popup, item);
    this.layoutPopups();

    const enriched = await this.intelligence.hydrateSuggestionItem(item);
    if (requestId !== this.detailSeq || !this.detailPopup || this.detailPopup.dataset.itemId !== item.id) {
      return;
    }
    if (enriched.examples.length === item.examples.length) {
      return;
    }
    this.detailPopup.innerHTML = this.buildDetailHtml(enriched);
    this.bindExampleClicks(this.detailPopup, enriched);
    this.layoutPopups();
  }

  private buildDetailHtml(item: SuggestionItem): string {
    let html = `<div class="cmd-detail-title">${escapeHtml(item.title)}</div>`;
    if (item.subtitle) {
      html += `<div class="cmd-detail-cn">${escapeHtml(item.subtitle)}</div>`;
    }
    if (item.description) {
      html += `<div class="cmd-detail-desc">${escapeHtml(item.description)}</div>`;
    }
    html += `<div class="cmd-detail-section">${t('suggest.usage')}</div>`;
    html += renderCodeBlock(item.usage || item.executeText);

    if (item.aliases.length) {
      html += `<div class="cmd-detail-section">${t('suggest.aliases')}</div>`;
      html += `<div class="cmd-detail-code">${escapeHtml(item.aliases.join(', '))}</div>`;
    }
    if (item.examples.length) {
      html += this.buildExamplesHtml(item.examples);
    } else if ((item.exampleCount || 0) > 0) {
      html += `<div class="cmd-detail-section">${t('suggest.examples')}</div>`;
      html += `<div class="cmd-detail-text">${escapeHtml(t('cmd.loadingExamples'))}</div>`;
    }
    return html;
  }

  private buildExamplesHtml(examples: string[]): string {
    const previewCount = 3;
    let html = `<div class="cmd-detail-section">${t('suggest.examples')}</div>`;
    const previewExamples = examples.slice(0, previewCount);
    const moreExamples = examples.slice(previewCount);

    for (const example of previewExamples) {
      const parsed = parseExample(example);
      html += `<div class="cmd-detail-example-item" data-example="${escapeAttr(parsed.command)}">${renderExampleLine(parsed.command, parsed.comment)}</div>`;
    }

    if (moreExamples.length > 0) {
      html += `<div class="cmd-detail-examples-extra" style="display:none">`;
      for (const example of moreExamples) {
        const parsed = parseExample(example);
        html += `<div class="cmd-detail-example-item" data-example="${escapeAttr(parsed.command)}">${renderExampleLine(parsed.command, parsed.comment)}</div>`;
      }
      html += `</div>`;
      html += `<span class="cmd-detail-show-more" data-action="toggle-examples">${t('suggest.showMore')} (+${moreExamples.length})</span>`;
    }

    return html;
  }

  private bindExampleClicks(popup: HTMLElement, item: SuggestionItem) {
    const toggleBtn = popup.querySelector('[data-action="toggle-examples"]');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const extra = popup.querySelector('.cmd-detail-examples-extra') as HTMLElement | null;
        if (!extra) return;
        const expanded = extra.style.display !== 'none';
        extra.style.display = expanded ? 'none' : 'block';
        toggleBtn.textContent = expanded
          ? `${t('suggest.showMore')} (+${extra.children.length})`
          : t('suggest.showLess');
        this.repositionDetail();
      });
    }

    popup.querySelectorAll('[data-example]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const example = (el as HTMLElement).dataset.example || '';
        if (example && this.onSelect) {
          const insertItem: SuggestionItem = {
            ...item,
            insertText: example,
          };
          this.onSelect(insertItem);
          this.hide(false);
        }
      });
    });
  }

  private positionDetailPopup() {
    if (!this.detailPopup || !this.popup) return;
    const popupRect = this.popup.getBoundingClientRect();
    const detailWidth = this.computePopupLayout(true).detailWidth;
    let left = popupRect.right + POPUP_GAP;
    let top = popupRect.top;

    if (top + this.detailPopup.offsetHeight > window.innerHeight - VIEWPORT_EDGE) {
      top = Math.max(VIEWPORT_EDGE, window.innerHeight - this.detailPopup.offsetHeight - VIEWPORT_EDGE);
    }

    this.detailPopup.style.width = `${detailWidth}px`;
    this.detailPopup.style.maxWidth = `${detailWidth}px`;
    this.detailPopup.style.maxHeight = `${Math.max(160, window.innerHeight - top - VIEWPORT_EDGE)}px`;
    this.detailPopup.style.left = `${left}px`;
    this.detailPopup.style.top = `${top}px`;
  }

  private repositionDetail() {
    if (!this.detailPopup || !this.popup) return;
    this.layoutPopups();
  }

  private hideDetail() {
    this.detailSeq += 1;
    if (!this.detailPopup) return;
    this.detailPopup.remove();
    this.detailPopup = null;
  }

  private computePopupLayout(detailVisible: boolean): { listWidth: number; detailWidth: number; totalWidth: number } {
    const availableWidth = Math.max(window.innerWidth - VIEWPORT_EDGE * 2, 220);
    if (!detailVisible) {
      const listWidth = Math.min(LIST_MAX_WIDTH, Math.max(320, window.innerWidth * 0.26, LIST_MIN_WIDTH));
      return {
        listWidth: Math.min(listWidth, availableWidth),
        detailWidth: 0,
        totalWidth: Math.min(listWidth, availableWidth),
      };
    }

    const contentWidth = Math.max(availableWidth - POPUP_GAP, 220);
    let detailWidth = Math.min(DETAIL_MAX_WIDTH, Math.max(DETAIL_MIN_WIDTH, window.innerWidth * 0.24));
    let listWidth = Math.min(LIST_MAX_WIDTH, Math.max(280, window.innerWidth * 0.24));

    if (listWidth + detailWidth > contentWidth) {
      listWidth = Math.min(listWidth, Math.max(180, contentWidth - detailWidth));
    }
    if (listWidth < LIST_MIN_WIDTH) {
      listWidth = Math.max(180, Math.min(LIST_MIN_WIDTH, contentWidth - 180));
      detailWidth = Math.max(180, contentWidth - listWidth);
    } else {
      detailWidth = Math.min(detailWidth, Math.max(180, contentWidth - listWidth));
    }

    if (listWidth + detailWidth > contentWidth) {
      detailWidth = Math.max(180, contentWidth - listWidth);
    }

    return {
      listWidth,
      detailWidth,
      totalWidth: listWidth + POPUP_GAP + detailWidth,
    };
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

interface ParsedExample {
  command: string;
  comment: string;
}

function parseExample(example: string): ParsedExample {
  const match = example.match(/^(.+?)\s*(?:#\s*(.+)|\/\/\s*(.+))$/);
  if (match) {
    return { command: match[1].trim(), comment: (match[2] || match[3] || '').trim() };
  }
  return { command: example.trim(), comment: '' };
}

function renderCodeBlock(command: string, comment = ''): string {
  const renderedComment = comment
    ? `<div class="cmd-example-comment">${escapeHtml(comment)}</div>`
    : '';
  return `
    <div class="cmd-detail-code-block">
      <pre class="cmd-detail-code"><code>${highlightCommand(command)}</code></pre>
      ${renderedComment}
    </div>
  `;
}

function renderExampleLine(command: string, comment = ''): string {
  const renderedComment = comment
    ? `<span class="cmd-example-comment-inline"> // ${escapeHtml(comment)}</span>`
    : '';
  return `<div class="cmd-detail-code cmd-detail-code-inline"><code>${highlightCommand(command)}</code>${renderedComment}</div>`;
}

function highlightCommand(command: string): string {
  const parts = command.split(/(\s+)/);
  let tokenIndex = 0;
  return parts
    .map((part) => {
      if (!part) return '';
      if (/^\s+$/.test(part)) {
        return escapeHtml(part);
      }

      let className = 'cmd-code-arg';
      if (tokenIndex === 0) {
        className = 'cmd-code-command';
      } else if (/^(?:\|\||&&|\||>|>>|<|2>&1)$/.test(part)) {
        className = 'cmd-code-operator';
      } else if (/^--?[\w-]/.test(part)) {
        className = 'cmd-code-flag';
      } else if (/^<.+>$/.test(part) || /^\[.+\]$/.test(part)) {
        className = 'cmd-code-placeholder';
      } else if (/^\$[{(]?[A-Za-z_]/.test(part)) {
        className = 'cmd-code-variable';
      }
      tokenIndex += 1;
      return `<span class="${className}">${escapeHtml(part)}</span>`;
    })
    .join('');
}

const MAX_PREVIEW_CHIPS = 2;
