import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { CanvasController, PtyOutputEvent, SuggestionItem, TerminalLaunchOptions } from './types';
import { CommandSuggest } from './command-suggest';
import { resolvePreviewPath } from './command-intercept';
import { openFilePreview } from './file-preview';
import type { ShortcutManager } from './shortcut-manager';

const DARK_THEME = {
  background: '#1a1b2e',
  foreground: '#a9b1d6',
  cursor: '#c0caf5',
  selectionBackground: '#2f3347',
  black: '#15161e',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  white: '#a9b1d6',
  brightBlack: '#414868',
  brightRed: '#f7768e',
  brightGreen: '#9ece6a',
  brightYellow: '#e0af68',
  brightBlue: '#7aa2f7',
  brightMagenta: '#bb9af7',
  brightCyan: '#7dcfff',
  brightWhite: '#c0caf5',
};

const LIGHT_THEME = {
  background: '#ffffff',
  foreground: '#1d1d1f',
  cursor: '#0071e3',
  selectionBackground: '#e0e0e5',
  black: '#1d1d1f',
  red: '#ff3b30',
  green: '#34c759',
  yellow: '#ff9f0a',
  blue: '#0071e3',
  magenta: '#af52de',
  cyan: '#5ac8fa',
  white: '#8e8e93',
  brightBlack: '#636366',
  brightRed: '#ff453a',
  brightGreen: '#30d158',
  brightYellow: '#ffd60a',
  brightBlue: '#0a84ff',
  brightMagenta: '#bf5af2',
  brightCyan: '#64d2ff',
  brightWhite: '#f5f5f7',
};

const WARM_THEME = {
  background: '#f2ece4',
  foreground: '#2f2923',
  cursor: '#0d7a6d',
  selectionBackground: '#e0d8cc',
  black: '#51473d',
  red: '#c05621',
  green: '#2f855a',
  yellow: '#b7791f',
  blue: '#0d7a6d',
  magenta: '#7c3aed',
  cyan: '#0d7a6d',
  white: '#2f2923',
  brightBlack: '#7a7062',
  brightRed: '#dd6b20',
  brightGreen: '#38a169',
  brightYellow: '#d69e2e',
  brightBlue: '#0d7a6d',
  brightMagenta: '#9f7aea',
  brightCyan: '#0d9488',
  brightWhite: '#1a1510',
};

function getTermTheme(theme: string) {
  if (theme === 'light') return LIGHT_THEME;
  if (theme === 'warm') return WARM_THEME;
  return DARK_THEME;
}

export class TerminalWindow {
  private id = '';
  private container: HTMLDivElement;
  private term: Terminal;
  private fitAddon: FitAddon;
  private unlisten: UnlistenFn | null = null;
  private canvasController: CanvasController;
  private commandSuggest: CommandSuggest;
  private currentLine = '';
  private cursorPos = 0;
  private lineStartCell: number | null = null;
  private selectionAnchor: number | null = null;
  private selectionOverlays: HTMLDivElement[] = [];
  private terminalContextMenu: HTMLDivElement | null = null;
  private currentGhostText = '';

  // Drag state
  private isDragging = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private boundDragMove: (e: MouseEvent) => void;
  private boundDragEnd: () => void;

  // Resize state
  private isResizing = false;
  private resizeDirection = '';
  private resizeStartX = 0;
  private resizeStartY = 0;
  private resizeStartW = 0;
  private resizeStartH = 0;
  private resizeStartLeft = 0;
  private resizeStartTop = 0;
  private boundResizeMove: (e: MouseEvent) => void;
  private boundResizeEnd: () => void;

  // Minimize/Maximize state
  private isMinimized = false;
  private isMaximized = false;
  private savedRect: { x: number; y: number; w: number; h: number } | null = null;

  // Focus & CWD state
  private cwdPath = '';
  private ghostOverlay: HTMLDivElement | null = null;
  private launchOptions: TerminalLaunchOptions = { mode: 'local' };

  public onActivate: ((id: string) => void) | null = null;
  public onCommandExecuted: ((command: string, cwd: string) => void | Promise<void>) | null = null;
  public onCwdChange: ((cwd: string) => void) | null = null;
  public onAddMappingFromSelection: ((text: string) => void) | null = null;

  constructor(
    parentEl: HTMLElement,
    private x: number,
    private y: number,
    private width: number,
    private height: number,
    canvasController: CanvasController,
    commandSuggest: CommandSuggest,
    private shortcutManager?: ShortcutManager
  ) {
    this.canvasController = canvasController;
    this.commandSuggest = commandSuggest;
    this.container = this.buildDOM(parentEl);
    const baseFontSize = this.calcFontSize(this.width, this.height);
    const themeName = document.documentElement.getAttribute('data-theme') || 'dark';
    this.term = new Terminal({
      theme: getTermTheme(themeName),
      fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, monospace',
      fontSize: baseFontSize,
      fontWeight: '400',
      fontWeightBold: '600',
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'bar',
      allowTransparency: true,
    });
    this.fitAddon = new FitAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.loadAddon(new WebLinksAddon());

    const body = this.container.querySelector('.terminal-body') as HTMLDivElement;
    this.term.open(body);

    this.boundDragMove = this.onDragMove.bind(this);
    this.boundDragEnd = this.onDragEnd.bind(this);
    this.boundResizeMove = this.onResizeMove.bind(this);
    this.boundResizeEnd = this.onResizeEnd.bind(this);

    this.bindWindowControls();
    this.bindDrag();
    this.bindResize();
    this.bindTitleRename();
    this.bindActivation();
    this.bindSelectionContextMenu();
    this.bindLineSelection();
  }

  async initPty(options: TerminalLaunchOptions = {}) {
    this.launchOptions = { mode: 'local', ...options };
    this.fitAddon.fit();
    const cols = this.term.cols;
    const rows = this.term.rows;

    const nameEl = this.container.querySelector('.terminal-name') as HTMLSpanElement;

    let sessionId = '';
    this.unlisten = await listen<PtyOutputEvent>('pty-output', (event) => {
      if (event.payload.session_id === sessionId) {
        const data = event.payload.data;
        this.extractTitleFromOsc(data);
        this.term.write(data);
      }
    });

    sessionId = await invoke<string>('create_pty', { cols, rows, cwd: this.launchOptions.cwd || null });
    this.id = sessionId;

    // Save initial cwd if provided
    if (this.launchOptions.cwd) {
      this.cwdPath = this.launchOptions.cwd;
    }

    nameEl.textContent = this.launchOptions.profileName || '未命名';

    // Track current line for command suggestions
    this.currentLine = '';
    this.cursorPos = 0;
    this.clearLineSelection();

    this.term.onData(async (data) => {
      try {
        const handled = await this.handleTerminalInput(data);
        if (!handled) {
          await invoke('write_pty', { sessionId: this.id, data });
        }
      } catch (e) {
        console.error('write_pty error:', e);
      }
    });

    this.term.onTitleChange((title: string) => {
      // Only save cwd path — don't overwrite user's custom title
      this.cwdPath = title.trim();
      this.onCwdChange?.(this.cwdPath);
    });

    // Bind command suggestion to this terminal
    this.bindCommandSuggest();

    if (this.launchOptions.startupCommand) {
      this.cwdPath = this.launchOptions.profileName || this.cwdPath;
      setTimeout(() => {
        invoke('write_pty', {
          sessionId: this.id,
          data: `${this.launchOptions.startupCommand}\r`,
        }).catch(console.error);
      }, 80);
    }
  }

  /** Track what the user is typing to drive suggestions */
  private async handleTerminalInput(data: string): Promise<boolean> {
    if (data === '\r') {
      const rawLine = this.currentLine;
      const trimmed = rawLine.trim();
      this.currentLine = '';
      this.cursorPos = 0;
      this.lineStartCell = null;
      this.clearLineSelection();
      this.commandSuggest.hide();
      this.hideGhostText();

      if (!trimmed) {
        return false;
      }

      const resolution = this.commandSuggest.resolveExecution(rawLine);
      await this.onCommandExecuted?.(resolution.command, this.cwdPath);

      if (await this.tryOpenPreview(resolution.command)) {
        return true;
      }

      if (resolution.source === 'mapping' && resolution.command !== trimmed) {
        const erase = '\b \b'.repeat(rawLine.length);
        await invoke('write_pty', {
          sessionId: this.id,
          data: `${erase}${resolution.command}\r`,
        });
        return true;
      }
      return false;
    }

    if (this.hasLineSelection() && (this.isPrintableInput(data) || data === '\x7f' || data === '\b')) {
      if (data === '\x7f' || data === '\b') {
        await this.replaceLineSelection('');
      } else {
        await this.replaceLineSelection(data);
      }
      this.refreshSuggestions();
      return true;
    }

    if (data === '\x7f' || data === '\b') {
      // Backspace
      if (this.cursorPos > 0) {
        this.currentLine = `${this.currentLine.slice(0, this.cursorPos - 1)}${this.currentLine.slice(this.cursorPos)}`;
        this.cursorPos -= 1;
      }
    } else if (data === '\x03') {
      // Ctrl+C
      this.currentLine = '';
      this.cursorPos = 0;
      this.lineStartCell = null;
      this.clearLineSelection();
    } else if (data === '\x15') {
      // Ctrl+U - clear line
      this.currentLine = '';
      this.cursorPos = 0;
      this.lineStartCell = null;
      this.clearLineSelection();
    } else if (this.isPrintableInput(data)) {
      this.ensureLineStartCell();
      this.currentLine = `${this.currentLine.slice(0, this.cursorPos)}${data}${this.currentLine.slice(this.cursorPos)}`;
      this.cursorPos += data.length;
    } else if (data === '\t') {
      this.ensureLineStartCell();
      return false;
    }

    this.refreshSuggestions();
    return false;
  }

  private isPrintableInput(data: string): boolean {
    return data.length > 0 && !/[\x00-\x1f\x7f]/.test(data);
  }

  private async tryOpenPreview(commandLine: string): Promise<boolean> {
    if (this.launchOptions.mode === 'ssh') return false;
    const path = resolvePreviewPath(commandLine, this.cwdPath);
    if (!path) return false;
    return openFilePreview(path, commandLine);
  }

  private refreshSuggestions() {
    if (this.currentLine.trim()) {
      const hasSuggestions = this.commandSuggest.update(this.currentLine);
      if (hasSuggestions) {
        this.positionSuggestPopup();
      }
      this.updateGhostText();
      return;
    }
    this.commandSuggest.hide();
    this.hideGhostText();
  }

  private updateGhostText() {
    const ghost = this.commandSuggest.getGhostSuggestion(this.currentLine);
    if (!ghost || !ghost.text.trim()) {
      this.hideGhostText();
      return;
    }
    this.currentGhostText = ghost.text;
    this.showGhostText(ghost.text);
  }

  private showGhostText(text: string) {
    const terminalBody = this.container.querySelector('.terminal-body') as HTMLDivElement;

    if (!this.ghostOverlay) {
      this.ghostOverlay = document.createElement('div');
      this.ghostOverlay.className = 'ghost-text-overlay';
      terminalBody.appendChild(this.ghostOverlay);
    }

    this.ghostOverlay.innerHTML = `<span class="ghost-text-value">${escapeHtml(text)}</span>`;
    this.ghostOverlay.style.display = 'inline-flex';
  }

  private hideGhostText() {
    this.currentGhostText = '';
    if (this.ghostOverlay) {
      this.ghostOverlay.style.display = 'none';
    }
  }

  private async acceptGhostText() {
    const ghost = this.currentGhostText;
    if (!ghost) return;
    this.hideGhostText();
    this.commandSuggest.hide();
    await invoke('write_pty', { sessionId: this.id, data: ghost });
    this.currentLine += ghost;
    this.cursorPos = this.currentLine.length;
  }

  private bindCommandSuggest() {
    // When user selects a command from suggestions
    this.commandSuggest.onSelect = (item: SuggestionItem) => {
      const replacement = item.type === 'mapping' ? item.executeText : item.insertText;
      const partial = this.currentLine.trimStart().split(/\s/)[0];
      const erase = partial ? '\b \b'.repeat(partial.length) : '';
      invoke('write_pty', { sessionId: this.id, data: `${erase}${replacement}` }).catch(console.error);
      const leadingSpaces = this.currentLine.match(/^\s*/)?.[0] || '';
      this.currentLine = `${leadingSpaces}${replacement}`;
      this.cursorPos = this.currentLine.length;
      this.clearLineSelection();
      this.refreshSuggestions();
      this.hideGhostText();
    };

    this.container.addEventListener('keydown', (e: KeyboardEvent) => {
      if (this.handleLineEditingShortcut(e)) {
        return;
      }

      if (this.commandSuggest.isVisible()) {
        const handled = this.commandSuggest.handleKey(e);
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
    }, true); // capture phase to intercept before xterm
  }

  private handleLineEditingShortcut(event: KeyboardEvent): boolean {
    const isPrimaryA = this.shortcutManager
      ? this.shortcutManager.matches('terminal.selectLine', event)
      : ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'a');

    if (isPrimaryA && this.currentLine) {
      event.preventDefault();
      event.stopPropagation();
      this.selectionAnchor = 0;
      this.cursorPos = this.currentLine.length;
      this.updateLineSelectionOverlay();
      return true;
    }

    if (event.shiftKey && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      void this.extendSelection(event.key);
      return true;
    }

    // Accept ghost suggestion with ArrowRight at end of line
    if (event.key === 'ArrowRight' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
      && this.currentGhostText && this.cursorPos === this.currentLine.length) {
      event.preventDefault();
      event.stopPropagation();
      void this.acceptGhostText();
      return true;
    }

    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // Let ArrowRight pass through when at end of line with no ghost text,
      // so zsh autosuggestions can be accepted natively
      if (event.key === 'ArrowRight' && !event.shiftKey && this.cursorPos >= this.currentLine.length && !this.currentGhostText) {
        this.clearLineSelection();
        return false;
      }
      event.preventDefault();
      event.stopPropagation();
      this.clearLineSelection();
      void this.moveCursorByKey(event.key);
      return true;
    }

    return false;
  }

  private positionSuggestPopup() {
    const metrics = this.getOverlayMetrics();
    if (!metrics) return;

    const cursorCell = this.getCursorCell(metrics);
    const cursorX = this.mod(cursorCell, metrics.cols);
    const cursorY = Math.floor(cursorCell / metrics.cols);
    const pixelX = metrics.offsetX + cursorX * metrics.colWidth;
    const pixelY = metrics.offsetY + (cursorY + 1.7) * metrics.rowHeight;

    this.commandSuggest.positionAt(metrics.terminalBody, pixelX, pixelY);
  }

  private hasLineSelection(): boolean {
    return this.selectionAnchor !== null && this.selectionAnchor !== this.cursorPos;
  }

  private getLineSelectionRange(): { start: number; end: number } | null {
    if (this.selectionAnchor === null || this.selectionAnchor === this.cursorPos) return null;
    return {
      start: Math.min(this.selectionAnchor, this.cursorPos),
      end: Math.max(this.selectionAnchor, this.cursorPos),
    };
  }

  private clearLineSelection() {
    this.selectionAnchor = null;
    this.selectionOverlays.forEach((overlay) => {
      overlay.style.display = 'none';
    });
  }

  private async moveCursorByKey(key: string) {
    let next = this.cursorPos;
    if (key === 'ArrowLeft') next = Math.max(0, this.cursorPos - 1);
    if (key === 'ArrowRight') next = Math.min(this.currentLine.length, this.cursorPos + 1);
    if (key === 'Home') next = 0;
    if (key === 'End') next = this.currentLine.length;
    await this.moveCursorTo(next);
  }

  private async extendSelection(key: string) {
    if (!this.currentLine) return;
    this.ensureLineStartCell();
    if (this.selectionAnchor === null) {
      this.selectionAnchor = this.cursorPos;
    }
    await this.moveCursorByKey(key);
    this.updateLineSelectionOverlay();
  }

  private async moveCursorTo(target: number) {
    this.ensureLineStartCell();
    const next = Math.max(0, Math.min(target, this.currentLine.length));
    const delta = next - this.cursorPos;
    if (delta === 0) {
      this.updateLineSelectionOverlay();
      return;
    }
    if (delta > 0) {
      await invoke('write_pty', { sessionId: this.id, data: '\x1b[C'.repeat(delta) });
    } else {
      await invoke('write_pty', { sessionId: this.id, data: '\x1b[D'.repeat(Math.abs(delta)) });
    }
    this.cursorPos = next;
    this.updateLineSelectionOverlay();
  }

  private async replaceLineSelection(text: string) {
    const range = this.getLineSelectionRange();
    if (!range) return;

    await this.moveCursorTo(range.start);
    if (range.end > range.start) {
      await invoke('write_pty', { sessionId: this.id, data: '\x1b[3~'.repeat(range.end - range.start) });
    }

    this.currentLine = `${this.currentLine.slice(0, range.start)}${this.currentLine.slice(range.end)}`;
    this.cursorPos = range.start;
    this.clearLineSelection();

    if (text) {
      await invoke('write_pty', { sessionId: this.id, data: text });
      this.currentLine = `${this.currentLine.slice(0, this.cursorPos)}${text}${this.currentLine.slice(this.cursorPos)}`;
      this.cursorPos += text.length;
    }
    this.updateLineSelectionOverlay();
  }

  private updateLineSelectionOverlay() {
    const range = this.getLineSelectionRange();
    const metrics = this.getOverlayMetrics();
    if (!range || !metrics || !this.currentLine) {
      this.selectionOverlays.forEach((overlay) => {
        overlay.style.display = 'none';
      });
      return;
    }

    const lineStartCell = this.getLineStartCell(metrics);
    const startCell = lineStartCell + range.start;
    const endCell = lineStartCell + range.end;
    const startRow = Math.floor(startCell / metrics.cols);
    const endRow = Math.floor(Math.max(startCell, endCell - 1) / metrics.cols);
    const visibleRows: Array<{ row: number; startCol: number; endCol: number }> = [];

    for (let row = startRow; row <= endRow; row += 1) {
      if (row < 0 || row >= metrics.rows) continue;
      const startCol = row === startRow ? this.mod(startCell, metrics.cols) : 0;
      const endCol = row === endRow ? this.mod(endCell, metrics.cols) || metrics.cols : metrics.cols;
      if (endCol <= startCol) continue;
      visibleRows.push({ row, startCol, endCol });
    }

    this.ensureSelectionOverlayCount(visibleRows.length, metrics.terminalBody);

    visibleRows.forEach((segment, index) => {
      const overlay = this.selectionOverlays[index];
      overlay.style.left = `${metrics.offsetX + segment.startCol * metrics.colWidth}px`;
      overlay.style.top = `${metrics.offsetY + segment.row * metrics.rowHeight}px`;
      overlay.style.width = `${Math.max((segment.endCol - segment.startCol) * metrics.colWidth, 2)}px`;
      overlay.style.height = `${Math.max(metrics.rowHeight, 18)}px`;
      overlay.style.display = 'block';
    });

    for (let index = visibleRows.length; index < this.selectionOverlays.length; index += 1) {
      this.selectionOverlays[index].style.display = 'none';
    }
  }

  private extractTitleFromOsc(data: string) {
    const oscRegex = /\x1b\](0|2);([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
    let match;
    let lastTitle = '';
    while ((match = oscRegex.exec(data)) !== null) {
      lastTitle = match[2];
    }
    if (lastTitle) {
      // Save raw cwd path (don't update title bar — user can rename)
      this.cwdPath = lastTitle.trim();
      this.onCwdChange?.(this.cwdPath);
    }
  }

  private buildDOM(parent: HTMLElement): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'terminal-window';
    el.style.left = `${this.x}px`;
    el.style.top = `${this.y}px`;
    el.style.width = `${this.width}px`;
    el.style.height = `${this.height}px`;
    el.innerHTML = `
      <div class="title-bar">
        <div class="title-spacer"></div>
        <span class="terminal-name">未命名</span>
        <div class="window-controls">
          <button class="btn-minimize" title="Minimize"></button>
          <button class="btn-maximize" title="Maximize"></button>
          <button class="btn-close" title="Close"></button>
        </div>
      </div>
      <div class="terminal-body"></div>
      <div class="resize-handle resize-n"></div>
      <div class="resize-handle resize-s"></div>
      <div class="resize-handle resize-e"></div>
      <div class="resize-handle resize-w"></div>
      <div class="resize-handle resize-ne"></div>
      <div class="resize-handle resize-nw"></div>
      <div class="resize-handle resize-se"></div>
      <div class="resize-handle resize-sw"></div>
    `;
    parent.appendChild(el);
    return el;
  }

  private bindSelectionContextMenu() {
    const terminalBody = this.container.querySelector('.terminal-body') as HTMLDivElement;
    document.addEventListener('click', (event) => {
      if (!(event.target as HTMLElement).closest('.terminal-selection-menu')) {
        this.closeTerminalContextMenu();
      }
    });

    terminalBody.addEventListener('contextmenu', (event) => {
      const selected = this.term.getSelection().trim();
      if (!selected) return;
      event.preventDefault();
      event.stopPropagation();
      this.showTerminalContextMenu(event.clientX, event.clientY, selected);
    });
  }

  private bindLineSelection() {
    const terminalBody = this.container.querySelector('.terminal-body') as HTMLDivElement;
    terminalBody.addEventListener('dblclick', (event) => {
      const range = this.resolveWordRangeFromPoint(event.clientX, event.clientY);
      if (!range) return;
      event.preventDefault();
      event.stopPropagation();
      void this.selectLineRange(range.start, range.end);
    }, true);
  }

  private showTerminalContextMenu(x: number, y: number, selected: string) {
    this.closeTerminalContextMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu terminal-selection-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.innerHTML = `
      <div class="context-menu-item" data-terminal-copy>复制文本</div>
      <div class="context-menu-item" data-terminal-map>添加为命令映射</div>
    `;

    menu.querySelector('[data-terminal-copy]')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(selected);
      } catch (error) {
        console.error('clipboard write failed', error);
      }
      this.closeTerminalContextMenu();
    });

    menu.querySelector('[data-terminal-map]')?.addEventListener('click', () => {
      this.onAddMappingFromSelection?.(selected);
      this.closeTerminalContextMenu();
    });

    document.body.appendChild(menu);
    this.terminalContextMenu = menu;
  }

  private closeTerminalContextMenu() {
    if (!this.terminalContextMenu) return;
    this.terminalContextMenu.remove();
    this.terminalContextMenu = null;
  }

  private async selectLineRange(start: number, end: number) {
    if (!this.currentLine) return;
    this.ensureLineStartCell();
    this.selectionAnchor = Math.max(0, Math.min(start, this.currentLine.length));
    await this.moveCursorTo(Math.max(0, Math.min(end, this.currentLine.length)));
    this.updateLineSelectionOverlay();
  }

  private resolveWordRangeFromPoint(clientX: number, clientY: number): { start: number; end: number } | null {
    if (!this.currentLine) return null;
    const metrics = this.getOverlayMetrics();
    if (!metrics) return null;

    const terminalRect = metrics.terminalBody.getBoundingClientRect();
    const gridX = clientX - terminalRect.left - metrics.offsetX;
    const gridY = clientY - terminalRect.top - metrics.offsetY;
    if (gridX < 0 || gridY < 0) return null;

    const row = Math.floor(gridY / metrics.rowHeight);
    const col = Math.floor(gridX / metrics.colWidth);
    if (row < 0 || row >= metrics.rows || col < 0 || col >= metrics.cols) return null;

    const clickedCell = row * metrics.cols + col;
    const lineStartCell = this.getLineStartCell(metrics);
    const lineEndCell = lineStartCell + this.currentLine.length;
    if (clickedCell < lineStartCell || clickedCell > lineEndCell) return null;

    let charIndex = Math.min(Math.max(clickedCell - lineStartCell, 0), Math.max(this.currentLine.length - 1, 0));
    if (/\s/.test(this.currentLine[charIndex] || '')) {
      const prev = charIndex > 0 ? this.currentLine[charIndex - 1] : '';
      const next = charIndex < this.currentLine.length - 1 ? this.currentLine[charIndex + 1] : '';
      if (prev && !/\s/.test(prev)) {
        charIndex -= 1;
      } else if (next && !/\s/.test(next)) {
        charIndex += 1;
      } else {
        return null;
      }
    }

    let start = charIndex;
    let end = charIndex + 1;
    while (start > 0 && !/\s/.test(this.currentLine[start - 1])) {
      start -= 1;
    }
    while (end < this.currentLine.length && !/\s/.test(this.currentLine[end])) {
      end += 1;
    }

    return start < end ? { start, end } : null;
  }

  private bindActivation() {
    this.container.addEventListener('mousedown', () => {
      if (!this.id) return;
      this.onActivate?.(this.id);
    });
  }

  private bindWindowControls() {
    this.container.querySelector('.btn-close')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
    });
    this.container.querySelector('.btn-minimize')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMinimize();
    });
    this.container.querySelector('.btn-maximize')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMaximize();
    });
  }

  private bindDrag() {
    const titleBar = this.container.querySelector('.title-bar') as HTMLDivElement;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragStarted = false;

    titleBar.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('.window-controls')) return;
      if (this.isMaximized) return;
      if (e.button !== 0) return; // left button only
      if (this.id) {
        this.onActivate?.(this.id);
      }
      // Record start position but don't start dragging yet
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragStarted = false;
      const { zoom, panX, panY } = this.canvasController.getState();
      const viewportRect = this.container.closest('#app-viewport')!.getBoundingClientRect();
      const containerLeft = parseFloat(this.container.style.left) || 0;
      const containerTop = parseFloat(this.container.style.top) || 0;
      this.dragOffsetX = e.clientX - (viewportRect.left + panX + containerLeft * zoom);
      this.dragOffsetY = e.clientY - (viewportRect.top + panY + containerTop * zoom);
      window.addEventListener('mousemove', this.boundDragMove);
      window.addEventListener('mouseup', this.boundDragEnd);
    });

    // Override drag move to require minimum movement threshold
    const origDragMove = this.boundDragMove;
    this.boundDragMove = (e: MouseEvent) => {
      if (!dragStarted) {
        const dx = Math.abs(e.clientX - dragStartX);
        const dy = Math.abs(e.clientY - dragStartY);
        if (dx < 4 && dy < 4) return; // Not enough movement yet
        dragStarted = true;
        this.isDragging = true;
        this.container.classList.add('dragging');
      }
      origDragMove.call(this, e);
    };

    const origDragEnd = this.boundDragEnd;
    this.boundDragEnd = () => {
      this.isDragging = false;
      dragStarted = false;
      this.container.classList.remove('dragging');
      this.canvasController.clearGuides();
      window.removeEventListener('mousemove', this.boundDragMove);
      window.removeEventListener('mouseup', this.boundDragEnd);
      origDragEnd.call(this);
    };
  }

  private onDragMove(e: MouseEvent) {
    if (!this.isDragging) return;
    const { zoom, panX, panY } = this.canvasController.getState();
    const viewportRect = this.container.closest('#app-viewport')!.getBoundingClientRect();
    const canvasX = (e.clientX - this.dragOffsetX - viewportRect.left - panX) / zoom;
    const canvasY = (e.clientY - this.dragOffsetY - viewportRect.top - panY) / zoom;
    const snapped = this.canvasController.snapRect({
      x: canvasX,
      y: canvasY,
      w: this.container.offsetWidth,
      h: this.container.offsetHeight,
    }, {
      sourceId: this.id,
      mode: 'drag',
    });
    this.container.style.left = `${snapped.x}px`;
    this.container.style.top = `${snapped.y}px`;
  }

  private onDragEnd() {
    this.isDragging = false;
    this.container.classList.remove('dragging');
    this.canvasController.clearGuides();
    window.removeEventListener('mousemove', this.boundDragMove);
    window.removeEventListener('mouseup', this.boundDragEnd);
  }

  private bindResize() {
    const handles = this.container.querySelectorAll<HTMLElement>('.resize-handle');
    handles.forEach((handle) => {
      handle.addEventListener('mousedown', (e: MouseEvent) => {
        if (this.isMaximized) return;
        e.preventDefault();
        e.stopPropagation();
        if (this.id) {
          this.onActivate?.(this.id);
        }
        const dir = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].find((d) =>
          handle.classList.contains(`resize-${d}`)
        ) || '';
        this.isResizing = true;
        this.resizeDirection = dir;
        this.resizeStartX = e.clientX;
        this.resizeStartY = e.clientY;
        this.resizeStartW = this.container.offsetWidth;
        this.resizeStartH = this.container.offsetHeight;
        this.resizeStartLeft = parseFloat(this.container.style.left) || 0;
        this.resizeStartTop = parseFloat(this.container.style.top) || 0;
        window.addEventListener('mousemove', this.boundResizeMove);
        window.addEventListener('mouseup', this.boundResizeEnd);
      });
    });
  }

  private bindTitleRename() {
    const titleBar = this.container.querySelector('.title-bar') as HTMLDivElement;
    titleBar.addEventListener('dblclick', (e) => {
      if ((e.target as HTMLElement).closest('.window-controls')) return;
      e.stopPropagation();
      e.preventDefault();
      const nameEl = this.container.querySelector('.terminal-name') as HTMLSpanElement;
      if (nameEl) {
        this.startTitleRename(nameEl);
      }
    });
  }

  private startTitleRename(nameEl: HTMLSpanElement) {
    const current = nameEl.textContent || '';
    const input = document.createElement('input');
    input.className = 'title-rename-input';
    input.value = current;
    input.style.cssText = `
      background: var(--bg-surface0);
      border: 1px solid var(--accent);
      color: var(--text);
      font-size: 12px;
      font-weight: 500;
      padding: 1px 6px;
      border-radius: 4px;
      outline: none;
      width: ${Math.max(100, nameEl.offsetWidth + 20)}px;
      font-family: inherit;
    `;
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    const finish = () => {
      const newName = input.value.trim();
      const span = document.createElement('span');
      span.className = 'terminal-name';
      span.textContent = newName || current;
      input.replaceWith(span);
      // Re-bind rename on new element
      span.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.startTitleRename(span);
      });
    };

    input.addEventListener('blur', finish);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = current; input.blur(); }
    });
  }

  private onResizeMove(e: MouseEvent) {
    if (!this.isResizing) return;
    const { zoom } = this.canvasController.getState();
    const dx = (e.clientX - this.resizeStartX) / zoom;
    const dy = (e.clientY - this.resizeStartY) / zoom;
    const dir = this.resizeDirection;

    let newLeft = this.resizeStartLeft;
    let newTop = this.resizeStartTop;
    let newW = this.resizeStartW;
    let newH = this.resizeStartH;

    if (dir.includes('e')) newW = Math.max(200, this.resizeStartW + dx);
    if (dir.includes('s')) newH = Math.max(100, this.resizeStartH + dy);
    if (dir.includes('w')) {
      const proposedW = this.resizeStartW - dx;
      if (proposedW >= 200) {
        newW = proposedW;
        newLeft = this.resizeStartLeft + dx;
      }
    }
    if (dir.includes('n')) {
      const proposedH = this.resizeStartH - dy;
      if (proposedH >= 100) {
        newH = proposedH;
        newTop = this.resizeStartTop + dy;
      }
    }

    const snapped = this.canvasController.snapRect({
      x: newLeft,
      y: newTop,
      w: newW,
      h: newH,
    }, {
      sourceId: this.id,
      mode: 'resize',
      direction: dir,
    });

    this.container.style.left = `${snapped.x}px`;
    this.container.style.top = `${snapped.y}px`;
    this.container.style.width = `${snapped.w}px`;
    this.container.style.height = `${snapped.h}px`;
  }

  private onResizeEnd() {
    if (!this.isResizing) return;
    this.isResizing = false;
    window.removeEventListener('mousemove', this.boundResizeMove);
    window.removeEventListener('mouseup', this.boundResizeEnd);
    this.canvasController.clearGuides();
    this.updateFontSizeAndFit();
    // Reposition suggestion popup if visible
    if (this.commandSuggest.isVisible()) {
      this.positionSuggestPopup();
    }
  }

  toggleMinimize() {
    this.isMinimized = !this.isMinimized;
    this.container.classList.toggle('minimized', this.isMinimized);
    if (!this.isMinimized) {
      setTimeout(() => {
        this.fitAddon.fit();
      }, 50);
    }
  }

  toggleMaximize() {
    if (this.isMaximized) {
      if (this.savedRect) {
        this.container.style.left = `${this.savedRect.x}px`;
        this.container.style.top = `${this.savedRect.y}px`;
        this.container.style.width = `${this.savedRect.w}px`;
        this.container.style.height = `${this.savedRect.h}px`;
      }
      this.isMaximized = false;
    } else {
      this.savedRect = {
        x: parseFloat(this.container.style.left) || 0,
        y: parseFloat(this.container.style.top) || 0,
        w: this.container.offsetWidth,
        h: this.container.offsetHeight,
      };
      const viewport = this.container.closest('#app-viewport')!;
      const { zoom, panX, panY } = this.canvasController.getState();
      this.container.style.left = `${-panX / zoom}px`;
      this.container.style.top = `${-panY / zoom}px`;
      this.container.style.width = `${viewport.clientWidth / zoom}px`;
      this.container.style.height = `${viewport.clientHeight / zoom}px`;
      this.isMaximized = true;
    }
    setTimeout(() => {
      this.updateFontSizeAndFit();
    }, 50);
  }

  async close() {
    this.commandSuggest.hide();
    this.closeTerminalContextMenu();
    this.selectionOverlays.forEach((overlay) => overlay.remove());
    this.selectionOverlays = [];
    if (this.id) {
      try {
        await invoke('kill_pty', { sessionId: this.id });
      } catch {
        // Ignore
      }
    }
    this.unlisten?.();
    window.removeEventListener('mousemove', this.boundDragMove);
    window.removeEventListener('mouseup', this.boundDragEnd);
    window.removeEventListener('mousemove', this.boundResizeMove);
    window.removeEventListener('mouseup', this.boundResizeEnd);
    this.container.style.transition = 'opacity 0.15s, transform 0.15s';
    this.container.style.opacity = '0';
    this.container.style.transform = 'scale(0.95)';
    setTimeout(() => {
      this.container.remove();
      this.term.dispose();
    }, 150);
  }

  getId(): string {
    return this.id;
  }

  focus() {
    this.term.focus();
    this.container.classList.add('focused');
    this.container.classList.remove('focus-pulse');
    void this.container.offsetWidth;
    this.container.classList.add('focus-pulse');
  }

  blur() {
    this.container.classList.remove('focused');
  }

  getCwd(): string {
    return this.cwdPath;
  }

  getTitle(): string {
    const nameEl = this.container.querySelector('.terminal-name') as HTMLSpanElement;
    return nameEl?.textContent || '';
  }

  getRect(): { x: number; y: number; w: number; h: number } {
    return {
      x: parseFloat(this.container.style.left) || 0,
      y: parseFloat(this.container.style.top) || 0,
      w: this.container.offsetWidth,
      h: this.container.offsetHeight,
    };
  }

  getLaunchOptions(): TerminalLaunchOptions {
    if (this.launchOptions.mode === 'ssh') {
      return { ...this.launchOptions };
    }
    return {
      ...this.launchOptions,
      cwd: this.cwdPath || this.launchOptions.cwd,
    };
  }

  setTheme(theme: string) {
    this.term.options.theme = getTermTheme(theme);
  }

  setZIndex(zIndex: number) {
    this.container.style.zIndex = String(zIndex);
  }

  async sendText(text: string) {
    if (!this.id || !text) return;
    await invoke('write_pty', { sessionId: this.id, data: text });
    this.focus();
  }

  private calcFontSize(w: number, h: number): number {
    const area = w * h;
    const refArea = 700 * 450;
    const scale = Math.sqrt(area / refArea);
    return Math.max(8, Math.min(26, Math.round(14 * scale)));
  }

  private updateFontSizeAndFit() {
    const w = this.container.offsetWidth;
    const h = this.container.offsetHeight;
    const newSize = this.calcFontSize(w, h);
    if (newSize !== this.term.options.fontSize) {
      this.term.options.fontSize = newSize;
    }
    this.fitAddon.fit();
    if (this.id) {
      invoke('resize_pty', {
        sessionId: this.id,
        cols: this.term.cols,
        rows: this.term.rows,
      }).catch(console.error);
    }
  }

  private getOverlayMetrics(): {
    terminalBody: HTMLElement;
    offsetX: number;
    offsetY: number;
    colWidth: number;
    rowHeight: number;
    cols: number;
    rows: number;
    cursorX: number;
    cursorY: number;
  } | null {
    const terminalBody = this.container.querySelector('.terminal-body') as HTMLElement | null;
    if (!terminalBody || this.term.cols <= 0 || this.term.rows <= 0) return null;

    const screen = terminalBody.querySelector('.xterm-screen') as HTMLElement | null;
    const host = screen || terminalBody;
    const hostRect = host.getBoundingClientRect();
    const terminalRect = terminalBody.getBoundingClientRect();
    if (!hostRect.width || !hostRect.height) return null;

    const buffer = this.term.buffer.active;
    return {
      terminalBody,
      offsetX: hostRect.left - terminalRect.left,
      offsetY: hostRect.top - terminalRect.top,
      colWidth: hostRect.width / this.term.cols,
      rowHeight: hostRect.height / this.term.rows,
      cols: this.term.cols,
      rows: this.term.rows,
      cursorX: buffer.cursorX,
      cursorY: buffer.cursorY,
    };
  }

  private ensureLineStartCell() {
    if (this.lineStartCell !== null) return;
    const metrics = this.getOverlayMetrics();
    if (!metrics) return;
    this.lineStartCell = metrics.cursorY * metrics.cols + metrics.cursorX - this.cursorPos;
  }

  private getLineStartCell(metrics: { cols: number; cursorX: number; cursorY: number }): number {
    if (this.lineStartCell === null) {
      this.lineStartCell = metrics.cursorY * metrics.cols + metrics.cursorX - this.cursorPos;
    }
    return this.lineStartCell;
  }

  private getCursorCell(metrics: { cols: number; cursorX: number; cursorY: number }): number {
    return this.getLineStartCell(metrics) + this.cursorPos;
  }

  private ensureSelectionOverlayCount(count: number, terminalBody: HTMLElement) {
    while (this.selectionOverlays.length < count) {
      const overlay = document.createElement('div');
      overlay.className = 'line-selection-overlay';
      overlay.style.display = 'none';
      terminalBody.appendChild(overlay);
      this.selectionOverlays.push(overlay);
    }
  }

  private mod(value: number, divisor: number): number {
    return ((value % divisor) + divisor) % divisor;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
