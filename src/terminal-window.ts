import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { CanvasController, PtyOutputEvent, SSHProfile, SuggestionItem, TerminalLaunchOptions } from './types';
import { CommandSuggest } from './command-suggest';
import { resolvePreviewPath, resolveSshPreviewPath } from './command-intercept';
import { openLocalFileEditor, openRemoteFileEditor } from './file-editor';
import type { ShortcutManager } from './shortcut-manager';
import { onLangChange, t } from './i18n';

const DARK_THEME = {
  background: '#1a1b2e',
  foreground: '#a9b1d6',
  cursor: '#c0caf5',
  selectionBackground: 'rgba(122, 162, 247, 0.28)',
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
  selectionBackground: 'rgba(0, 113, 227, 0.18)',
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
  selectionBackground: 'rgba(13, 122, 109, 0.18)',
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

type TerminalHostMode = 'canvas' | 'native-window';

export class TerminalWindow {
  private id = '';
  private container: HTMLDivElement;
  private term: Terminal;
  private fitAddon: FitAddon;
  private unlisten: UnlistenFn | null = null;
  private unlistenLang: (() => void) | null = null;
  private canvasController: CanvasController;
  private commandSuggest: CommandSuggest;
  private currentLine = '';
  private cursorPos = 0;
  private lineStartCell: number | null = null;
  private selectionAnchor: number | null = null;
  private selectionOverlays: HTMLDivElement[] = [];
  private terminalContextMenu: HTMLDivElement | null = null;
  private highlightedRows = new Set<HTMLDivElement>();
  private currentGhostText = '';
  private currentGhostReplacement = '';
  private currentGhostPreserveLeadingWhitespace = false;
  private overlaySyncFrame: number | null = null;
  private syntaxRefreshFrame: number | null = null;
  private pendingWriteFrame: number | null = null;
  private pendingOutput = '';
  private lastOverlayPositionStale = false;
  private overlayMismatchCount = 0;
  private passwordQueue: string[] = [];
  private acceptedUnknownHost = false;
  private passwordPromptBuffer = '';
  private sshHandshakeDone = false;

  // Freeze state: pause terminal writes during drag/resize
  private frozen = false;
  private frozenOutput: string[] = [];

  // Drag state
  private isDragging = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private boundDragMove: (e: MouseEvent) => void;
  private boundDragEnd: () => void;
  private dragRaf: number | null = null;
  private pendingDragEvent: MouseEvent | null = null;

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
  private resizeRaf: number | null = null;
  private pendingResizeEvent: MouseEvent | null = null;

  // Minimize/Maximize state
  private isMinimized = false;
  private isMaximized = false;
  private savedRect: { x: number; y: number; w: number; h: number } | null = null;

  // Focus & CWD state
  private cwdPath = '';
  private ghostOverlay: HTMLDivElement | null = null;
  private launchOptions: TerminalLaunchOptions = { mode: 'local' };
  private appWindow = getCurrentWindow();

  public onActivate: ((id: string) => void) | null = null;
  public onCommandExecuted: ((command: string, cwd: string) => void | Promise<void>) | null = null;
  public onCwdChange: ((cwd: string) => void) | null = null;
  public onAddMappingFromSelection: ((text: string) => void) | null = null;
  public onCloseRequested: ((id: string) => void) | null = null;
  public onSelectionCopied: (() => void) | null = null;

  constructor(
    parentEl: HTMLElement,
    private x: number,
    private y: number,
    private width: number,
    private height: number,
    canvasController: CanvasController,
    commandSuggest: CommandSuggest,
    private shortcutManager?: ShortcutManager,
    private hostMode: TerminalHostMode = 'canvas'
  ) {
    this.canvasController = canvasController;
    this.commandSuggest = commandSuggest;
    this.container = this.buildDOM(parentEl);
    this.container.dataset.initStage = 'dom';
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
      cursorWidth: 1,
    });
    this.container.dataset.initStage = 'terminal';

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
    this.container.dataset.initStage = 'bindings';

    this.fitAddon = new FitAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.loadAddon(new WebLinksAddon());
    this.container.dataset.initStage = 'addons';

    try {
      const unicode = this.term.unicode as { activeVersion?: string } | undefined;
      if (unicode && typeof unicode.activeVersion === 'string') {
        unicode.activeVersion = '11';
      }
    } catch {
      // Unicode 11 is optional; keep terminal usable when unavailable.
    }

    const body = this.container.querySelector('.terminal-body') as HTMLDivElement;
    this.term.open(body);
    this.installZoomMouseFix(body);
    this.bindSelectionCopy(body);
    this.term.onRender(() => {
      if (!this.currentLine.trim() || this.isInAltBuffer()) return;
      this.scheduleSyntaxHighlightRefresh();
    });
    this.unlistenLang = onLangChange(() => {
      if (!this.launchOptions.profileName) {
        const nameEl = this.container.querySelector('.terminal-name') as HTMLSpanElement | null;
        if (nameEl) {
          nameEl.textContent = t('terminal.unnamed');
        }
      }
    });
    this.container.dataset.initStage = 'opened';
  }

  async initPty(options: TerminalLaunchOptions = {}) {
    this.launchOptions = { mode: 'local', ...options };
    this.passwordQueue = [...(this.launchOptions.passwordSequence || [])];
    this.acceptedUnknownHost = false;
    this.passwordPromptBuffer = '';
    this.fitAddon.fit();
    const cols = this.term.cols;
    const rows = this.term.rows;

    const nameEl = this.container.querySelector('.terminal-name') as HTMLSpanElement;

    let sessionId = '';
    this.unlisten = await listen<PtyOutputEvent>('pty-output', (event) => {
      if (event.payload.session_id === sessionId) {
        const data = event.payload.data;
        if (this.frozen) {
          this.frozenOutput.push(data);
          return;
        }
        this.extractTitleFromOsc(data);
        this.handleSshHandshakeOutput(data);
        this.enqueueTerminalOutput(data);
      }
    });

    sessionId = await invoke<string>('create_pty', { cols, rows, cwd: this.launchOptions.cwd || null });
    this.id = sessionId;
    this.container.dataset.sessionId = sessionId;

    // Save initial cwd if provided
    if (this.launchOptions.cwd) {
      this.cwdPath = this.launchOptions.cwd;
    }

    nameEl.textContent = this.launchOptions.profileName || t('terminal.unnamed');

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

    this.term.onCursorMove(() => {
      if (this.frozen) return;
      this.scheduleOverlayReposition();
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
    // In TUI mode (alternate screen buffer), don't track line input or show suggestions
    if (this.isInAltBuffer()) {
      return false;
    }

    this.term.clearSelection();

    if (data === '\r') {
      const rawLine = this.currentLine;
      const trimmed = rawLine.trim();
      this.currentLine = '';
      this.cursorPos = 0;
      this.lineStartCell = null;
      this.lastOverlayPositionStale = false;

      this.clearLineSelection();
      this.commandSuggest.hide();
      this.hideSyntaxHighlight();
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

      this.lastOverlayPositionStale = false;
      if (data === '\x7f' || data === '\b') {
        await this.replaceLineSelection('');
      } else {
        await this.replaceLineSelection(data);
      }
      void this.refreshSuggestions();
      return true;
    }

    if (data === '\x7f' || data === '\b') {
      // Backspace
      if (this.cursorPos > 0) {
  
        this.lastOverlayPositionStale = false;
        this.currentLine = `${this.currentLine.slice(0, this.cursorPos - 1)}${this.currentLine.slice(this.cursorPos)}`;
        this.cursorPos -= 1;
      }
    } else if (data === '\x03') {
      // Ctrl+C
      this.currentLine = '';
      this.cursorPos = 0;
      this.lineStartCell = null;
      this.lastOverlayPositionStale = false;

      this.clearLineSelection();
      this.hideSyntaxHighlight();
      this.hideGhostText();
    } else if (data === '\x15') {
      // Ctrl+U - clear line
      this.currentLine = '';
      this.cursorPos = 0;
      this.lineStartCell = null;
      this.lastOverlayPositionStale = false;

      this.clearLineSelection();
      this.hideSyntaxHighlight();
      this.hideGhostText();
    } else if (this.isPrintableInput(data)) {
      this.ensureLineStartCell();

      this.lastOverlayPositionStale = false;
      this.currentLine = `${this.currentLine.slice(0, this.cursorPos)}${data}${this.currentLine.slice(this.cursorPos)}`;
      this.cursorPos += data.length;
    } else if (data === '\t') {
      this.ensureLineStartCell();
      return false;
    }

    void this.refreshSuggestions();
    return false;
  }

  private isPrintableInput(data: string): boolean {
    return data.length > 0 && !/[\x00-\x1f\x7f]/.test(data);
  }

  private async tryOpenPreview(commandLine: string): Promise<boolean> {
    if (this.launchOptions.mode === 'ssh' && this.launchOptions.profileId) {
      const sshPath = resolveSshPreviewPath(commandLine);
      if (!sshPath) return false;
      const profiles = await invoke<SSHProfile[]>('load_ssh_profiles');
      const profile = profiles.find((p) => p.id === this.launchOptions.profileId);
      if (!profile) return false;
      openRemoteFileEditor(sshPath, profile, profiles);
      return true;
    }
    const path = resolvePreviewPath(commandLine, this.cwdPath);
    if (!path) return false;
    openLocalFileEditor(path, commandLine);
    return true;
  }

  private async refreshSuggestions() {
    if (this.isInAltBuffer()) {
      this.overlayMismatchCount = 0;
      this.commandSuggest.hide();
      this.hideSyntaxHighlight();
      this.hideGhostText();
      return;
    }
    if (this.lastOverlayPositionStale) {
      this.overlayMismatchCount = 0;
      this.commandSuggest.hide();
      this.hideSyntaxHighlight();
      this.hideGhostText();
      return;
    }
    // Check if cursor position matches our tracked position before showing suggestions
    if (this.currentLine.trim() && this.lineStartCell !== null) {
      const metrics = this.getOverlayMetrics();
      if (metrics) {
        const expectedCell = this.lineStartCell + this.cursorPos;
        const actualCell = metrics.cursorY * metrics.cols + metrics.cursorX;
        if (Math.abs(expectedCell - actualCell) > 3) {
          this.overlayMismatchCount += 1;
          if (this.overlayMismatchCount >= 2) {
            this.lastOverlayPositionStale = true;
          }
          this.lineStartCell = null;
          this.commandSuggest.hide();
          this.hideSyntaxHighlight();
          this.hideGhostText();
          return;
        }
        this.overlayMismatchCount = 0;
      }
    }
    if (this.currentLine.trim()) {
      this.showSyntaxHighlight();
      this.commandSuggest.clearTemporaryItems();
      const hasSuggestions = await this.commandSuggest.update(this.currentLine);
      if (hasSuggestions) {
        this.positionSuggestPopup();
      }
      this.updateGhostText();
      return;
    }
    this.commandSuggest.hide();
    this.hideSyntaxHighlight();
    this.hideGhostText();
  }

  private updateGhostText() {
    const visibleItems = this.commandSuggest.getVisibleItems();
    const activeItem = this.commandSuggest.getActiveItem();
    const ghost = visibleItems.length > 0
      ? this.commandSuggest.getGhostSuggestionForItem(this.currentLine, activeItem || visibleItems[0])
      : this.commandSuggest.getGhostSuggestion(this.currentLine);
    if (!ghost || !ghost.text.trim()) {
      this.hideGhostText();
      return;
    }
    this.currentGhostText = ghost.text;
    const acceptance = this.resolveGhostAcceptance(ghost.item, ghost.text);
    this.currentGhostReplacement = acceptance.value;
    this.currentGhostPreserveLeadingWhitespace = acceptance.preserveLeadingWhitespace;
    this.showGhostText(ghost.text);
  }

  private updateGhostTextForItem(item: SuggestionItem | null) {
    if (!item) {
      this.updateGhostText();
      return;
    }

    const ghost = this.commandSuggest.getGhostSuggestionForItem(this.currentLine, item);
    if (!ghost || !ghost.text.trim()) {
      this.hideGhostText();
      return;
    }

    this.currentGhostText = ghost.text;
    const acceptance = this.resolveGhostAcceptance(ghost.item, ghost.text);
    this.currentGhostReplacement = acceptance.value;
    this.currentGhostPreserveLeadingWhitespace = acceptance.preserveLeadingWhitespace;
    this.showGhostText(ghost.text);
  }

  private showGhostText(text: string) {
    if (this.isInAltBuffer()) {
      this.hideGhostText();
      return;
    }
    const terminalBody = this.container.querySelector('.terminal-body') as HTMLDivElement;
    const metrics = this.getOverlayMetrics();
    if (!metrics || this.cursorPos !== this.currentLine.length) {
      this.hideGhostText();
      return;
    }

    if (!this.ghostOverlay) {
      this.ghostOverlay = document.createElement('div');
      this.ghostOverlay.className = 'ghost-text-overlay';
      terminalBody.appendChild(this.ghostOverlay);
    }

    const left = metrics.offsetX + metrics.cursorX * metrics.colWidth;
    const top = metrics.offsetY + metrics.cursorY * metrics.rowHeight;

    const xtermScreen = terminalBody.querySelector('.xterm-screen') as HTMLElement | null;
    const rows = xtermScreen?.querySelectorAll<HTMLDivElement>(':scope .xterm-rows > div');
    let rowTop = top;
    if (rows && rows[metrics.cursorY]) {
      const bodyRect = terminalBody.getBoundingClientRect();
      const rowRect = rows[metrics.cursorY].getBoundingClientRect();
      rowTop = rowRect.top - bodyRect.top;
    }

    this.ghostOverlay.textContent = text;
    this.ghostOverlay.style.left = `${left}px`;
    this.ghostOverlay.style.top = `${rowTop}px`;
    this.ghostOverlay.style.height = `${metrics.rowHeight}px`;
    this.ghostOverlay.style.maxWidth = `${Math.max(metrics.terminalBody.clientWidth - left - 12, 64)}px`;
    this.ghostOverlay.style.fontFamily = this.term.options.fontFamily || 'monospace';
    this.ghostOverlay.style.fontSize = `${this.term.options.fontSize || 14}px`;
    this.ghostOverlay.style.display = 'block';
  }

  private showSyntaxHighlight() {
    if (this.isInAltBuffer()) return;

    const metrics = this.getOverlayMetrics();
    if (!metrics || !this.currentLine.trim()) return;

    const rows = this.container.querySelectorAll<HTMLDivElement>('.terminal-body .xterm-rows > div');
    if (rows.length === 0) return;

    const classes = buildInputSyntaxClasses(this.currentLine);
    const startCell = this.getLineStartCell(metrics);
    const endCell = startCell + classes.length;
    const startRow = Math.floor(startCell / metrics.cols);
    const endRow = Math.floor(Math.max(startCell, endCell - 1) / metrics.cols);
    const nextHighlightedRows = new Set<HTMLDivElement>();

    for (let rowIndex = startRow; rowIndex <= endRow; rowIndex += 1) {
      const rowEl = rows[rowIndex];
      if (!rowEl) continue;
      nextHighlightedRows.add(rowEl);

      const rowStartCell: number = rowIndex * metrics.cols;
      const segmentStart = Math.max(startCell, rowStartCell);
      const segmentEnd = Math.min(endCell, rowStartCell + metrics.cols);
      if (segmentEnd <= segmentStart) continue;

      const cells = expandRenderedRowCells(rowEl, metrics.cols);
      for (let absoluteCell = segmentStart; absoluteCell < segmentEnd; absoluteCell += 1) {
        const colIndex = absoluteCell - rowStartCell;
        const inputIndex = absoluteCell - startCell;
        const syntaxClass = classes[inputIndex];
        if (!syntaxClass || cells[colIndex]?.isCursor) continue;
        cells[colIndex].syntaxClass = syntaxClass;
      }

      rowEl.innerHTML = cells.map((cell) => renderRowCell(cell)).join('');
    }

    for (const row of this.highlightedRows.values()) {
      if (nextHighlightedRows.has(row)) continue;
      this.clearSyntaxHighlightRow(row);
    }

    this.highlightedRows = nextHighlightedRows;
  }

  private hideGhostText() {
    this.currentGhostText = '';
    this.currentGhostReplacement = '';
    this.currentGhostPreserveLeadingWhitespace = false;
    if (this.ghostOverlay) {
      this.ghostOverlay.textContent = '';
      this.ghostOverlay.style.display = 'none';
    }
  }

  private hideSyntaxHighlight() {
    if (this.highlightedRows.size === 0) return;
    for (const row of this.highlightedRows.values()) {
      this.clearSyntaxHighlightRow(row);
    }
    this.highlightedRows.clear();
  }

  private clearSyntaxHighlightRow(row: HTMLDivElement) {
    if (!row.isConnected) return;
    const cells = expandRenderedRowCells(row);
    row.innerHTML = cells.map((cell) => renderRowCell({ ...cell, syntaxClass: '' })).join('');
  }

  private async acceptGhostText() {
    const ghost = this.currentGhostText;
    if (!ghost) return;
    const replacement = this.currentGhostReplacement;
    const preserveLeadingWhitespace = this.currentGhostPreserveLeadingWhitespace;
    if (replacement) {
      this.commandSuggest.hide(false);
      await this.replaceCurrentInput(replacement, preserveLeadingWhitespace);
      return;
    }

    this.hideGhostText();
    this.commandSuggest.hide(false);
    await invoke('write_pty', { sessionId: this.id, data: ghost });
    this.currentLine += ghost;
    this.cursorPos = this.currentLine.length;
    this.lineStartCell = null;
    this.scheduleSuggestionRefresh();
  }

  private bindCommandSuggest() {
    // When user selects a command from suggestions
    this.commandSuggest.onSelect = (item: SuggestionItem) => {
      void this.replaceCurrentInput(this.resolveSuggestionReplacement(item), item.type === 'completion');
    };
    this.commandSuggest.onActiveChange = (item) => {
      this.updateGhostTextForItem(item);
    };

    this.container.addEventListener('keydown', (e: KeyboardEvent) => {
      if (this.handleClipboardShortcut(e)) {
        return;
      }

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

  private resolveSuggestionReplacement(item: SuggestionItem): string {
    switch (item.type) {
      case 'history':
        return item.executeText || item.insertText;
      case 'mapping':
        return item.executeText;
      case 'completion':
        return item.insertText || item.executeText || item.usage;
      case 'command':
      default:
        return item.usage || item.insertText || item.executeText;
    }
  }

  private resolveGhostAcceptance(item: SuggestionItem, ghostText: string): {
    value: string;
    preserveLeadingWhitespace: boolean;
  } {
    const replacement = this.resolveSuggestionReplacement(item);
    const trimmedInput = this.currentLine.trimStart();
    const normalizedInput = normalizeSuggestionValue(trimmedInput);
    const normalizedReplacement = normalizeSuggestionValue(replacement);

    if (item.type === 'completion') {
      return {
        value: replacement,
        preserveLeadingWhitespace: true,
      };
    }

    if (!trimmedInput) {
      return {
        value: replacement,
        preserveLeadingWhitespace: false,
      };
    }

    if (normalizedReplacement && !normalizedReplacement.startsWith(normalizedInput)) {
      return {
        value: replacement,
        preserveLeadingWhitespace: false,
      };
    }

    return {
      value: `${trimmedInput}${ghostText}`,
      preserveLeadingWhitespace: false,
    };
  }

  private async replaceCurrentInput(nextValue: string, preserveLeadingWhitespace = false) {
    if (!this.id) return;
    this.term.clearSelection();
    const leadingSpaces = this.currentLine.match(/^\s*/)?.[0] || '';
    const replacement = preserveLeadingWhitespace ? nextValue : `${leadingSpaces}${nextValue}`;
    await this.moveCursorTo(this.currentLine.length);
    // Use backspace-space-backspace to erase the current line instead of Ctrl+U (\x15).
    // Ctrl+U does not reliably clear the input line on Windows PowerShell, causing
    // the control character to appear literally in the terminal (e.g. "cd^Ucd").
    const erase = '\b \b'.repeat(this.currentLine.length);
    await invoke('write_pty', { sessionId: this.id, data: erase });
    await invoke('write_pty', { sessionId: this.id, data: replacement });
    this.currentLine = replacement;
    this.cursorPos = replacement.length;
    this.lineStartCell = null;
    this.lastOverlayPositionStale = false;
    this.overlayMismatchCount = 0;
    this.clearLineSelection();
    this.hideGhostText();
    this.scheduleSuggestionRefresh();
  }

  private scheduleSuggestionRefresh() {
    this.cancelOverlaySync();
    this.overlaySyncFrame = window.requestAnimationFrame(() => {
      this.overlaySyncFrame = null;
      this.lineStartCell = null;
      void this.refreshSuggestions();
    });
  }

  private isInAltBuffer(): boolean {
    try {
      return this.term.buffer.active.type === 'alternate';
    } catch {
      return false;
    }
  }

  private scheduleOverlayReposition() {
    this.cancelOverlaySync();
    this.overlaySyncFrame = window.requestAnimationFrame(() => {
      this.overlaySyncFrame = null;
      if (this.isInAltBuffer()) {
        this.overlayMismatchCount = 0;
        this.lineStartCell = null;
        this.hideSyntaxHighlight();
        this.hideGhostText();
        this.commandSuggest.hide();
        return;
      }
      if (!this.currentLine.trim()) {
        this.overlayMismatchCount = 0;
        this.lineStartCell = null;
        this.hideSyntaxHighlight();
        this.hideGhostText();
        this.commandSuggest.hide();
        return;
      }
      // Detect TUI apps that don't use alternate screen buffer (e.g., Claude CLI).
      // When a TUI moves the cursor, the expected cell (based on our line tracking)
      // won't match the actual cursor position — suppress overlays in that case.
      if (this.lineStartCell !== null) {
        const metrics = this.getOverlayMetrics();
        if (metrics) {
          const expectedCell = this.lineStartCell + this.cursorPos;
          const actualCell = metrics.cursorY * metrics.cols + metrics.cursorX;
          if (Math.abs(expectedCell - actualCell) > 3) {
            this.overlayMismatchCount += 1;
            if (this.overlayMismatchCount >= 2) {
              this.lastOverlayPositionStale = true;
            }
            this.lineStartCell = null;
            this.hideSyntaxHighlight();
            this.hideGhostText();
            this.commandSuggest.hide();
            return;
          }
          this.overlayMismatchCount = 0;
        }
      }
      this.lineStartCell = null;
      this.showSyntaxHighlight();
      if (this.commandSuggest.isVisible()) {
        this.positionSuggestPopup();
      }
      this.updateGhostText();
    });
  }

  private cancelOverlaySync() {
    if (this.overlaySyncFrame !== null) {
      window.cancelAnimationFrame(this.overlaySyncFrame);
      this.overlaySyncFrame = null;
    }
  }

  private scheduleSyntaxHighlightRefresh() {
    if (this.syntaxRefreshFrame !== null) {
      window.cancelAnimationFrame(this.syntaxRefreshFrame);
    }
    this.syntaxRefreshFrame = window.requestAnimationFrame(() => {
      this.syntaxRefreshFrame = null;
      if (!this.currentLine.trim() || this.lastOverlayPositionStale || this.isInAltBuffer()) {
        this.hideSyntaxHighlight();
        return;
      }
      this.showSyntaxHighlight();
    });
  }

  private handleClipboardShortcut(event: KeyboardEvent): boolean {
    const matchesCopy = this.shortcutManager
      ? this.shortcutManager.matches('terminal.copyText', event)
      : ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'c');
    const matchesPaste = this.shortcutManager
      ? this.shortcutManager.matches('terminal.pasteText', event)
      : ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'v');

    if (matchesCopy) {
      event.preventDefault();
      event.stopPropagation();
      void this.copySelectionOrLine();
      return true;
    }

    if (matchesPaste) {
      event.preventDefault();
      event.stopPropagation();
      void this.pasteClipboardText();
      return true;
    }

    return false;
  }

  private async copySelectionOrLine() {
    const selected = this.term.getSelection().trim();
    const lineSelection = this.getLineSelectionText();
    const fallback = this.currentLine.trim() ? this.currentLine : '';
    const text = selected || lineSelection || fallback;
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error('clipboard write failed', error);
    }
  }

  private async pasteClipboardText() {
    if (!this.id) return;

    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      await invoke('write_pty', { sessionId: this.id, data: text });

      if (/[\r\n]/.test(text)) {
        this.currentLine = '';
        this.cursorPos = 0;
        this.lineStartCell = null;
      this.clearLineSelection();
        this.commandSuggest.hide();
        this.hideSyntaxHighlight();
        this.hideGhostText();
        return;
      }

      this.ensureLineStartCell();
      this.currentLine = `${this.currentLine.slice(0, this.cursorPos)}${text}${this.currentLine.slice(this.cursorPos)}`;
      this.cursorPos += text.length;
      void this.refreshSuggestions();
    } catch (error) {
      console.error('clipboard read failed', error);
    }
  }

  private handleLineEditingShortcut(event: KeyboardEvent): boolean {
    if (this.isInAltBuffer() || this.lastOverlayPositionStale) {
      return false;
    }

    const shouldHandleInlineEditing = Boolean(this.currentLine || this.currentGhostText || this.hasLineSelection());
    if (!shouldHandleInlineEditing) {
      return false;
    }

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

    // Use getBoundingClientRect() which reflects the current CSS transform
    // (canvas translate + scale) to get accurate screen-space coordinates.
    const screen = metrics.terminalBody.querySelector('.xterm-screen') as HTMLElement | null;
    const host = screen || metrics.terminalBody;
    const hostRect = host.getBoundingClientRect();

    // Screen-space cell dimensions (already scaled by canvas zoom)
    const scaledColWidth = hostRect.width / metrics.cols;
    const scaledRowHeight = hostRect.height / metrics.rows;

    const cursorScreenX = hostRect.left + metrics.cursorX * scaledColWidth;
    const cursorScreenY = hostRect.top + (metrics.cursorY + 1) * scaledRowHeight;

    this.commandSuggest.positionAtScreen(cursorScreenX, cursorScreenY);
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

  private getLineSelectionText(): string {
    const range = this.getLineSelectionRange();
    if (!range) return '';
    return this.currentLine.slice(range.start, range.end);
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
    this.lastOverlayPositionStale = false;
    this.overlayMismatchCount = 0;
    this.updateLineSelectionOverlay();
    this.scheduleOverlayReposition();
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

  private handleSshHandshakeOutput(data: string) {
    if (this.launchOptions.mode !== 'ssh') return;
    if (this.sshHandshakeDone) return;

    this.passwordPromptBuffer = `${this.passwordPromptBuffer}${data}`.slice(-1024);
    const normalized = this.passwordPromptBuffer.toLowerCase();

    if (!this.acceptedUnknownHost && normalized.includes('continue connecting (yes/no')) {
      this.acceptedUnknownHost = true;
      invoke('write_pty', { sessionId: this.id, data: 'yes\r' }).catch(console.error);
      this.passwordPromptBuffer = '';
      return;
    }

    if (this.passwordQueue.length > 0 && /(?:password|passphrase|验证|密码)[:：]\s*$/m.test(normalized)) {
      const nextPassword = this.passwordQueue.shift();
      if (!nextPassword) return;
      invoke('write_pty', { sessionId: this.id, data: `${nextPassword}\r` }).catch(console.error);
      this.passwordPromptBuffer = '';
    }

    if (this.passwordQueue.length === 0 && (this.acceptedUnknownHost || !normalized.includes('continue connecting'))) {
      this.sshHandshakeDone = true;
      this.passwordPromptBuffer = '';
    }
  }

  private buildDOM(parent: HTMLElement): HTMLDivElement {
    const el = document.createElement('div');
    el.className = `terminal-window${this.hostMode === 'native-window' ? ' terminal-window-native-host' : ''}`;
    el.style.left = `${this.x}px`;
    el.style.top = `${this.y}px`;
    el.style.width = `${this.width}px`;
    el.style.height = `${this.height}px`;
    el.innerHTML = `
      <div class="title-bar">
        <div class="title-spacer"></div>
        <span class="terminal-name">${escapeHtml(t('terminal.unnamed'))}</span>
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
      <div class="context-menu-item" data-terminal-copy>${escapeHtml(t('terminal.copyText'))}</div>
      <div class="context-menu-item" data-terminal-map>${escapeHtml(t('terminal.addMapping'))}</div>
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

  private bindSelectionCopy(body: HTMLDivElement) {
    body.addEventListener('mouseup', () => {
      const sel = this.term.getSelection();
      if (!sel || !sel.trim()) return;
      navigator.clipboard.writeText(sel).then(() => {
        this.onSelectionCopied?.();
      }).catch(() => {});
    });
  }

  private enqueueTerminalOutput(data: string) {
    if (!data) return;
    this.pendingOutput += data;
    if (this.pendingWriteFrame !== null) return;
    this.pendingWriteFrame = window.requestAnimationFrame(() => {
      this.pendingWriteFrame = null;
      const batch = this.pendingOutput;
      this.pendingOutput = '';
      if (!batch) return;
      this.term.write(batch, () => {
        this.scheduleOverlayReposition();
      });
    });
  }

  private installZoomMouseFix(body: HTMLDivElement) {
    let redispatching = false;
    let capturing = false;
    let lastZoom = 1;

    const cachedZoom = () => {
      lastZoom = this.canvasController.getState().zoom;
      return lastZoom;
    };

    const makeAdjusted = (e: MouseEvent): MouseEvent | null => {
      const zoom = lastZoom;
      if (zoom === 1) return null;

      const xtermScreen = body.querySelector('.xterm-screen') as HTMLElement | null;
      if (!xtermScreen) return null;

      const rect = xtermScreen.getBoundingClientRect();
      const adjustedClientX = rect.left + (e.clientX - rect.left) / zoom;
      const adjustedClientY = rect.top + (e.clientY - rect.top) / zoom;

      return new MouseEvent(e.type, {
        bubbles: e.bubbles,
        cancelable: e.cancelable,
        clientX: adjustedClientX,
        clientY: adjustedClientY,
        button: e.button,
        buttons: e.buttons,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        detail: e.detail,
        view: e.view,
      });
    };

    const send = (adjusted: MouseEvent) => {
      const xtermEl = body.querySelector('.xterm') as HTMLElement;
      if (!xtermEl) return;
      redispatching = true;
      xtermEl.dispatchEvent(adjusted);
      redispatching = false;
    };

    body.addEventListener('mousedown', (e: MouseEvent) => {
      if (redispatching) return;
      if (!(e.target as HTMLElement).closest('.xterm')) return;
      cachedZoom();
      if (lastZoom === 1) return;

      e.stopImmediatePropagation();
      e.preventDefault();
      capturing = true;

      const adjusted = makeAdjusted(e);
      if (adjusted) send(adjusted);
    }, true);

    const onMove = (e: MouseEvent) => {
      if (redispatching) return;
      if (!capturing) return;
      cachedZoom();
      if (lastZoom === 1) { capturing = false; return; }

      e.stopImmediatePropagation();
      e.preventDefault();

      const adjusted = makeAdjusted(e);
      if (adjusted) send(adjusted);
    };

    const onUp = (e: MouseEvent) => {
      if (!capturing) return;

      capturing = false;
      cachedZoom();
      if (lastZoom === 1) return;

      e.stopImmediatePropagation();
      e.preventDefault();

      const adjusted = makeAdjusted(e);
      if (adjusted) send(adjusted);
    };

    body.addEventListener('mousemove', onMove, true);
    body.addEventListener('mouseup', onUp, true);
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
      if (this.hostMode === 'native-window') {
        void this.appWindow.destroy().catch((error) => {
          console.error('detached window destroy failed', error);
        });
        return;
      }
      if (this.id) {
        this.onCloseRequested?.(this.id);
      } else {
        this.close();
      }
    });
    this.container.querySelector('.btn-minimize')!.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.hostMode === 'native-window') {
        void this.appWindow.minimize().catch((error) => {
          console.error('detached window minimize failed', error);
        });
        return;
      }
      this.toggleMinimize();
    });
    this.container.querySelector('.btn-maximize')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMaximize();
    });
  }

  private bindDrag() {
    const titleBar = this.container.querySelector('.title-bar') as HTMLDivElement;
    if (this.hostMode === 'native-window') {
      titleBar.addEventListener('mousedown', (e) => {
        if ((e.target as HTMLElement).closest('.window-controls')) return;
        if (e.button !== 0) return;
        e.preventDefault();
        if (this.id) {
          this.onActivate?.(this.id);
        }
        void this.appWindow.startDragging().catch((error) => {
          console.error('detached window drag failed', error);
        });
      });
      return;
    }

    let dragStartX = 0;
    let dragStartY = 0;
    let dragStarted = false;

    titleBar.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('.window-controls')) return;
      if (this.isMaximized) return;
      if (e.button !== 0) return; // left button only
      e.preventDefault();
      if (this.id) {
        this.onActivate?.(this.id);
      }
      this.container.classList.remove('focus-pulse');
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragStarted = false;
      const { zoom, panX, panY } = this.canvasController.getState();
      const viewportRect = this.container.closest('#app-viewport')!.getBoundingClientRect();
      const containerLeft = parseFloat(this.container.style.left) || 0;
      const containerTop = parseFloat(this.container.style.top) || 0;
      const pointerCanvasX = (e.clientX - viewportRect.left - panX) / zoom;
      const pointerCanvasY = (e.clientY - viewportRect.top - panY) / zoom;
      this.dragOffsetX = pointerCanvasX - containerLeft;
      this.dragOffsetY = pointerCanvasY - containerTop;
      window.addEventListener('mousemove', this.boundDragMove);
      window.addEventListener('mouseup', this.boundDragEnd);
    });

    const origDragMove = this.boundDragMove;
    this.boundDragMove = (e: MouseEvent) => {
      if (!dragStarted) {
        const dx = Math.abs(e.clientX - dragStartX);
        const dy = Math.abs(e.clientY - dragStartY);
        if (dx < 4 && dy < 4) return;
        dragStarted = true;
        this.isDragging = true;
        this.freeze();
        this.container.classList.add('dragging');
      }
      origDragMove.call(this, e);
    };

    const origDragEnd = this.boundDragEnd;
    this.boundDragEnd = () => {
      this.isDragging = false;
      dragStarted = false;
      this.thaw();
      if (this.dragRaf !== null) {
        cancelAnimationFrame(this.dragRaf);
        this.dragRaf = null;
      }
      this.pendingDragEvent = null;
      this.container.classList.remove('dragging');
      this.canvasController.clearGuides();
      window.removeEventListener('mousemove', this.boundDragMove);
      window.removeEventListener('mouseup', this.boundDragEnd);
      origDragEnd.call(this);
    };
  }

  private onDragMove(e: MouseEvent) {
    if (!this.isDragging) return;
    this.pendingDragEvent = e;
    if (this.dragRaf !== null) return;
    this.dragRaf = requestAnimationFrame(() => {
      this.dragRaf = null;
      const ev = this.pendingDragEvent;
      if (!ev) return;
      const { zoom, panX, panY } = this.canvasController.getState();
      const viewportRect = this.container.closest('#app-viewport')!.getBoundingClientRect();
      const pointerCanvasX = (ev.clientX - viewportRect.left - panX) / zoom;
      const pointerCanvasY = (ev.clientY - viewportRect.top - panY) / zoom;
      const canvasX = pointerCanvasX - this.dragOffsetX;
      const canvasY = pointerCanvasY - this.dragOffsetY;
      const currentW = parseFloat(this.container.style.width) || this.container.offsetWidth;
      const currentH = parseFloat(this.container.style.height) || this.container.offsetHeight;
      const snapped = this.canvasController.snapRect({
        x: canvasX,
        y: canvasY,
        w: currentW,
        h: currentH,
      }, {
        sourceId: this.id,
        mode: 'drag',
      });
      this.container.style.left = `${snapped.x}px`;
      this.container.style.top = `${snapped.y}px`;
    });
  }

  private onDragEnd() {
    this.isDragging = false;
    if (this.dragRaf !== null) {
      cancelAnimationFrame(this.dragRaf);
      this.dragRaf = null;
    }
    this.pendingDragEvent = null;
    this.container.classList.remove('dragging');
    this.canvasController.clearGuides();
    window.removeEventListener('mousemove', this.boundDragMove);
    window.removeEventListener('mouseup', this.boundDragEnd);
  }

  private bindResize() {
    const handles = this.container.querySelectorAll<HTMLElement>('.resize-handle');
    if (this.hostMode === 'native-window') {
      const directionMap: Record<string, Parameters<typeof this.appWindow.startResizeDragging>[0]> = {
        n: 'North',
        s: 'South',
        e: 'East',
        w: 'West',
        ne: 'NorthEast',
        nw: 'NorthWest',
        se: 'SouthEast',
        sw: 'SouthWest',
      };
      handles.forEach((handle) => {
        handle.addEventListener('mousedown', (e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          if (this.id) {
            this.onActivate?.(this.id);
          }
          const dir = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].find((d) =>
            handle.classList.contains(`resize-${d}`)
          );
          if (!dir) return;
          void this.appWindow.startResizeDragging(directionMap[dir]).catch((error) => {
            console.error('detached window resize drag failed', error);
          });
        });
      });
      return;
    }

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
        this.freeze();
        this.resizeDirection = dir;
        this.resizeStartX = e.clientX;
        this.resizeStartY = e.clientY;
        this.resizeStartW = parseFloat(this.container.style.width) || this.container.offsetWidth;
        this.resizeStartH = parseFloat(this.container.style.height) || this.container.offsetHeight;
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
    this.pendingResizeEvent = e;
    if (this.resizeRaf !== null) return;
    this.resizeRaf = requestAnimationFrame(() => {
      this.resizeRaf = null;
      const ev = this.pendingResizeEvent;
      if (!ev) return;
      const { zoom } = this.canvasController.getState();
      const dx = (ev.clientX - this.resizeStartX) / zoom;
      const dy = (ev.clientY - this.resizeStartY) / zoom;
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
    });
  }

  private onResizeEnd() {
    if (!this.isResizing) return;
    this.isResizing = false;
    this.thaw();
    if (this.resizeRaf !== null) {
      cancelAnimationFrame(this.resizeRaf);
      this.resizeRaf = null;
    }
    this.pendingResizeEvent = null;
    window.removeEventListener('mousemove', this.boundResizeMove);
    window.removeEventListener('mouseup', this.boundResizeEnd);
    this.canvasController.clearGuides();
    this.updateFontSizeAndFit();
    if (this.commandSuggest.isVisible()) {
      this.positionSuggestPopup();
    }
  }

  toggleMinimize() {
    if (this.hostMode === 'native-window') {
      void this.appWindow.minimize().catch((error) => {
        console.error('detached window minimize failed', error);
      });
      return;
    }
    this.isMinimized = !this.isMinimized;
    this.container.classList.toggle('minimized', this.isMinimized);
    if (!this.isMinimized) {
      setTimeout(() => {
        this.fitAddon.fit();
      }, 50);
    }
  }

  toggleMaximize() {
    if (this.hostMode === 'native-window') {
      this.isMaximized = !this.isMaximized;
      void this.appWindow.toggleMaximize().catch((error) => {
        console.error('detached window maximize toggle failed', error);
      });
      setTimeout(() => {
        this.updateFontSizeAndFit();
      }, 50);
      return;
    }

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
    this.cancelOverlaySync();
    if (this.syntaxRefreshFrame !== null) {
      window.cancelAnimationFrame(this.syntaxRefreshFrame);
      this.syntaxRefreshFrame = null;
    }
    if (this.dragRaf !== null) {
      cancelAnimationFrame(this.dragRaf);
      this.dragRaf = null;
    }
    if (this.resizeRaf !== null) {
      cancelAnimationFrame(this.resizeRaf);
      this.resizeRaf = null;
    }
    this.commandSuggest.hide();
    this.closeTerminalContextMenu();
    this.selectionOverlays.forEach((overlay) => overlay.remove());
    this.selectionOverlays = [];
    this.highlightedRows.clear();
    if (this.id) {
      try {
        await invoke('kill_pty', { sessionId: this.id });
      } catch {
        // Ignore
      }
    }
    this.unlisten?.();
    this.unlistenLang?.();
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
    const wasFocused = this.container.classList.contains('focused');
    this.container.classList.add('focused');
    if (!wasFocused) {
      this.container.classList.remove('focus-pulse');
      void this.container.offsetWidth;
      requestAnimationFrame(() => {
        this.container.classList.add('focus-pulse');
      });
    }
  }

  blur() {
    this.term.blur();
    this.container.classList.remove('focused');
  }

  hideTransientUi() {
    this.cancelOverlaySync();
    this.commandSuggest.hide();
    this.hideSyntaxHighlight();
    this.hideGhostText();
  }

  freeze() {
    if (this.pendingWriteFrame !== null) {
      window.cancelAnimationFrame(this.pendingWriteFrame);
      this.pendingWriteFrame = null;
    }
    if (this.pendingOutput) {
      this.frozenOutput.push(this.pendingOutput);
      this.pendingOutput = '';
    }
    this.frozen = true;
    this.cancelOverlaySync();
    if (this.syntaxRefreshFrame !== null) {
      window.cancelAnimationFrame(this.syntaxRefreshFrame);
      this.syntaxRefreshFrame = null;
    }
    this.hideSyntaxHighlight();
    this.hideGhostText();
    this.commandSuggest.hide();
  }

  thaw() {
    if (!this.frozen) return;
    this.frozen = false;
    if (this.frozenOutput.length > 0) {
      const batch = this.frozenOutput.join('');
      this.frozenOutput = [];
      this.extractTitleFromOsc(batch);
      this.handleSshHandshakeOutput(batch);
      this.enqueueTerminalOutput(batch);
    }
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
      w: parseFloat(this.container.style.width) || this.width,
      h: parseFloat(this.container.style.height) || this.height,
    };
  }

  isWindowMinimized(): boolean {
    return this.isMinimized;
  }

  isWindowMaximized(): boolean {
    return this.isMaximized;
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

  async debugSetInput(value: string) {
    this.focus();
    await this.replaceCurrentInput(value, true);
    await this.waitForSuggestionCycle();
  }

  async debugHandleSuggestionKey(key: string): Promise<boolean> {
    this.focus();
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    const handled = this.commandSuggest.handleKey(event);
    if (handled) {
      await this.waitForSuggestionCycle();
    }
    return handled;
  }

  async debugRefreshSuggestions() {
    await this.refreshSuggestions();
    await this.waitForSuggestionCycle();
    return this.getSuggestionDebugState();
  }

  getSuggestionDebugState() {
    const visibleItems = this.commandSuggest.getVisibleItems();
    const activeItem = this.commandSuggest.getActiveItem();
    return {
      id: this.id,
      currentLine: this.currentLine,
      cursorPos: this.cursorPos,
      suggestionVisible: this.commandSuggest.isVisible(),
      suggestionCount: visibleItems.length,
      activeItem: activeItem ? {
        id: activeItem.id,
        title: activeItem.title,
        usage: activeItem.usage,
        type: activeItem.type,
      } : null,
      items: visibleItems.map((item) => ({
        id: item.id,
        title: item.title,
        usage: item.usage,
        description: item.description,
        sourceLabel: item.sourceLabel,
        type: item.type,
        exampleCount: item.exampleCount ?? item.examples.length,
      })),
      ghostText: this.currentGhostText,
      lineStartCell: this.lineStartCell,
      lastOverlayPositionStale: this.lastOverlayPositionStale,
    };
  }

  setRect(x: number, y: number, w: number, h: number) {
    this.container.style.left = `${x}px`;
    this.container.style.top = `${y}px`;
    this.container.style.width = `${w}px`;
    this.container.style.height = `${h}px`;
    this.isMaximized = false;
    this.savedRect = null;
    this.updateFontSizeAndFit();
  }

  setTheme(theme: string) {
    this.term.options.theme = getTermTheme(theme);
  }

  private async waitForSuggestionCycle() {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 80);
    });
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
    // Subtract title bar (38px) and terminal-body padding (2+4+4=10px)
    // so the calculation is based on the actual rendering area.
    const bodyW = w - 8; // 4px padding on each side
    const bodyH = h - 38 - 10; // title bar + vertical padding
    const area = Math.max(bodyW, 100) * Math.max(bodyH, 60);
    const refArea = 700 * 450;
    const scale = Math.pow(area / refArea, 0.35);
    return Math.max(10, Math.min(22, Math.round(14 * scale)));
  }

  private updateFontSizeAndFit() {
    const w = parseFloat(this.container.style.width) || this.container.offsetWidth;
    const h = parseFloat(this.container.style.height) || this.container.offsetHeight;
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

    // Use xterm.js internal cell dimensions for precise overlay positioning.
    // This avoids rounding errors and DPI discrepancies on Windows where
    // hostRect.width/cols can drift from the actual rendered cell width.
    let cellWidth = hostRect.width / this.term.cols;
    let cellHeight = hostRect.height / this.term.rows;
    try {
      const dims = (this.term as any)._core?._renderService?.dimensions?.css?.cell;
      if (dims && dims.width > 0 && dims.height > 0) {
        cellWidth = dims.width;
        cellHeight = dims.height;
      }
    } catch {
      // Fall back to computed values if internal API is unavailable
    }

    const buffer = this.term.buffer.active;
    return {
      terminalBody,
      offsetX: hostRect.left - terminalRect.left,
      offsetY: hostRect.top - terminalRect.top,
      colWidth: cellWidth,
      rowHeight: cellHeight,
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

function normalizeSuggestionValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function buildInputSyntaxClasses(input: string): string[] {
  const tokens = input.match(/(\s+|[^\s]+)/g) || [];
  let commandSeen = false;
  const classes: string[] = [];

  for (const token of tokens) {
    if (/^\s+$/.test(token)) {
      for (const _char of token) classes.push('');
      continue;
    }

    let className = 'input-syntax-arg';
    if (!commandSeen) {
      className = 'input-syntax-command';
      commandSeen = true;
    } else if (/^(?:\|\||&&|\||>|>>|<|2>&1|;)$/.test(token)) {
      className = 'input-syntax-operator';
    } else if (/^--?[\w-]/.test(token)) {
      className = 'input-syntax-flag';
    } else if (/^\$[{(]?[A-Za-z_]/.test(token)) {
      className = 'input-syntax-variable';
    } else if (/^~[\/\\]?/.test(token) || /^[./]/.test(token) || token.includes('/') || token.includes('\\')) {
      className = 'input-syntax-path';
    }

    for (const _char of token) classes.push(className);
  }

  return classes;
}

interface RenderedRowCell {
  char: string;
  className: string;
  style: string;
  syntaxClass: string;
  isCursor: boolean;
}

function expandRenderedRowCells(row: HTMLDivElement, cols?: number): RenderedRowCell[] {
  const cells: RenderedRowCell[] = [];
  row.querySelectorAll(':scope > span').forEach((span) => {
    const text = span.textContent || '';
    const className = stripInputSyntaxClasses(span.className || '');
    const style = span.getAttribute('style') || '';
    const isCursor = className.includes('xterm-cursor');
    for (const char of Array.from(text)) {
      cells.push({
        char,
        className,
        style,
        syntaxClass: '',
        isCursor,
      });
    }
  });

  while (typeof cols === 'number' && cells.length < cols) {
    cells.push({
      char: ' ',
      className: '',
      style: '',
      syntaxClass: '',
      isCursor: false,
    });
  }

  return typeof cols === 'number' ? cells.slice(0, cols) : cells;
}

function renderRowCell(cell: RenderedRowCell): string {
  const className = [cell.className, cell.syntaxClass].filter(Boolean).join(' ');
  const classAttr = className ? ` class="${escapeHtml(className)}"` : '';
  const styleAttr = cell.style ? ` style="${escapeHtml(cell.style)}"` : '';
  const content = cell.char === ' ' ? '&nbsp;' : escapeHtml(cell.char);
  return `<span${classAttr}${styleAttr}>${content}</span>`;
}

function stripInputSyntaxClasses(className: string): string {
  return className
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !token.startsWith('input-syntax-'))
    .join(' ');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
