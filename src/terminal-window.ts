import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { PtyOutputEvent, CanvasState } from './types';
import { CommandSuggest } from './command-suggest';

type GetCanvasState = () => CanvasState;

export class TerminalWindow {
  private id = '';
  private container: HTMLDivElement;
  private term: Terminal;
  private fitAddon: FitAddon;
  private unlisten: UnlistenFn | null = null;
  private getCanvasState: GetCanvasState;
  private commandSuggest: CommandSuggest;
  private currentLine = '';

  // Drag state
  private isDragging = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private boundDragMove: (e: MouseEvent) => void;
  private boundDragEnd: (e: MouseEvent) => void;

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

  constructor(
    parentEl: HTMLElement,
    private x: number,
    private y: number,
    private width: number,
    private height: number,
    getCanvasState: GetCanvasState,
    commandSuggest: CommandSuggest
  ) {
    this.getCanvasState = getCanvasState;
    this.commandSuggest = commandSuggest;
    this.container = this.buildDOM(parentEl);
    const baseFontSize = this.calcFontSize(this.width, this.height);
    this.term = new Terminal({
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        selectionBackground: '#45475a',
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#f5c2e7',
        cyan: '#94e2d5',
        white: '#bac2de',
      },
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
  }

  async initPty(cwd?: string) {
    this.fitAddon.fit();
    const cols = this.term.cols;
    const rows = this.term.rows;

    const nameEl = this.container.querySelector('.terminal-name') as HTMLSpanElement;

    let sessionId = '';
    this.unlisten = await listen<PtyOutputEvent>('pty-output', (event) => {
      if (event.payload.session_id === sessionId) {
        const data = event.payload.data;
        this.extractTitleFromOsc(data, nameEl);
        this.term.write(data);
      }
    });

    sessionId = await invoke<string>('create_pty', { cols, rows, cwd: cwd || null });
    this.id = sessionId;

    nameEl.textContent = `Terminal #${this.id.slice(0, 6)}`;

    // Track current line for command suggestions
    this.currentLine = '';

    this.term.onData(async (data) => {
      // Track current input line for suggestions
      this.trackInput(data);

      try {
        await invoke('write_pty', { sessionId: this.id, data });
      } catch (e) {
        console.error('write_pty error:', e);
      }
    });

    this.term.onTitleChange((title: string) => {
      const display = this.formatTitle(title);
      nameEl.textContent = display;
    });

    // Bind command suggestion to this terminal
    this.bindCommandSuggest();
  }

  /** Track what the user is typing to drive suggestions */
  private trackInput(data: string) {
    if (data === '\r') {
      // Enter pressed - clear current line
      this.currentLine = '';
      return;
    }
    if (data === '\x7f' || data === '\b') {
      // Backspace
      this.currentLine = this.currentLine.slice(0, -1);
    } else if (data === '\x03') {
      // Ctrl+C
      this.currentLine = '';
    } else if (data === '\x15') {
      // Ctrl+U - clear line
      this.currentLine = '';
    } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
      // Printable character
      this.currentLine += data;
    } else if (data === '\t') {
      // Tab - handled by suggestion selector
      return;
    }

    // Update suggestions
    if (this.currentLine.trim()) {
      const hasSuggestions = this.commandSuggest.update(this.currentLine);
      if (hasSuggestions) {
        this.positionSuggestPopup();
      }
    } else {
      this.commandSuggest.hide();
    }
  }

  private bindCommandSuggest() {
    // When user selects a command from suggestions
    this.commandSuggest.onSelect = (commandName: string) => {
      const partial = this.currentLine.trimStart().split(/\s/)[0];
      const remaining = commandName.slice(partial.length);
      if (remaining) {
        // Send the remaining characters to the PTY
        invoke('write_pty', { sessionId: this.id, data: remaining }).catch(console.error);
        this.currentLine += remaining;
      }
    };

    // Intercept xterm keyboard events for suggestion navigation
    this.container.addEventListener('keydown', (e: KeyboardEvent) => {
      if (this.commandSuggest.isVisible()) {
        const handled = this.commandSuggest.handleKey(e);
        if (handled) {
          // For Tab/Enter selection, also update tracked input
          if (e.key === 'Tab' || e.key === 'Enter') {
            // The onSelect callback already sent the remaining chars
            // We need to prevent xterm from also processing the key
          }
        }
      }
    }, true); // capture phase to intercept before xterm
  }

  private positionSuggestPopup() {
    const terminalBody = this.container.querySelector('.terminal-body') as HTMLElement;
    if (!terminalBody) return;

    const containerRect = this.container.getBoundingClientRect();

    this.commandSuggest.positionAt(terminalBody, 4, containerRect.height + 4);
  }

  private extractTitleFromOsc(data: string, nameEl: HTMLSpanElement) {
    const oscRegex = /\x1b\](0|2);([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
    let match;
    let lastTitle = '';
    while ((match = oscRegex.exec(data)) !== null) {
      lastTitle = match[2];
    }
    if (lastTitle) {
      const display = this.formatTitle(lastTitle);
      nameEl.textContent = display;
    }
  }

  private formatTitle(title: string): string {
    let path = title.trim();
    path = path.replace(/\s*[-–]\s*(cmd|powershell|pwsh|bash|sh|zsh|fish).*$/i, '').trim();
    path = path.replace(/\\/g, '/');
    path = path.replace(/^([A-Za-z]):/i, (_, letter: string) => letter.toUpperCase());

    const homePatterns = [
      { pat: /^([A-Z])\/Users\/[^/]+/, prefixLen: 0 },
      { pat: /^\/home\/[^/]+/, prefixLen: 0 },
      { pat: /^\/Users\/[^/]+/, prefixLen: 0 },
    ];
    for (const { pat } of homePatterns) {
      const match = path.match(pat);
      if (match) {
        const homePart = match[0];
        if (path === homePart || path.startsWith(homePart + '/')) {
          path = '~' + path.slice(homePart.length);
        }
        break;
      }
    }

    return path || `Terminal #${this.id.slice(0, 6)}`;
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
        <span class="terminal-name">Terminal</span>
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
    titleBar.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('.window-controls')) return;
      if (this.isMaximized) return;
      this.isDragging = true;
      const { zoom, panX, panY } = this.getCanvasState();
      const viewportRect = this.container.closest('#app-viewport')!.getBoundingClientRect();
      const containerLeft = parseFloat(this.container.style.left) || 0;
      const containerTop = parseFloat(this.container.style.top) || 0;
      this.dragOffsetX = e.clientX - (viewportRect.left + panX + containerLeft * zoom);
      this.dragOffsetY = e.clientY - (viewportRect.top + panY + containerTop * zoom);
      e.preventDefault();
      window.addEventListener('mousemove', this.boundDragMove);
      window.addEventListener('mouseup', this.boundDragEnd);
    });
  }

  private onDragMove(e: MouseEvent) {
    if (!this.isDragging) return;
    const { zoom, panX, panY } = this.getCanvasState();
    const viewportRect = this.container.closest('#app-viewport')!.getBoundingClientRect();
    const canvasX = (e.clientX - this.dragOffsetX - viewportRect.left - panX) / zoom;
    const canvasY = (e.clientY - this.dragOffsetY - viewportRect.top - panY) / zoom;
    this.container.style.left = `${canvasX}px`;
    this.container.style.top = `${canvasY}px`;
  }

  private onDragEnd() {
    this.isDragging = false;
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

  private onResizeMove(e: MouseEvent) {
    if (!this.isResizing) return;
    const { zoom } = this.getCanvasState();
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

    this.container.style.left = `${newLeft}px`;
    this.container.style.top = `${newTop}px`;
    this.container.style.width = `${newW}px`;
    this.container.style.height = `${newH}px`;
  }

  private onResizeEnd() {
    if (!this.isResizing) return;
    this.isResizing = false;
    window.removeEventListener('mousemove', this.boundResizeMove);
    window.removeEventListener('mouseup', this.boundResizeEnd);
    this.updateFontSizeAndFit();
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
      const { zoom, panX, panY } = this.getCanvasState();
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
  }

  private calcFontSize(w: number, h: number): number {
    const minDim = Math.min(w, h);
    const base = Math.round(14 * (minDim / 280));
    return Math.max(10, Math.min(26, base));
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
}
