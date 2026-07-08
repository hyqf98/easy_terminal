import { defineComponent, ref, computed, onMounted, onUnmounted, nextTick, type PropType } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { t, onLangChange } from '../../i18n';
import { getTerminalThemeStrategy } from './strategies/terminalIndex';
import { CommandIntelligence } from './commandIntelligence';
import { Perf } from '../../utils/perf';
import type { TerminalLaunchOptions, SuggestionItem, Rect, SnapOptions } from '../../types';

type WindowRect = { x: number; y: number; w: number; h: number };

let commandIntel: CommandIntelligence | null = null;
let intelInitPromise: Promise<void> | null = null;

function getCommandIntel(): CommandIntelligence | null {
  return commandIntel;
}

async function ensureIntel(): Promise<CommandIntelligence> {
  if (commandIntel) return commandIntel;
  if (intelInitPromise) {
    await intelInitPromise;
    return commandIntel!;
  }
  commandIntel = new CommandIntelligence();
  intelInitPromise = commandIntel.init();
  await intelInitPromise;
  return commandIntel;
}

// Regex to detect Shift/Ctrl/Alt modified arrow key sequences: \x1b[1;2D, \x1b[1;5C, etc.
const MODIFIED_ARROW_RE = /^\x1b\[1;\d+[ABCD]$/;

export default defineComponent({
  name: 'TerminalWindow',
  props: {
    terminalId: { type: String, required: true },
    initialX: { type: Number, default: 50 },
    initialY: { type: Number, default: 50 },
    initialWidth: { type: Number, default: 600 },
    initialHeight: { type: Number, default: 400 },
    launchOptions: { type: Object as PropType<TerminalLaunchOptions>, default: () => ({ mode: 'local' }) },
    zIndex: { type: Number, default: 1 },
    // 画布吸附：拖拽/缩放时由父组件注入 canvas.snapRect，触发对齐辅助线与吸附
    snapRect: { type: Function as PropType<(rect: Rect, options: SnapOptions) => Rect>, default: null },
    clearGuides: { type: Function as PropType<() => void>, default: null },
    // 画布当前缩放，用于把屏幕像素增量换算为画布坐标增量
    viewportZoom: { type: Number, default: 1 },
  },
  emits: ['activate', 'close', 'command-executed', 'cwd-change', 'interaction-start', 'interaction-end'],
  setup(props, { emit }) {
    const bodyRef = ref<HTMLDivElement | null>(null);
    const rootRef = ref<HTMLDivElement | null>(null);

    const terminalName = ref(props.launchOptions.profileName || t('terminal.unnamed'));
    const currentCwd = ref(props.launchOptions.cwd || '');
    const isFocused = ref(false);
    const isMinimized = ref(false);
    const isMaximized = ref(false);
    const isDragging = ref(false);
    const isResizing = ref(false);
    const suggestVisible = ref(false);
    const suggestItems = ref<SuggestionItem[]>([]);
    const suggestIndex = ref(0);
    const suggestStyle = ref<Record<string, string>>({});

    const activeSuggestion = computed(() => {
      if (suggestVisible.value && suggestItems.value.length > 0) {
        return suggestItems.value[suggestIndex.value] || null;
      }
      return null;
    });

    const rectState = ref<WindowRect>({
      x: props.initialX,
      y: props.initialY,
      w: props.initialWidth,
      h: props.initialHeight,
    });
    const savedRect = ref<WindowRect | null>(null);

    let term: Terminal | null = null;
    let fitAddon: FitAddon | null = null;
    let unlisten: UnlistenFn | null = null;
    let unlistenLang: (() => void) | null = null;
    let sessionId = '';
    let disposed = false;
    // 监听 data-theme 属性变化，联动重应用 xterm 主题
    let themeObserver: MutationObserver | null = null;

    // Track current command line for suggestions
    let currentLine = '';
    let cursorPos = 0;
    let suggestTimer: ReturnType<typeof setTimeout> | null = null;
    let outputFlushTimer: ReturnType<typeof setTimeout> | null = null;
    let outputBuffer = '';

    // Placeholder navigation state
    let activePlaceholders: import('../../types').PlaceholderInfo[] = [];
    let currentPlaceholderIdx = -1;

    // Click-to-move-cursor state
    let mouseDownX = 0;
    let mouseDownY = 0;
    let mouseDownTime = 0;

    const containerClasses = computed(() => ({
      focused: isFocused.value,
      minimized: isMinimized.value,
      dragging: isDragging.value,
      resizing: isResizing.value,
    }));

    const statusClass = computed(() => {
      if (props.launchOptions.mode === 'ssh') return 'status-ssh';
      return 'status-local';
    });

    const isSsh = computed(() => props.launchOptions.mode === 'ssh');
    const statusPulseColor = computed(() => (isSsh.value ? 'accent' : 'green'));
    const statusText = computed(() => (isSsh.value ? 'SSH' : 'Local'));

    const containerStyle = computed(() => ({
      left: `${rectState.value.x}px`,
      top: `${rectState.value.y}px`,
      width: `${rectState.value.w}px`,
      height: isMinimized.value ? '38px' : `${rectState.value.h}px`,
      zIndex: props.zIndex,
    }));

    function getTheme() {
      const themeName = document.documentElement.getAttribute('data-theme') || 'dark';
      return getTerminalThemeStrategy(themeName).getTheme();
    }

    function calcFontSize(w: number, h: number): number {
      const minDim = Math.min(w, h);
      return Math.round(Math.max(12, Math.min(16, 12 + (minDim - 300) / 250)));
    }

    function resetLineTracking() {
      currentLine = '';
      cursorPos = 0;
      activePlaceholders = [];
      currentPlaceholderIdx = -1;
    }

    async function updateSuggestions(input: string) {
      const intel = getCommandIntel();
      const trimmed = input.trimStart();
      if (!intel || !trimmed || trimmed.length < 1) {
        suggestVisible.value = false;
        suggestItems.value = [];
        return;
      }

      try {
        const results = await intel.searchSuggestions(trimmed);
        if (disposed) return;
        if (results.length > 0) {
          suggestItems.value = results;
          suggestIndex.value = 0;
          suggestVisible.value = true;
          updateSuggestPosition();
        } else {
          suggestVisible.value = false;
          suggestItems.value = [];
        }
      } catch {
        suggestVisible.value = false;
        suggestItems.value = [];
      }
    }

    function updateSuggestPosition() {
      if (!term || disposed) {
        suggestStyle.value = { left: '4px', top: '60px', maxHeight: '200px' };
        return;
      }

      const buf = term.buffer.active;
      const cursorY = buf.cursorY;
      const cursorX = buf.cursorX;
      const bodyH = bodyRef.value?.clientHeight ?? rectState.value.h - 38;
      const bodyW = bodyRef.value?.clientWidth ?? rectState.value.w;

      const cellW = (bodyW / term.cols) || 9;
      const cellH = (bodyH / term.rows) || 18;
      const titleBarH = 38;

      const pxLeft = cursorX * cellW;
      const pxTop = titleBarH + (cursorY + 1) * cellH;
      const maxH = 200;

      const spaceBelow = bodyH + titleBarH - pxTop;
      const spaceAbove = cursorY * cellH;

      if (spaceBelow < maxH + 10 && spaceAbove > maxH) {
        const bottom = (rectState.value.h - titleBarH) - (cursorY * cellH) + cellH * 0.3;
        suggestStyle.value = { left: `${pxLeft}px`, bottom: `${Math.max(2, bottom)}px`, maxHeight: `${maxH}px` };
      } else {
        const clampedTop = Math.max(titleBarH + 2, Math.min(pxTop, rectState.value.h - maxH - 4));
        const clampedMaxH = Math.min(maxH, spaceBelow - 6);
        suggestStyle.value = { left: `${pxLeft}px`, top: `${clampedTop}px`, maxHeight: `${Math.max(80, clampedMaxH)}px` };
      }
    }

    function scrollSuggestIntoView() {
      void nextTick(() => {
        const container = bodyRef.value?.closest('.terminal-window')
          ?.querySelector('.suggest-list') as HTMLElement | null;
        const active = container?.querySelector('.suggest-item.active') as HTMLElement | null;
        if (container && active) {
          active.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        }
      });
    }

    function debouncedUpdateSuggestions(input: string) {
      if (suggestTimer) clearTimeout(suggestTimer);
      suggestTimer = setTimeout(() => {
        void updateSuggestions(input);
      }, 120);
    }

    function onInputChanged(input: string) {
      debouncedUpdateSuggestions(input);
    }

    async function initTerminal() {
      if (disposed || !bodyRef.value) return;

      const fontSize = calcFontSize(props.initialWidth, props.initialHeight);
      term = new Terminal({
        theme: getTheme(),
        fontFamily: '"JetBrainsMono Nerd Font", "JetBrains Mono", "Cascadia Code", "Fira Code", Consolas, monospace',
        fontSize,
        fontWeight: '400',
        fontWeightBold: '600',
        lineHeight: 1.2,
        cursorBlink: true,
        cursorStyle: 'bar',
        cursorWidth: 1,
        scrollback: 5000,
        allowProposedApi: true,
      });

      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon());

      const unicode11Addon = new Unicode11Addon();
      term.loadAddon(unicode11Addon);
      term.unicode.activeVersion = '11';

      term.open(bodyRef.value);

      try {
        const webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => {
          try { webglAddon.dispose(); } catch { /* ignore */ }
        });
        term.loadAddon(webglAddon);
      } catch {
        // WebGL not available
      }

      const theme = getTheme();
      const viewportEl = bodyRef.value.querySelector('.xterm-viewport') as HTMLElement;
      if (viewportEl) {
        viewportEl.style.backgroundColor = theme.background;
      }

      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      if (disposed) return;

      fitAddon.fit();

      let cols = term.cols;
      let rows = term.rows;
      if (!cols || cols <= 0 || !Number.isFinite(cols)) cols = 80;
      if (!rows || rows <= 0 || !Number.isFinite(rows)) rows = 24;

      try {
        sessionId = await invoke<string>('create_pty', { cols, rows, cwd: props.launchOptions.cwd || null });
      } catch (err) {
        console.error('[TerminalWindow] Failed to create PTY:', err);
        return;
      }

      if (disposed) return;

      function flushOutput() {
        if (!disposed && term && outputBuffer) {
          try { term.write(outputBuffer); } catch { /* disposed */ }
          outputBuffer = '';
        }
        outputFlushTimer = null;
      }

      unlisten = await listen('pty-output', (event) => {
        if (disposed || !term) return;
        const payload = event.payload as { session_id: string; data: string };
        if (payload.session_id !== sessionId) return;
        outputBuffer += payload.data;
        if (!outputFlushTimer) {
          outputFlushTimer = setTimeout(flushOutput, 0);
        }
      });

      term.onTitleChange((title: string) => {
        const cwd = title.trim();
        if (cwd) {
          currentCwd.value = cwd;
          emit('cwd-change', cwd);
        }
      });

      // Forward terminal input to PTY and track for suggestions
      term.onData((data) => {
        if (!sessionId || disposed) return;

        if (data === '\r') {
          if (suggestVisible.value && suggestItems.value.length > 0) {
            const item = suggestItems.value[suggestIndex.value];
            if (item) {
              applySuggestion(item);
              return;
            }
          }
          const command = currentLine.trim();
          resetLineTracking();
          suggestVisible.value = false;
          if (command) {
            emit('command-executed', command, '');
          }
          void invoke('write_pty', { sessionId, data });
        } else if (data === '\x7f' || data === '\b') {
          if (cursorPos > 0) {
            currentLine = currentLine.slice(0, cursorPos - 1) + currentLine.slice(cursorPos);
            cursorPos--;
          }
          onInputChanged(currentLine);
          void invoke('write_pty', { sessionId, data });
        } else if (data === '\x1b[D') {
          cursorPos = Math.max(0, cursorPos - 1);
          void invoke('write_pty', { sessionId, data });
        } else if (data === '\x1b[C') {
          cursorPos = Math.min(currentLine.length, cursorPos + 1);
          void invoke('write_pty', { sessionId, data });
        } else if (data === '\x1b[A') {
          resetLineTracking();
          suggestVisible.value = false;
          void invoke('write_pty', { sessionId, data });
        } else if (data === '\x1b[B') {
          resetLineTracking();
          suggestVisible.value = false;
          void invoke('write_pty', { sessionId, data });
        } else if (data === '\x03') {
          resetLineTracking();
          suggestVisible.value = false;
          void invoke('write_pty', { sessionId, data });
        } else if (data === '\x15') {
          resetLineTracking();
          suggestVisible.value = false;
          void invoke('write_pty', { sessionId, data });
        } else if (data === '\x17') {
          const beforeCursor = currentLine.slice(0, cursorPos);
          const trimmed = beforeCursor.replace(/\S+\s*$/, '');
          const deleted = cursorPos - trimmed.length;
          currentLine = trimmed + currentLine.slice(cursorPos);
          cursorPos -= deleted;
          onInputChanged(currentLine);
          void invoke('write_pty', { sessionId, data });
        } else if (data === '\t') {
          if (suggestVisible.value && suggestItems.value.length > 0) {
            const item = suggestItems.value[suggestIndex.value];
            if (item) {
              applySuggestion(item);
            }
          } else if (activePlaceholders.length > 0 && currentPlaceholderIdx >= 0) {
            jumpToNextPlaceholder();
          } else {
            void invoke('write_pty', { sessionId, data });
          }
        } else if (MODIFIED_ARROW_RE.test(data)) {
          // [fix2] Shift/Ctrl/Alt+Arrow — don't send to PTY, let xterm handle selection
          // xterm.js handles these internally for text selection
        } else if (data.length === 1 && data >= ' ') {
          currentLine = currentLine.slice(0, cursorPos) + data + currentLine.slice(cursorPos);
          cursorPos++;
          onInputChanged(currentLine);
          void invoke('write_pty', { sessionId, data });
        } else if (data === '\x1b[H' || data === '\x1b[1~') {
          cursorPos = 0;
          void invoke('write_pty', { sessionId, data });
        } else if (data === '\x1b[F' || data === '\x1b[4~') {
          cursorPos = currentLine.length;
          void invoke('write_pty', { sessionId, data });
        } else if (data.startsWith('\x1b[')) {
          // Unknown escape sequences — pass to PTY
          // but reset local tracking since we can't know cursor state after
          void invoke('write_pty', { sessionId, data });
          resetLineTracking();
          suggestVisible.value = false;
        } else {
          void invoke('write_pty', { sessionId, data });
        }
      });

      // Handle key events for suggestion navigation
      term.onKey(({ domEvent }) => {
        if (suggestVisible.value && suggestItems.value.length > 0) {
          if (domEvent.key === 'ArrowDown') {
            domEvent.preventDefault();
            suggestIndex.value = (suggestIndex.value + 1) % suggestItems.value.length;
            scrollSuggestIntoView();
            return;
          }
          if (domEvent.key === 'ArrowUp') {
            domEvent.preventDefault();
            suggestIndex.value = (suggestIndex.value - 1 + suggestItems.value.length) % suggestItems.value.length;
            scrollSuggestIntoView();
            return;
          }
          if (domEvent.key === 'Escape') {
            suggestVisible.value = false;
            return;
          }
        }
      });

      // Click-to-move-cursor: track clicks on the terminal body element.
      // We listen on bodyRef (the .terminal-body container) because the WebGL canvas
      // overlays .xterm-screen and intercepts mouse events before they reach .xterm-screen.
      const clickTarget = bodyRef.value;
      if (clickTarget) {
        clickTarget.addEventListener('mousedown', (e: MouseEvent) => {
          if (e.button !== 0 || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
          mouseDownX = e.clientX;
          mouseDownY = e.clientY;
          mouseDownTime = e.timeStamp;
        });

        clickTarget.addEventListener('mouseup', (e: MouseEvent) => {
          if (e.button !== 0 || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
          const dx = Math.abs(e.clientX - mouseDownX);
          const dy = Math.abs(e.clientY - mouseDownY);
          const elapsed = e.timeStamp - mouseDownTime;
          console.log('[click-debug] mouseup dx:', dx, 'dy:', dy, 'elapsed:', elapsed,
            'currentLine:', JSON.stringify(currentLine), 'cursorPos:', cursorPos);
          // Only treat as click-to-move if it's a simple click (no significant drag)
          if (dx > 6 || dy > 6 || elapsed > 500) return;
          if (!term || !sessionId || disposed || !currentLine) return;

          handleCursorClick(e);
        });
      }

      if (props.launchOptions.startupCommand) {
        await invoke('write_pty', {
          sessionId,
          data: props.launchOptions.startupCommand + '\n',
        });
      }

      if (props.launchOptions.passwordSequence) {
        let delay = 1500;
        for (const seq of props.launchOptions.passwordSequence) {
          setTimeout(() => {
            if (!disposed && sessionId) {
              void invoke('write_pty', { sessionId, data: seq });
            }
          }, delay);
          delay += 800;
        }
      }

      window.addEventListener('resize', handleResize);

      void ensureIntel();

      setTimeout(() => {
        if (disposed || !term || !fitAddon || !sessionId) return;
        try {
          fitAddon.fit();
          const c = term.cols;
          const r = term.rows;
          if (c > 0 && r > 0 && Number.isFinite(c) && Number.isFinite(r)) {
            void invoke('resize_pty', { sessionId, cols: c, rows: r });
          }
          if (bodyRef.value) {
            const vp = bodyRef.value.querySelector('.xterm-viewport') as HTMLElement;
            if (vp) vp.style.backgroundColor = getTheme().background;
          }
        } catch { /* ignore */ }
      }, 50);

      setTimeout(() => {
        if (disposed || !term || !fitAddon || !sessionId) return;
        try {
          fitAddon.fit();
          term.options.theme = getTheme();
          const c = term.cols;
          const r = term.rows;
          if (c > 0 && r > 0 && Number.isFinite(c) && Number.isFinite(r)) {
            void invoke('resize_pty', { sessionId, cols: c, rows: r });
          }
          if (bodyRef.value) {
            const vp = bodyRef.value.querySelector('.xterm-viewport') as HTMLElement;
            if (vp) vp.style.backgroundColor = getTheme().background;
          }
        } catch { /* ignore */ }
      }, 300);
    }

    function jumpToNextPlaceholder() {
      if (activePlaceholders.length === 0 || currentPlaceholderIdx < 0 || !sessionId || disposed) return;
      const nextIdx = (currentPlaceholderIdx + 1) % activePlaceholders.length;
      const target = activePlaceholders[nextIdx];
      currentPlaceholderIdx = nextIdx;
      const moveLeft = cursorPos - target.position;
      const moveRight = target.position - cursorPos;
      if (moveLeft > 0) {
        cursorPos = target.position;
        // Send individual \x1b[D per step — parametrized \x1b[N D is not
        // supported by zsh's line editor and echoes literal "D"
        const seq = '\x1b[D'.repeat(moveLeft);
        void invoke('write_pty', { sessionId, data: seq });
      } else if (moveRight > 0) {
        cursorPos = target.position;
        const seq = '\x1b[C'.repeat(moveRight);
        void invoke('write_pty', { sessionId, data: seq });
      }
    }

    function handleCursorClick(e: MouseEvent) {
      if (!term || !sessionId || disposed || !currentLine) return;

      const buf = term.buffer.active;
      const cursorY = buf.cursorY;
      const cursorX = buf.cursorX;

      // Find the actual rendering canvas — it's the element that maps 1:1 to cells.
      // The WebGL/Canvas renderer creates a canvas inside .xterm-screen.
      const screenEl = bodyRef.value?.querySelector('.xterm-screen') as HTMLElement | null;
      if (!screenEl) {
        console.log('[click-debug] no .xterm-screen found');
        return;
      }

      const screenRect = screenEl.getBoundingClientRect();
      console.log('[click-debug] cursorX:', cursorX, 'cursorY:', cursorY,
        'screenRect:', JSON.stringify({l: Math.round(screenRect.left), t: Math.round(screenRect.top), w: Math.round(screenRect.width), h: Math.round(screenRect.height)}),
        'clientXY:', Math.round(e.clientX), Math.round(e.clientY));

      // Relative position within the screen element
      const relX = e.clientX - screenRect.left;
      const relY = e.clientY - screenRect.top;

      // Get accurate cell dimensions from xterm's internal renderer
      const core = (term as any)._core;
      let cellW: number;
      let cellH: number;
      if (core?._renderService?.dimensions?.css?.cell) {
        const dims = core._renderService.dimensions.css.cell;
        cellW = dims.width;
        cellH = dims.height;
        console.log('[click-debug] using core dims: cellW:', cellW, 'cellH:', cellH);
      } else {
        cellW = screenRect.width / term.cols;
        cellH = screenRect.height / term.rows;
        console.log('[click-debug] using fallback dims: cellW:', cellW, 'cellH:', cellH,
          'cols:', term.cols, 'rows:', term.rows);
      }

      if (cellW <= 0 || cellH <= 0) {
        console.log('[click-debug] bad cell dimensions');
        return;
      }

      // Determine clicked row and column (0-based)
      const clickRow = Math.max(0, Math.min(term.rows - 1, Math.floor(relY / cellH)));
      const clickCol = Math.max(0, Math.min(term.cols - 1, Math.floor(relX / cellW)));

      console.log('[click-debug] clickRow:', clickRow, 'clickCol:', clickCol,
        'relX:', Math.round(relX), 'relY:', Math.round(relY),
        'rowMatch:', clickRow === cursorY);

      if (clickRow !== cursorY) {
        console.log('[click-debug] row mismatch, aborting');
        return;
      }

      // Prompt starts at: cursorX (absolute buffer column) minus cursorPos (position in tracked line)
      const promptStartCol = cursorX - cursorPos;
      console.log('[click-debug] promptStartCol:', promptStartCol, '(cursorX:', cursorX, '- cursorPos:', cursorPos, ')');
      if (promptStartCol < 0) {
        console.log('[click-debug] negative promptStartCol, aborting');
        return;
      }

      // Target position within the tracked input line
      const targetPos = Math.max(0, Math.min(currentLine.length, clickCol - promptStartCol));
      console.log('[click-debug] targetPos:', targetPos, '(clickCol:', clickCol, '- promptStartCol:', promptStartCol, ')',
        'currentLine.length:', currentLine.length, 'diff from cursorPos:', targetPos - cursorPos);

      if (targetPos === cursorPos) {
        console.log('[click-debug] same position, no move needed');
        return;
      }

      // Send arrow keys to move cursor
      const diff = targetPos - cursorPos;
      cursorPos = targetPos;
      if (diff < 0) {
        console.log('[click-debug] sending', -diff, 'left arrows');
        void invoke('write_pty', { sessionId, data: '\x1b[D'.repeat(-diff) });
      } else {
        console.log('[click-debug] sending', diff, 'right arrows');
        void invoke('write_pty', { sessionId, data: '\x1b[C'.repeat(diff) });
      }
    }

    function applySuggestion(item: SuggestionItem) {
      if (!term || !sessionId || disposed) return;

      const ph = item.placeholders;
      const hasPlaceholders = ph && ph.hasPlaceholders && ph.placeholders.length > 0;
      // When placeholders exist, use the stripped insertText (placeholders removed).
      // Otherwise use the raw insertText as-is.
      const newText = hasPlaceholders ? ph!.insertText : (item.insertText || item.executeText);

      suggestVisible.value = false;

      // Use Ctrl+U to reliably clear the line, then type new text
      void invoke('write_pty', { sessionId, data: '\x15' });

      setTimeout(() => {
        if (!sessionId || disposed) return;

        // Set up placeholder state before writing
        activePlaceholders = [];
        currentPlaceholderIdx = -1;

        if (hasPlaceholders && ph!.placeholders.length > 0) {
          activePlaceholders = [...ph!.placeholders];
          currentPlaceholderIdx = 0;
          currentLine = newText;
          cursorPos = newText.length;
        } else {
          currentLine = newText;
          cursorPos = newText.length;
        }

        void invoke('write_pty', { sessionId, data: newText }).then(() => {
          if (disposed || !sessionId) return;
          // Move cursor to first placeholder position after PTY has echoed the text
          if (hasPlaceholders && activePlaceholders.length > 0 && currentPlaceholderIdx >= 0) {
            setTimeout(() => {
              if (disposed || !sessionId) return;
              const targetPos = activePlaceholders[currentPlaceholderIdx].position;
              const moveLeft = cursorPos - targetPos;
              if (moveLeft > 0) {
                cursorPos = targetPos;
                // Send individual \x1b[D per step — parametrized \x1b[N D is
                // not supported by zsh's line editor
                const seq = '\x1b[D'.repeat(moveLeft);
                void invoke('write_pty', { sessionId, data: seq });
              }
            }, 80);
          }
        });
      }, 40);
    }

    function selectSuggestion(item: SuggestionItem) {
      applySuggestion(item);
    }

    function handleResize() {
      if (disposed || !fitAddon || !term) return;
      try {
        const newFontSize = calcFontSize(rectState.value.w, rectState.value.h);
        if (term.options.fontSize !== newFontSize) {
          term.options.fontSize = newFontSize;
        }
        fitAddon.fit();
        if (sessionId) {
          const c = term.cols;
          const r = term.rows;
          if (c > 0 && r > 0 && Number.isFinite(c) && Number.isFinite(r)) {
            void invoke('resize_pty', {
              sessionId,
              cols: c,
              rows: r,
            });
          }
        }
      } catch { /* ignore */ }
    }

    function startDrag(e: MouseEvent) {
      isDragging.value = true;
      emit('interaction-start', props.terminalId);
      const startX = e.clientX;
      const startY = e.clientY;
      const startLeft = rectState.value.x;
      const startTop = rectState.value.y;

      function onMove(ev: MouseEvent) {
        const zoom = props.viewportZoom || 1;
        const raw: Rect = {
          x: startLeft + (ev.clientX - startX) / zoom,
          y: startTop + (ev.clientY - startY) / zoom,
          w: rectState.value.w,
          h: rectState.value.h,
        };
        const snapped = props.snapRect ? props.snapRect(raw, { mode: 'drag', sourceId: props.terminalId }) : raw;
        rectState.value = { ...rectState.value, x: snapped.x, y: snapped.y };
      }

      function onUp() {
        isDragging.value = false;
        emit('interaction-end', props.terminalId);
        props.clearGuides?.();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }

    function startResize(direction: string, e: MouseEvent) {
      isResizing.value = true;
      emit('interaction-start', props.terminalId);
      const startX = e.clientX;
      const startY = e.clientY;
      const startRect = { ...rectState.value };

      function onMove(ev: MouseEvent) {
        const zoom = props.viewportZoom || 1;
        const dx = (ev.clientX - startX) / zoom;
        const dy = (ev.clientY - startY) / zoom;
        const newRect = { ...startRect };

        if (direction.includes('e')) newRect.w = Math.max(200, startRect.w + dx);
        if (direction.includes('s')) newRect.h = Math.max(100, startRect.h + dy);
        if (direction.includes('w')) {
          newRect.w = Math.max(200, startRect.w - dx);
          newRect.x = startRect.x + dx;
        }
        if (direction.includes('n')) {
          newRect.h = Math.max(100, startRect.h - dy);
          newRect.y = startRect.y + dy;
        }

        const snapped = props.snapRect ? props.snapRect(newRect, { mode: 'resize', direction, sourceId: props.terminalId }) : newRect;
        rectState.value = snapped;
        handleResize();
      }

      function onUp() {
        isResizing.value = false;
        emit('interaction-end', props.terminalId);
        props.clearGuides?.();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }

    function minimize() {
      isMinimized.value = !isMinimized.value;
    }

    function toggleMaximize() {
      if (isMaximized.value && savedRect.value) {
        rectState.value = savedRect.value;
        isMaximized.value = false;
      } else {
        savedRect.value = { ...rectState.value };
        isMaximized.value = true;
      }
    }

    function requestClose() {
      emit('close', props.terminalId);
    }

    function startRename() {
      // Can be enhanced with native dialog
    }

    function onActivate() {
      emit('activate', props.terminalId);
    }

    function focus() {
      isFocused.value = true;
      if (term && !disposed) {
        try { term.focus(); } catch { /* disposed */ }
      }
    }

    function blur() {
      isFocused.value = false;
    }

    function setTheme(themeName: string) {
      if (disposed || !term) return;
      const theme = getTerminalThemeStrategy(themeName).getTheme();
      term.options.theme = theme;
      if (bodyRef.value) {
        const viewportEl = bodyRef.value.querySelector('.xterm-viewport') as HTMLElement;
        if (viewportEl) {
          viewportEl.style.backgroundColor = theme.background;
        }
      }
    }

    function destroy() {
      disposed = true;
      themeObserver?.disconnect();
      themeObserver = null;
      window.removeEventListener('resize', handleResize);
      if (suggestTimer) {
        clearTimeout(suggestTimer);
        suggestTimer = null;
      }
      if (outputFlushTimer) {
        clearTimeout(outputFlushTimer);
        outputFlushTimer = null;
      }
      outputBuffer = '';
      unlisten?.();
      unlistenLang?.();
      if (term) {
        try { term.dispose(); } catch { /* already disposed */ }
      }
      term = null;
      fitAddon = null;
      if (sessionId) {
        void invoke('kill_pty', { sessionId });
      }
    }

    function getState() {
      return {
        x: rectState.value.x,
        y: rectState.value.y,
        w: rectState.value.w,
        h: rectState.value.h,
        title: terminalName.value,
        cwd: currentCwd.value,
        minimized: isMinimized.value,
        maximized: isMaximized.value,
        launchOptions: props.launchOptions,
      };
    }

    onMounted(() => {
      Perf.mark('terminal.mount');
      // 入场动画播放完毕后永久移除，避免拖拽结束 .dragging 移除时 terminalPopIn 重播造成弹跳延迟
      if (rootRef.value) {
        const markAppeared = () => rootRef.value?.classList.add('appeared');
        rootRef.value.addEventListener('animationend', markAppeared, { once: true });
        // 兜底：动画被中断时确保最终标记
        window.setTimeout(markAppeared, 460);
      }
      void initTerminal().catch((err) => {
        console.error('[TerminalWindow] initTerminal failed:', err);
      });
      unlistenLang = onLangChange(() => {
        if (!props.launchOptions.profileName) {
          terminalName.value = t('terminal.unnamed');
        }
      });
      // 监听根元素 data-theme 变化，自动联动 xterm 主题
      themeObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
            const themeName = document.documentElement.getAttribute('data-theme') || 'dark';
            setTheme(themeName);
            break;
          }
        }
      });
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    });

    onUnmounted(() => {
      destroy();
    });

    return {
      bodyRef,
      rootRef,
      terminalName,
      currentCwd,
      statusClass,
      isSsh,
      statusPulseColor,
      statusText,
      isMinimized,
      suggestVisible,
      suggestItems,
      suggestIndex,
      suggestStyle,
      containerClasses,
      containerStyle,
      startDrag,
      startResize,
      minimize,
      toggleMaximize,
      requestClose,
      startRename,
      onActivate,
      focus,
      blur,
      setTheme,
      destroy,
      getState,
      selectSuggestion,
      activeSuggestion,
    };
  },
});
