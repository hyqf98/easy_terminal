import { defineComponent, ref, computed, watch, onMounted, onUnmounted, nextTick, type PropType } from 'vue';
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
import type { SSHProfile } from '../../types/ssh';

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
    // 可用的 SSH 配置列表：用于标题栏 SSH 快速切换
    sshProfiles: { type: Array as PropType<SSHProfile[]>, default: () => [] },
    // 文件面板是否展开（父组件控制，仅影响 tab 视觉）
    filePanelOpen: { type: Boolean, default: false },
    // 文件面板展开时，整体窗口左侧比终端多出的宽度，用于整体吸附/拖拽坐标换算
    filePanelInset: { type: Number, default: 0 },
  },
  emits: ['activate', 'close', 'command-executed', 'cwd-change', 'interaction-start', 'interaction-end', 'switch-ssh', 'toggle-file-panel', 'rect-change'],
  setup(props, { emit, expose }) {
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
    // SSH 切换下拉菜单显隐
    const sshMenuOpen = ref(false);
    // 文件面板展开状态（由父组件控制，仅用于 tab 视觉反馈）
    const filePanelExpanded = computed(() => props.filePanelOpen);

    /** 点击箭头：通知父组件切换独立文件面板 */
    function toggleFilePanel() {
      emit('toggle-file-panel', props.terminalId);
    }

    const activeSuggestion = computed(() => {
      if (suggestVisible.value && suggestItems.value.length > 0) {
        return suggestItems.value[suggestIndex.value] || null;
      }
      return null;
    });

    // 补全弹窗头部文案：与 mockup completion-header 一致（命令补全 / 历史联想 / 映射匹配）
    const suggestHeaderText = computed(() => {
      if (!suggestItems.value.length) return '命令补全';
      const hasHistory = suggestItems.value.some((i) => i.type === 'history');
      const hasMapping = suggestItems.value.some((i) => i.type === 'mapping');
      if (hasMapping) return '命令映射';
      if (hasHistory && suggestItems.value.every((i) => i.type === 'history')) {
        return '历史联想';
      }
      return '命令补全';
    });

    // 每条建议的小图标 SVG path（按来源类型区分，贴近 mockup completion-icon）
    function suggestIconSvg(item: SuggestionItem): string {
      switch (item.type) {
        case 'history':
          return '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>';
        case 'mapping':
          return '<path d="M7 8l-4 4 4 4"/><path d="M17 8l4 4-4 4"/><path d="M14 4l-4 16"/>';
        case 'completion':
          return '<path d="M3 12h4l3-8 4 16 3-8h4"/>';
        default:
          return '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>';
      }
    }

    // 每条建议的键盘提示徽标：首条 Tab 接受，其余按序号映射 ⌃N / ⌃P 风格
    function suggestKbdHint(idx: number, item: SuggestionItem): string {
      if (idx === 0) return '↹ Tab';
      if (item.type === 'history') return `⌃${idx}`;
      if (item.type === 'mapping') return '⇥';
      return `⌥${idx}`;
    }

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
      'has-file-panel': props.filePanelOpen,
    }));

    const statusClass = computed(() => {
      if (props.launchOptions.mode === 'ssh') return 'status-ssh';
      return 'status-local';
    });

    const isSsh = computed(() => props.launchOptions.mode === 'ssh');
    const statusPulseColor = computed(() => (isSsh.value ? 'accent' : 'green'));
    const statusText = computed(() => (isSsh.value ? 'SSH' : 'Local'));

    const UNIFIED_TITLEBAR_H = 28;
    const containerStyle = computed(() => ({
      left: `${rectState.value.x}px`,
      top: `${props.filePanelOpen ? rectState.value.y + UNIFIED_TITLEBAR_H : rectState.value.y}px`,
      width: `${rectState.value.w}px`,
      height: isMinimized.value
        ? '38px'
        : `${Math.max(100, rectState.value.h - (props.filePanelOpen ? UNIFIED_TITLEBAR_H : 0))}px`,
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

    // 根据当前输入行向命令智能引擎查询并刷新补全建议列表
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

    // 补全弹窗已 Teleport 到 document.body 并使用 position:fixed。
    // 因此定位基于终端根元素在屏幕上的矩形（getBoundingClientRect）+ 光标像素偏移，再按视口边界兜底。
    function updateSuggestPosition() {
      const fallback = { position: 'fixed', left: '4px', top: '60px', maxHeight: '200px' };
      if (!term || disposed) {
        suggestStyle.value = fallback;
        return;
      }

      const rootRect = rootRef.value?.getBoundingClientRect();
      if (!rootRect) {
        suggestStyle.value = fallback;
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
      const maxH = 200;
      const popupMaxW = 420;

      // 光标在终端内的像素偏移 → 转换为屏幕坐标（fixed 定位基准）
      const cursorPxX = cursorX * cellW;
      const cursorPxY = titleBarH + (cursorY + 1) * cellH;
      const screenX = rootRect.left + cursorPxX;
      const screenY = rootRect.top + cursorPxY;

      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // 水平：贴光标列，右溢出回缩，左边界兜底
      let left = screenX;
      if (left + popupMaxW > vw - 8) left = Math.max(8, vw - 8 - popupMaxW);

      // 垂直：默认落在光标下方；下方空间不足且上方足够时翻转到光标上方
      const spaceBelow = vh - screenY;
      const spaceAbove = cursorPxY - titleBarH; // 光标行以上在终端内的可用像素
      let top: number;
      let clampedMaxH: number;
      if (spaceBelow < maxH + 10 && spaceAbove > maxH) {
        // 翻转到上方：弹窗底边贴近光标行上沿
        const cursorLineTopScreenY = rootRect.top + titleBarH + cursorY * cellH;
        top = cursorLineTopScreenY - cellH * 0.3 - maxH;
        top = Math.max(8, top);
        clampedMaxH = Math.min(maxH, spaceAbove - 6);
      } else {
        top = screenY;
        clampedMaxH = Math.min(maxH, Math.max(0, spaceBelow - 6));
      }

      suggestStyle.value = {
        position: 'fixed',
        left: `${Math.round(left)}px`,
        top: `${Math.round(top)}px`,
        maxHeight: `${Math.max(80, clampedMaxH)}px`,
      };
    }

    function scrollSuggestIntoView() {
      void nextTick(() => {
        const container = bodyRef.value?.closest('.terminal-window')
          ?.querySelector('.completion-list') as HTMLElement | null;
        const active = container?.querySelector('.completion-item.selected') as HTMLElement | null;
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

    // 选中并应用某条建议到命令行（委托给 applySuggestion）
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

    // 开始拖拽终端窗口：监听全局鼠标移动，按视口缩放换算坐标并触发吸附
    function startDrag(e: MouseEvent) {
      isDragging.value = true;
      emit('interaction-start', props.terminalId, 'drag');
      const startX = e.clientX;
      const startY = e.clientY;
      const startLeft = rectState.value.x;
      const startTop = rectState.value.y;
      const inset = props.filePanelOpen ? props.filePanelInset : 0;

      function onMove(ev: MouseEvent) {
        const zoom = props.viewportZoom || 1;
        const rawTerminalRect: Rect = {
          x: startLeft + (ev.clientX - startX) / zoom,
          y: startTop + (ev.clientY - startY) / zoom,
          w: rectState.value.w,
          h: rectState.value.h,
        };
        const rawGroupRect: Rect = inset > 0
          ? { x: rawTerminalRect.x - inset, y: rawTerminalRect.y, w: rawTerminalRect.w + inset, h: rawTerminalRect.h }
          : rawTerminalRect;
        const snappedGroup = props.snapRect ? props.snapRect(rawGroupRect, {
          mode: 'drag',
          sourceId: props.terminalId,
          minW: inset + 200,
          minH: 100,
        }) : rawGroupRect;
        const nextX = snappedGroup.x + inset;
        const nextY = snappedGroup.y;
        rectState.value = { ...rectState.value, x: nextX, y: nextY };
        emit('rect-change', props.terminalId, { x: nextX, y: nextY, w: rectState.value.w, h: rectState.value.h });
      }

      function onUp() {
        isDragging.value = false;
        emit('interaction-end', props.terminalId, 'drag');
        props.clearGuides?.();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }

    // 开始缩放终端窗口：按方向（n/s/e/w）单边调整尺寸，受最小宽高与吸附约束
    function startResize(direction: string, e: MouseEvent) {
      isResizing.value = true;
      emit('interaction-start', props.terminalId, 'resize');
      const startX = e.clientX;
      const startY = e.clientY;
      const startRect = { ...rectState.value };
      const inset = props.filePanelOpen ? props.filePanelInset : 0;

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
          if (newRect.w === 200) {
            newRect.x = startRect.x + (startRect.w - 200);
          }
        }
        if (direction.includes('n')) {
          newRect.h = Math.max(100, startRect.h - dy);
          newRect.y = startRect.y + dy;
          if (newRect.h === 100) {
            newRect.y = startRect.y + (startRect.h - 100);
          }
        }

        const rawGroupRect: Rect = inset > 0
          ? { x: newRect.x - inset, y: newRect.y, w: newRect.w + inset, h: newRect.h }
          : newRect;
        const snappedGroup = props.snapRect ? props.snapRect(rawGroupRect, {
          mode: 'resize',
          direction,
          sourceId: props.terminalId,
          minW: inset + 200,
          minH: 100,
        }) : rawGroupRect;
        const snapped: Rect = inset > 0
          ? { x: snappedGroup.x + inset, y: snappedGroup.y, w: Math.max(200, snappedGroup.w - inset), h: snappedGroup.h }
          : snappedGroup;
        rectState.value = snapped;
        emit('rect-change', props.terminalId, { x: snapped.x, y: snapped.y, w: snapped.w, h: snapped.h });
        handleResize();
      }

      function onUp() {
        isResizing.value = false;
        emit('interaction-end', props.terminalId, 'resize');
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

    // 外部向当前终端 PTY 注入数据（用于「在终端执行 cd」等场景）
    function writeToTerminal(data: string) {
      if (sessionId) void invoke('write_pty', { sessionId, data });
    }

    // 切换 SSH 连接：null 表示切回本地终端
    function emitSwitchSsh(profileId: string | null) {
      sshMenuOpen.value = false;
      emit('switch-ssh', profileId);
    }

    // 点击 SSH 菜单外部时关闭下拉
    function onSshMenuOutsideClick(event: MouseEvent) {
      if (!sshMenuOpen.value) return;
      const target = event.target as Node | null;
      const switchEl = rootRef.value?.querySelector('.terminal-ssh-switch');
      if (switchEl && target && !switchEl.contains(target)) {
        sshMenuOpen.value = false;
      }
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
      // 监听外部点击以关闭 SSH 切换下拉
      document.addEventListener('click', onSshMenuOutsideClick);
    });

    watch(() => props.filePanelOpen, () => {
      void nextTick(() => handleResize());
    });

    onUnmounted(() => {
      document.removeEventListener('click', onSshMenuOutsideClick);
      destroy();
    });

    // 暴露命令式能力，供父组件统一标题栏和文件面板调用
    expose({ writeToTerminal, startDrag, startResize, minimize, toggleMaximize, requestClose });

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
      suggestHeaderText,
      suggestIconSvg,
      suggestKbdHint,
      // SSH 切换
      sshMenuOpen,
      emitSwitchSsh,
      // 文件面板 tab
      filePanelExpanded,
      toggleFilePanel,
    };
  },
});
