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
import { normalizeTitleCwd } from '../../utils/path';
import {
  isPlaceholderToken,
  removeUnresolvedPlaceholderRanges,
  replacePlaceholderRange,
  updatePlaceholderRanges,
} from '../../utils/placeholder';
import { calculateSuggestPlacement, type SuggestPlacement } from '../../utils/suggestPlacement';
import {
  nextTextBoundary,
  previousTextBoundary,
  textCellWidth,
  textCursorDistance,
  textIndexAtCell,
} from '../../utils/terminalLine';
import type { TerminalLaunchOptions, SuggestionItem, PlaceholderInfo, Rect, SnapOptions } from '../../types';
import type { SSHProfile } from '../../types/ssh';

type WindowRect = { x: number; y: number; w: number; h: number };

interface TemplateInputSession {
  bodyEnd: number;
  ownedEnd: number;
}

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
const CURSOR_LEFT_SEQUENCES = new Set(['\x1b[D', '\x1b[1D', '\x1b[1;1D', '\x1bOD']);
const CURSOR_RIGHT_SEQUENCES = new Set(['\x1b[C', '\x1b[1C', '\x1b[1;1C', '\x1bOC']);

// normalizeTitleCwd 已抽取到 utils/path.ts

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
    const suggestIndex = ref(-1);
    const suggestSelectionMode = ref<'keyboard' | 'mouse'>('keyboard');
    const suggestStyle = ref<Record<string, string>>({});
    const suggestPlacement = ref<SuggestPlacement>('below');
    const completionPopupRef = ref<HTMLDivElement | null>(null);
    const ghostText = ref('');
    const ghostStyle = ref<Record<string, string>>({});
    // SSH 切换下拉菜单显隐
    const sshMenuOpen = ref(false);
    // 文件面板展开状态（由父组件控制，仅用于 tab 视觉反馈）
    const filePanelExpanded = computed(() => props.filePanelOpen);

    /** 点击箭头：通知父组件切换独立文件面板 */
    function toggleFilePanel() {
      emit('toggle-file-panel', props.terminalId);
    }

    const activeSuggestion = computed(() => {
      if (suggestVisible.value && suggestIndex.value >= 0 && suggestItems.value.length > 0) {
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
      if (suggestIndex.value === idx) return '↵ Enter';
      if (suggestIndex.value < 0 && idx === 0) return '↹ 选择';
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
    let ptyWriteQueue: Promise<void> = Promise.resolve();
    // IME 组合输入状态：组合期间让输入法接管编辑键，提交后立即恢复正常终端输入。
    let imeComposing = false;
    let disposed = false;
    // 监听 data-theme 属性变化，联动重应用 xterm 主题
    let themeObserver: MutationObserver | null = null;

    // Track current command line for suggestions
    let currentLine = '';
    let cursorPos = 0;
    let suggestTimer: ReturnType<typeof setTimeout> | null = null;
    let suggestRequestId = 0;
    let suggestPositionRafId: number | null = null;
    let outputFlushTimer: ReturnType<typeof setTimeout> | null = null;
    let outputBuffer = '';

    // 拖动缩放时的 resize 防抖 ID，避免每帧都调用 resize_pty
    let resizeRafId: number | null = null;
    // 终端字体实时变化监听句柄
    let onTermFontSizeChange: (() => void) | null = null;
    let onTermFontFamilyChange: (() => void) | null = null;
    // 设置面板标志变化监听句柄（命令补全 / Ghost Text 等开关）
    let onTermFlagsChange: (() => void) | null = null;
    let lastSuggestMouseX = Number.NaN;
    let lastSuggestMouseY = Number.NaN;

    // Placeholder navigation state
    let activePlaceholders: PlaceholderInfo[] = [];
    let currentPlaceholderIdx = -1;
    let templateSession: TemplateInputSession | null = null;
    let placeholderSelectionArmed = false;

    // Shift+方向键选中文本时的锚点与虚拟光标（buffer 绝对坐标）。
    // 锚点 = 首次按下 Shift 时的光标位置；虚拟光标随方向键移动。
    let selAnchorX: number | null = null;
    let selAnchorY: number | null = null;
    let selCursorX: number | null = null;
    let selCursorY: number | null = null;

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

    // 从 localStorage 读取终端字体族设置（与 SettingsPanel 的 FLAGS_STORAGE_KEY 一致）
    function getTermFontFamily(): string {
      try {
        const raw = localStorage.getItem('et:settings:flags');
        if (raw) {
          const flags = JSON.parse(raw);
          if (flags.termFontFamily) {
            // 用户选定的字体 + 合理的 fallback 链
            return `"${flags.termFontFamily}", "JetBrains Mono", "Cascadia Code", "Fira Code", Consolas, monospace`;
          }
        }
      } catch { /* 静默 */ }
      return '"JetBrainsMono Nerd Font", "JetBrains Mono", "Cascadia Code", "Fira Code", Consolas, monospace';
    }

    // 从 localStorage 读取本地偏好标志（与 SettingsPanel 的 FLAGS_STORAGE_KEY 一致）
    function getLocalFlags() {
      const fallback = {
        commandSuggest: true,
        ghostText: true,
        alignGuides: true,
        autoInstall: false,
        uiFontFamily: 'Manrope',
        termFontFamily: 'JetBrains Mono Nerd Font',
        radiusStyle: '8',
      };
      try {
        const raw = localStorage.getItem('et:settings:flags');
        if (!raw) return fallback;
        return { ...fallback, ...JSON.parse(raw) };
      } catch {
        return fallback;
      }
    }

    function clearGhostText() {
      ghostText.value = '';
      ghostStyle.value = {};
    }

    function hideSuggestions(clearItems = true) {
      suggestRequestId++;
      suggestVisible.value = false;
      suggestIndex.value = -1;
      if (clearItems) suggestItems.value = [];
      clearGhostText();
    }

    function resetLineTracking() {
      currentLine = '';
      cursorPos = 0;
      activePlaceholders = [];
      currentPlaceholderIdx = -1;
      templateSession = null;
      placeholderSelectionArmed = false;
      clearSelectionAnchor();
      term?.clearSelection();
      hideSuggestions();
    }

    function scheduleSuggestPosition() {
      if (suggestPositionRafId !== null) cancelAnimationFrame(suggestPositionRafId);
      void nextTick(() => {
        suggestPositionRafId = requestAnimationFrame(() => {
          suggestPositionRafId = null;
          updateSuggestPosition();
          updateGhostPosition();
        });
      });
    }

    function getCursorGeometry(): {
      cursorRect: DOMRect;
      terminalRect: DOMRect;
      cellWidth: number;
      cellHeight: number;
    } | null {
      if (!term || !rootRef.value) return null;
      const rootRect = rootRef.value.getBoundingClientRect();
      const screenEl = bodyRef.value?.querySelector('.xterm-screen') as HTMLElement | null;
      const screenRect = screenEl?.getBoundingClientRect();
      if (!screenRect || screenRect.width <= 0 || screenRect.height <= 0) return null;

      const cellWidth = screenRect.width / Math.max(1, term.cols);
      const cellHeight = screenRect.height / Math.max(1, term.rows);
      const cursorX = term.buffer.active.cursorX;
      const cursorY = term.buffer.active.cursorY;
      const cursorRect = DOMRect.fromRect({
        x: screenRect.left + cursorX * cellWidth,
        y: screenRect.top + cursorY * cellHeight,
        width: cellWidth,
        height: cellHeight,
      });
      const terminalRect = DOMRect.fromRect({
        x: Math.max(0, rootRect.left),
        y: Math.max(0, rootRect.top),
        width: Math.max(0, Math.min(window.innerWidth, rootRect.right) - Math.max(0, rootRect.left)),
        height: Math.max(0, Math.min(window.innerHeight, rootRect.bottom) - Math.max(0, rootRect.top)),
      });
      return { cursorRect, terminalRect, cellWidth, cellHeight };
    }

    // 检测当前是否处于 TUI 模式（alternate screen buffer 被激活）。
    // vim/htop/less/claude/codex 等 TUI 程序进入时会切换到 alternate screen，
    // 此时所有按键应直接透传给 PTY，不做行编辑/补全/点击移动光标等拦截。
    function isTuiMode(): boolean {
      return !!term && term.buffer.active.type === 'alternate';
    }

    /** Keep IME commits and the immediately following edit/navigation key in strict PTY order. */
    function enqueuePtyWrite(data: string): Promise<void> {
      const targetSessionId = sessionId;
      if (!targetSessionId || disposed || !data) return Promise.resolve();
      ptyWriteQueue = ptyWriteQueue
        .catch(() => undefined)
        .then(async () => {
          if (disposed || sessionId !== targetSessionId) return;
          await invoke('write_pty', { sessionId: targetSessionId, data });
        });
      return ptyWriteQueue;
    }

    // 根据当前输入行向命令智能引擎查询并刷新补全建议列表
    async function updateSuggestions(input: string) {
      const requestId = ++suggestRequestId;
      // 设置中关闭了命令智能补全时不显示建议弹窗
      if (!getLocalFlags().commandSuggest) {
        hideSuggestions();
        return;
      }
      const intel = getCommandIntel();
      const trimmed = input.trimStart();
      if (!intel || !trimmed || trimmed.length < 1) {
        hideSuggestions();
        return;
      }

      try {
        const results = await intel.searchSuggestions(trimmed);
        if (disposed || requestId !== suggestRequestId || input !== currentLine) return;
        if (results.length > 0) {
          suggestItems.value = results;
          suggestIndex.value = -1;
          suggestSelectionMode.value = 'keyboard';
          suggestStyle.value = {};
          suggestVisible.value = true;
          refreshGhostText();
          scheduleSuggestPosition();
        } else {
          hideSuggestions();
        }
      } catch {
        if (requestId === suggestRequestId) hideSuggestions();
      }
    }

    // 补全弹窗已 Teleport 到 document.body 并使用 position:fixed。
    // 定位基于 .xterm-screen 渲染画布的屏幕矩形 + xterm 渲染器单元格尺寸，
    // 自动计入标题栏高度与 body padding，再按视口边界兜底。
    function updateSuggestPosition() {
      if (!suggestVisible.value || disposed) return;
      const geometry = getCursorGeometry();
      if (!geometry) return;
      const popupWidth = completionPopupRef.value?.offsetWidth || 280;
      const desiredListHeight = Math.min(200, suggestItems.value.length * 36 + 6);
      const result = calculateSuggestPlacement({
        cursorRect: geometry.cursorRect,
        terminalRect: geometry.terminalRect,
        popupWidth,
        desiredListHeight,
        chromeHeight: 49,
        gap: 6,
        edgePadding: 6,
      });
      suggestPlacement.value = result.placement;
      suggestStyle.value = {
        position: 'fixed',
        left: `${Math.round(result.left)}px`,
        top: `${Math.round(result.top)}px`,
        width: `${Math.round(result.width)}px`,
        minWidth: `${Math.round(result.width)}px`,
        maxWidth: `${Math.round(result.width)}px`,
        '--completion-list-max-height': `${Math.floor(result.listHeight)}px`,
      };
    }

    function refreshGhostText() {
      clearGhostText();
      if (!term || !suggestVisible.value || cursorPos !== currentLine.length || !getLocalFlags().ghostText || templateSession || activePlaceholders.length > 0) return;
      const item = suggestItems.value[suggestIndex.value] || null;
      const ghost = getCommandIntel()?.getGhostSuggestionForItem(currentLine, item) || null;
      if (!ghost?.text || !currentLine.trim()) return;
      ghostText.value = ghost.text;
      updateGhostPosition();
    }

    function updateGhostPosition() {
      if (!ghostText.value) return;
      const geometry = getCursorGeometry();
      if (!geometry) {
        clearGhostText();
        return;
      }
      const availableWidth = Math.max(0, geometry.terminalRect.right - geometry.cursorRect.left - 6);
      ghostStyle.value = {
        position: 'fixed',
        left: `${Math.round(geometry.cursorRect.left)}px`,
        top: `${Math.round(geometry.cursorRect.top)}px`,
        maxWidth: `${Math.floor(availableWidth)}px`,
        height: `${Math.ceil(geometry.cellHeight)}px`,
        lineHeight: `${geometry.cellHeight}px`,
        fontSize: `${Math.max(9, geometry.cellHeight * 0.72)}px`,
      };
    }

    function scrollSuggestIntoView(index = suggestIndex.value) {
      void nextTick(() => {
        // 补全弹窗通过 <Teleport to="body"> 渲染，使用实例 ref 避免多终端互相串扰。
        const container = completionPopupRef.value?.querySelector('.completion-list') as HTMLElement | null;
        const active = container?.querySelector('.completion-item.selected') as HTMLElement | null;
        if (!container || !active) return;
        const padding = 6;
        if (index <= 0) {
          container.scrollTop = 0;
          return;
        }
        if (index >= suggestItems.value.length - 1) {
          container.scrollTop = container.scrollHeight - container.clientHeight;
          return;
        }
        const itemTop = active.offsetTop;
        const itemBottom = itemTop + active.offsetHeight;
        const viewTop = container.scrollTop;
        const viewBottom = viewTop + container.clientHeight;
        if (itemTop < viewTop + padding) {
          container.scrollTop = Math.max(0, itemTop - padding);
        } else if (itemBottom > viewBottom - padding) {
          container.scrollTop = Math.max(0, itemBottom - container.clientHeight + padding);
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
      hideSuggestions();
      if (templateSession) return;
      debouncedUpdateSuggestions(input);
    }

    function moveCursorTo(position: number) {
      if (!sessionId || disposed) return;
      const target = Math.max(0, Math.min(currentLine.length, position));
      const direction = target - cursorPos;
      const steps = textCursorDistance(currentLine, cursorPos, target);
      cursorPos = target;
      placeholderSelectionArmed = false;
      clearSelectionAnchor();
      if (direction < 0) {
        void enqueuePtyWrite('\x1b[D'.repeat(steps));
      } else if (direction > 0) {
        void enqueuePtyWrite('\x1b[C'.repeat(steps));
      }
      clearGhostText();
      scheduleSuggestPosition();
    }

    function highlightActivePlaceholder() {
      term?.clearSelection();
      const placeholder = activePlaceholders[currentPlaceholderIdx];
      if (!term || !placeholder || placeholder.length <= 0) return;
      const buffer = term.buffer.active;
      const cursorRow = buffer.baseY + buffer.cursorY;
      const cursorLinear = cursorRow * term.cols + buffer.cursorX;
      const lineStart = cursorLinear - textCellWidth(currentLine.slice(0, cursorPos));
      const targetLinear = lineStart + textCellWidth(currentLine.slice(0, placeholder.position));
      const row = Math.max(0, Math.floor(targetLinear / term.cols));
      const column = ((targetLinear % term.cols) + term.cols) % term.cols;
      term.select(column, row, textCellWidth(currentLine.slice(placeholder.position, placeholder.position + placeholder.length)));
      placeholderSelectionArmed = true;
    }

    /** 获取当前命令行的 buffer 坐标信息，用于选中计算。 */
    function getCommandLineBounds() {
      if (!term) return null;
      const buffer = term.buffer.active;
      const cols = term.cols;
      const cursorRow = buffer.baseY + buffer.cursorY;
      const cursorLinear = cursorRow * cols + buffer.cursorX;
      const commandStartWidth = textCellWidth(currentLine.slice(0, cursorPos));
      const lineStartLinear = cursorLinear - commandStartWidth;
      const lineLength = textCellWidth(currentLine);
      return { cursorRow, cursorX: buffer.cursorX, lineStartLinear, lineLength, cols };
    }

    /** 清除 Shift 选中锚点。 */
    function clearSelectionAnchor() {
      selAnchorX = null;
      selAnchorY = null;
      selCursorX = null;
      selCursorY = null;
    }

    /** 根据锚点和虚拟光标位置执行 term.select()。 */
    function performSelection() {
      if (!term || selAnchorX === null || selAnchorY === null || selCursorX === null || selCursorY === null) return;
      const cols = term.cols;
      const anchorLinear = selAnchorY * cols + selAnchorX;
      const cursorLinear = selCursorY * cols + selCursorX;
      const startLinear = Math.min(anchorLinear, cursorLinear);
      const length = Math.abs(cursorLinear - anchorLinear);
      if (length <= 0) {
        term.clearSelection();
        return;
      }
      const startRow = Math.floor(startLinear / cols);
      const startCol = startLinear % cols;
      term.select(startCol, startRow, length);
    }

    /** Shift+方向键：在 buffer 坐标空间移动虚拟光标并选中文本。 */
    function handleShiftArrow(event: KeyboardEvent): boolean {
      if (!term) return true;
      const buffer = term.buffer.active;
      const cols = term.cols;
      // 如果锚点不存在，或者之前的选区已被外部清除（如 term.clearSelection()），
      // 则以当前光标位置重新初始化锚点。
      const hasSelection = !!term.getSelection();
      if (selAnchorX === null || !hasSelection) {
        selAnchorX = buffer.cursorX;
        selAnchorY = buffer.baseY + buffer.cursorY;
        selCursorX = buffer.cursorX;
        selCursorY = buffer.baseY + buffer.cursorY;
      }
      switch (event.key) {
        case 'ArrowLeft':
          if (selCursorX! > 0) {
            selCursorX = selCursorX! - 1;
          } else if (selCursorY! > 0) {
            selCursorY = selCursorY! - 1;
            selCursorX = cols - 1;
          }
          break;
        case 'ArrowRight':
          if (selCursorX! < cols - 1) {
            selCursorX = selCursorX! + 1;
          } else {
            selCursorY = selCursorY! + 1;
            selCursorX = 0;
          }
          break;
        case 'ArrowUp':
          if (selCursorY! > 0) selCursorY = selCursorY! - 1;
          break;
        case 'ArrowDown':
          selCursorY = selCursorY! + 1;
          break;
        default:
          return true;
      }
      performSelection();
      return false;
    }

    /** Ctrl+A：选中当前正在输入的整行命令。 */
    function handleSelectAll(): boolean {
      if (!term) return true;
      const buffer = term.buffer.active;
      const cols = term.cols;
      const cursorRow = buffer.baseY + buffer.cursorY;
      let startCol: number;
      let length: number;
      if (currentLine.length > 0) {
        const bounds = getCommandLineBounds();
        if (!bounds) return true;
        if (bounds.lineLength <= 0) return false;
        const row = Math.max(0, Math.floor(bounds.lineStartLinear / cols));
        startCol = ((bounds.lineStartLinear % cols) + cols) % cols;
        length = bounds.lineLength;
        term.select(startCol, row, length);
        selAnchorX = startCol;
        selAnchorY = row;
        selCursorX = startCol + length;
        selCursorY = row;
      } else {
        // currentLine 为空时（PTY 未初始化），回退到选中当前行的非空内容
        const lineText = buffer.getLine(cursorRow)?.translateToString(false) || '';
        const trimmed = lineText.replace(/\s+$/, '');
        length = trimmed.length;
        if (length <= 0) return false;
        startCol = 0;
        term.select(startCol, cursorRow, length);
        selAnchorX = startCol;
        selAnchorY = cursorRow;
        selCursorX = startCol + length;
        selCursorY = cursorRow;
      }
      return false;
    }

    /** Shift+Home：选中从命令开头到当前光标。 */
    function handleShiftHome(): boolean {
      if (!term) return true;
      const buffer = term.buffer.active;
      const cols = term.cols;
      const cursorRow = buffer.baseY + buffer.cursorY;
      const cursorX = buffer.cursorX;
      // currentLine 为空时（PTY 未初始化），回退到 buffer 当前行行首
      const lineStartCol = currentLine.length > 0
        ? ((getCommandLineBounds()?.lineStartLinear ?? 0) % cols + cols) % cols
        : 0;
      selAnchorX = lineStartCol;
      selAnchorY = cursorRow;
      selCursorX = cursorX;
      selCursorY = cursorRow;
      performSelection();
      return false;
    }

    /** Shift+End：选中从当前光标到命令结尾。 */
    function handleShiftEnd(): boolean {
      if (!term) return true;
      const buffer = term.buffer.active;
      const cols = term.cols;
      const cursorRow = buffer.baseY + buffer.cursorY;
      const cursorX = buffer.cursorX;
      // currentLine 为空时（PTY 未初始化），回退到 buffer 当前行行尾
      let endCol: number;
      if (currentLine.length > 0) {
        const bounds = getCommandLineBounds();
        if (!bounds) return true;
        const endLinear = bounds.lineStartLinear + bounds.lineLength;
        endCol = endLinear % cols;
      } else {
        // 读取当前行实际文本，找到最后一个非空字符
        const lineText = buffer.getLine(cursorRow)?.translateToString(false) || '';
        endCol = lineText.replace(/\s+$/, '').length;
      }
      selAnchorX = cursorX;
      selAnchorY = cursorRow;
      selCursorX = endCol;
      selCursorY = cursorRow;
      performSelection();
      return false;
    }

    function shouldReplaceActivePlaceholder(): boolean {
      const placeholder = activePlaceholders[currentPlaceholderIdx];
      if (!placeholder || cursorPos < placeholder.position || cursorPos > placeholder.position + placeholder.length) return false;
      if (placeholderSelectionArmed) return true;
      if (placeholder.resolved) return false;
      return isPlaceholderToken(currentLine.slice(placeholder.position, placeholder.position + placeholder.length));
    }

    function updateTemplateSessionForEdit(editStart: number, removedLength: number, insertedLength: number) {
      if (!templateSession) return;
      const editEnd = editStart + removedLength;
      const removedFromBody = Math.max(0, Math.min(editEnd, templateSession.bodyEnd) - Math.min(editStart, templateSession.bodyEnd));
      const insertedIntoBody = editStart <= templateSession.bodyEnd ? insertedLength : 0;
      templateSession.bodyEnd = Math.max(0, templateSession.bodyEnd - removedFromBody + insertedIntoBody);
      if (editStart <= templateSession.ownedEnd) {
        templateSession.ownedEnd = Math.max(templateSession.bodyEnd, templateSession.ownedEnd + insertedLength - removedLength);
      }
    }

    function templateBodyWasRemoved(): boolean {
      if (!templateSession) return false;
      return currentLine.slice(0, templateSession.bodyEnd).trim().length === 0;
    }

    function clearInvalidTemplateSession(afterEditData: string): boolean {
      if (!templateBodyWasRemoved() || !sessionId) return false;
      currentLine = '';
      cursorPos = 0;
      activePlaceholders = [];
      currentPlaceholderIdx = -1;
      templateSession = null;
      placeholderSelectionArmed = false;
      term?.clearSelection();
      hideSuggestions();
      // Apply the user's edit, then clear the complete readline buffer from end to start.
      void enqueuePtyWrite(`${afterEditData}\x05\x15`);
      return true;
    }

    function replaceActivePlaceholder(text: string): boolean {
      const placeholder = activePlaceholders[currentPlaceholderIdx];
      if (!placeholder || !shouldReplaceActivePlaceholder() || !sessionId) return false;
      const oldPosition = placeholder.position;
      const oldLength = placeholder.length;
      const move = oldPosition - cursorPos;
      const moveSteps = textCursorDistance(currentLine, cursorPos, oldPosition);
      const moveSequence = move < 0 ? '\x1b[D'.repeat(moveSteps) : '\x1b[C'.repeat(moveSteps);
      const result = replacePlaceholderRange(currentLine, activePlaceholders, currentPlaceholderIdx, text);
      currentLine = result.line;
      activePlaceholders = result.placeholders;
      cursorPos = result.cursorPosition;
      updateTemplateSessionForEdit(oldPosition, oldLength, text.length);
      placeholderSelectionArmed = false;
      term?.clearSelection();
      hideSuggestions();
      void enqueuePtyWrite(moveSequence + '\x1b[3~'.repeat(oldLength) + text);
      return true;
    }

    function deleteActivePlaceholder(): boolean {
      const placeholder = activePlaceholders[currentPlaceholderIdx];
      if (!placeholder || !shouldReplaceActivePlaceholder() || !sessionId) return false;
      const oldPosition = placeholder.position;
      const oldLength = placeholder.length;
      const move = oldPosition - cursorPos;
      const moveSteps = textCursorDistance(currentLine, cursorPos, oldPosition);
      const moveSequence = move < 0 ? '\x1b[D'.repeat(moveSteps) : '\x1b[C'.repeat(moveSteps);
      const result = replacePlaceholderRange(currentLine, activePlaceholders, currentPlaceholderIdx, '');
      currentLine = result.line;
      activePlaceholders = result.placeholders;
      cursorPos = result.cursorPosition;
      updateTemplateSessionForEdit(oldPosition, oldLength, 0);
      placeholderSelectionArmed = false;
      term?.clearSelection();
      onInputChanged(currentLine);
      void enqueuePtyWrite(moveSequence + '\x1b[3~'.repeat(oldLength));
      return true;
    }

    function applyTrackedEdit(editStart: number, removedLength: number, insertedLength: number) {
      activePlaceholders = updatePlaceholderRanges(
        activePlaceholders,
        editStart,
        removedLength,
        insertedLength,
        currentPlaceholderIdx,
      );
      updateTemplateSessionForEdit(editStart, removedLength, insertedLength);
    }

    async function initTerminal() {
      if (disposed || !bodyRef.value) return;

      const fontSize = calcFontSize(props.initialWidth, props.initialHeight);
      term = new Terminal({
        theme: getTheme(),
        fontFamily: getTermFontFamily(),
        fontSize,
        fontWeight: '400',
        fontWeightBold: '600',
        lineHeight: 1.2,
        cursorBlink: true,
        cursorStyle: 'bar',
        cursorWidth: 1,
        scrollback: 5000,
        allowProposedApi: true,
        // 启用自定义字形渲染：改善 box drawing（TUI 边框）和 block element 显示
        customGlyphs: true,
      });

      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon());

      const unicode11Addon = new Unicode11Addon();
      term.loadAddon(unicode11Addon);
      term.unicode.activeVersion = '11';

      term.open(bodyRef.value);
      term.onRender(() => {
        if (suggestVisible.value || ghostText.value) scheduleSuggestPosition();
      });

      // 自定义键盘拦截：在普通命令行模式下处理选中快捷键。
      // TUI 模式（vim/htop/less 等）下全部放行，交由应用程序自行处理。
      const isMacPlatform = /Mac/i.test(navigator.platform);
      term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
        if (event.type !== 'keydown') return true;
        // TUI 模式放行
        if (isTuiMode()) return true;

        // Ctrl+A：选中整行命令（覆盖默认的"移动到行首"语义）
        if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'a') {
          return handleSelectAll();
        }

        // Shift+方向键：逐字符/逐行选中
        if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey
            && (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
          return handleShiftArrow(event);
        }

        // Shift+Home / Shift+End：选中到行首/行尾
        if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && event.key === 'Home') {
          return handleShiftHome();
        }
        if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && event.key === 'End') {
          return handleShiftEnd();
        }

        // macOS：Cmd+Left / Cmd+Right 等同 Home / End
        if (isMacPlatform && event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
          if (event.key === 'ArrowLeft') {
            cursorPos = 0;
            placeholderSelectionArmed = false;
            clearSelectionAnchor();
            term?.clearSelection();
            clearGhostText();
            scheduleSuggestPosition();
            void enqueuePtyWrite('\x1b[H');
            return false;
          }
          if (event.key === 'ArrowRight') {
            cursorPos = currentLine.length;
            placeholderSelectionArmed = false;
            clearSelectionAnchor();
            term?.clearSelection();
            refreshGhostText();
            scheduleSuggestPosition();
            void enqueuePtyWrite('\x1b[F');
            return false;
          }
        }

        return true;
      });
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

      // 监听 IME 组合输入状态：composition 期间由输入法处理候选，提交后立即交还终端。
      const imeTextarea = bodyRef.value.querySelector('.xterm-helper-textarea') as HTMLElement | null;
      if (imeTextarea) {
        imeTextarea.addEventListener('compositionstart', () => { imeComposing = true; });
        imeTextarea.addEventListener('compositionend', () => {
          imeComposing = false;
        });
      }

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
        const cwd = normalizeTitleCwd(title);
        if (cwd) {
          currentCwd.value = cwd;
          emit('cwd-change', cwd);
        }
      });

      // 选中空白内容时自动清除选择：终端空白区域是空格字符填充的单元格，
      // 框选时会选中空格，这里在选中内容全为空白时清空，避免"选中了空内容"
      term.onSelectionChange(() => {
        const sel = term?.getSelection();
        if (sel && sel.trim().length === 0) {
          term?.clearSelection();
        }
      });

      // Forward terminal input to PTY and track for suggestions
      term.onData((data) => {
        if (!sessionId || disposed) return;

        // TUI 模式（vim/htop/less/claude/codex 等）：所有按键直接透传 PTY，
        // 不做命令跟踪、补全拦截、占位符跳转等任何行编辑逻辑。
        if (isTuiMode()) {
          void enqueuePtyWrite(data);
          return;
        }

        if (suggestVisible.value && suggestItems.value.length > 0 && (data === '\x1b[A' || data === '\x1b[B')) {
          return;
        }

        if (data === '\x1b' && suggestVisible.value) {
          hideSuggestions();
          return;
        }

        if (data === '\r') {
          if (suggestVisible.value && suggestIndex.value >= 0 && suggestItems.value.length > 0) {
            const item = suggestItems.value[suggestIndex.value];
            if (item) {
              applySuggestion(item);
              return;
            }
          }
          // Placeholder jump: Enter advances to next placeholder;
          // on the last placeholder, Enter executes the command
          if (activePlaceholders.length > 0 && currentPlaceholderIdx >= 0) {
            const isLast = currentPlaceholderIdx >= activePlaceholders.length - 1;
            if (!isLast) {
              jumpToNextPlaceholder();
              return;
            }
            // Last placeholder: strip every unresolved token before execution.
            const sanitizedLine = removeUnresolvedPlaceholderRanges(currentLine, activePlaceholders);
            if (sanitizedLine !== currentLine) {
              const command = sanitizedLine.trim();
              resetLineTracking();
              if (command) emit('command-executed', command, '');
              void enqueuePtyWrite(`\x01\x0b${sanitizedLine}\r`);
              return;
            }
          }
          const command = currentLine.trim();
          resetLineTracking();
          if (command) {
            emit('command-executed', command, '');
          }
          void enqueuePtyWrite(data);
        } else if (data === '\x7f' || data === '\b') {
          // 组合输入期间由输入法消费退格；compositionend 后不再吞键。
          if (imeComposing) return;
          if (deleteActivePlaceholder()) return;
          if (cursorPos > 0) {
            const editStart = previousTextBoundary(currentLine, cursorPos);
            const removedLength = cursorPos - editStart;
            currentLine = currentLine.slice(0, editStart) + currentLine.slice(cursorPos);
            cursorPos = editStart;
            applyTrackedEdit(editStart, removedLength, 0);
          }
          clearSelectionAnchor();
          if (clearInvalidTemplateSession(data)) return;
          onInputChanged(currentLine);
          void enqueuePtyWrite(data);
        } else if (CURSOR_LEFT_SEQUENCES.has(data)) {
          cursorPos = previousTextBoundary(currentLine, cursorPos);
          placeholderSelectionArmed = false;
          clearSelectionAnchor();
          term?.clearSelection();
          clearGhostText();
          scheduleSuggestPosition();
          void enqueuePtyWrite(data);
        } else if (CURSOR_RIGHT_SEQUENCES.has(data)) {
          cursorPos = nextTextBoundary(currentLine, cursorPos);
          placeholderSelectionArmed = false;
          clearSelectionAnchor();
          term?.clearSelection();
          if (cursorPos === currentLine.length) refreshGhostText();
          scheduleSuggestPosition();
          void enqueuePtyWrite(data);
        } else if (data === '\x1b[A') {
          resetLineTracking();
          void enqueuePtyWrite(data);
        } else if (data === '\x1b[B') {
          resetLineTracking();
          void enqueuePtyWrite(data);
        } else if (data === '\x03') {
          resetLineTracking();
          void enqueuePtyWrite(data);
        } else if (data === '\x15') {
          const removed = cursorPos;
          currentLine = currentLine.slice(cursorPos);
          cursorPos = 0;
          applyTrackedEdit(0, removed, 0);
          if (clearInvalidTemplateSession(data)) return;
          onInputChanged(currentLine);
          void enqueuePtyWrite(data);
        } else if (data === '\x17') {
          const beforeCursor = currentLine.slice(0, cursorPos);
          const trimmed = beforeCursor.replace(/\S+\s*$/, '');
          const deleted = cursorPos - trimmed.length;
          currentLine = trimmed + currentLine.slice(cursorPos);
          cursorPos -= deleted;
          applyTrackedEdit(cursorPos, deleted, 0);
          if (clearInvalidTemplateSession(data)) return;
          onInputChanged(currentLine);
          void enqueuePtyWrite(data);
        } else if (data === '\x01') {
          cursorPos = 0;
          placeholderSelectionArmed = false;
          clearSelectionAnchor();
          term?.clearSelection();
          clearGhostText();
          scheduleSuggestPosition();
          void enqueuePtyWrite(data);
        } else if (data === '\x05') {
          cursorPos = currentLine.length;
          placeholderSelectionArmed = false;
          clearSelectionAnchor();
          term?.clearSelection();
          refreshGhostText();
          scheduleSuggestPosition();
          void enqueuePtyWrite(data);
        } else if (data === '\x0b') {
          const removed = currentLine.length - cursorPos;
          currentLine = currentLine.slice(0, cursorPos);
          applyTrackedEdit(cursorPos, removed, 0);
          if (templateBodyWasRemoved()) {
            resetLineTracking();
          } else {
            onInputChanged(currentLine);
          }
          void enqueuePtyWrite(data);
        } else if (data === '\t') {
          if (suggestVisible.value && suggestItems.value.length > 0) {
            if (suggestIndex.value < 0) {
              suggestSelectionMode.value = 'keyboard';
              suggestIndex.value = 0;
              scrollSuggestIntoView(0);
              refreshGhostText();
            } else {
              const item = suggestItems.value[suggestIndex.value];
              applySuggestion(item);
            }
          } else if (activePlaceholders.length > 0 && currentPlaceholderIdx >= 0) {
            jumpToPlaceholder(1, true);
          } else {
            void enqueuePtyWrite(data);
          }
        } else if (data === '\x1b[Z' && activePlaceholders.length > 0 && currentPlaceholderIdx >= 0) {
          jumpToPlaceholder(-1, true);
        } else if (data === '\x1b[3~') {
          if (deleteActivePlaceholder()) return;
          if (cursorPos < currentLine.length) {
            const nextPosition = nextTextBoundary(currentLine, cursorPos);
            currentLine = currentLine.slice(0, cursorPos) + currentLine.slice(nextPosition);
            applyTrackedEdit(cursorPos, nextPosition - cursorPos, 0);
          }
          if (clearInvalidTemplateSession(data)) return;
          onInputChanged(currentLine);
          void enqueuePtyWrite(data);
        } else if (MODIFIED_ARROW_RE.test(data)) {
          // 修饰方向键可能由 shell 绑定为按词移动；必须透传，不能在前端吞掉。
          clearSelectionAnchor();
          hideSuggestions();
          void enqueuePtyWrite(data);
        } else if (data.length === 1 && data >= ' ') {
          if (replaceActivePlaceholder(data)) return;
          const editStart = cursorPos;
          currentLine = currentLine.slice(0, cursorPos) + data + currentLine.slice(cursorPos);
          cursorPos++;
          applyTrackedEdit(editStart, 0, data.length);
          clearSelectionAnchor();
          onInputChanged(currentLine);
          void enqueuePtyWrite(data);
        } else if (data.length > 1 && !data.startsWith('\x1b') && !data.includes('\r') && !data.includes('\n') && !data.includes('\x7f') && !data.includes('\b')) {
          // IME 输入（中文/日文等）：onData 收到的是完整输入文本（多字符），
          // 需要整体插入 currentLine 并更新 cursorPos，否则后续删除会错位。
          // 排除含控制字符的多字符数据（如粘贴多行文本），交给下方 else 透传
          if (replaceActivePlaceholder(data)) return;
          const editStart = cursorPos;
          currentLine = currentLine.slice(0, editStart) + data + currentLine.slice(cursorPos);
          cursorPos += data.length;
          applyTrackedEdit(editStart, 0, data.length);
          onInputChanged(currentLine);
          void enqueuePtyWrite(data);
        } else if (data === '\x1b[H' || data === '\x1b[1~') {
          cursorPos = 0;
          placeholderSelectionArmed = false;
          clearSelectionAnchor();
          term?.clearSelection();
          clearGhostText();
          scheduleSuggestPosition();
          void enqueuePtyWrite(data);
        } else if (data === '\x1b[F' || data === '\x1b[4~') {
          cursorPos = currentLine.length;
          placeholderSelectionArmed = false;
          clearSelectionAnchor();
          term?.clearSelection();
          refreshGhostText();
          scheduleSuggestPosition();
          void enqueuePtyWrite(data);
        } else if (data.startsWith('\x1b[')) {
          // Unknown escape sequences — pass to PTY
          // but reset local tracking since we can't know cursor state after
          void enqueuePtyWrite(data);
          resetLineTracking();
        } else {
          if (data.includes('\r') || data.includes('\n')) resetLineTracking();
          else clearGhostText();
          void enqueuePtyWrite(data);
        }
      });

      // Handle key events for suggestion navigation
      term.onKey(({ domEvent }) => {
        if (suggestVisible.value && suggestItems.value.length > 0) {
          if (domEvent.key === 'ArrowDown') {
            domEvent.preventDefault();
            suggestSelectionMode.value = 'keyboard';
            lastSuggestMouseX = Number.NaN;
            lastSuggestMouseY = Number.NaN;
            suggestIndex.value = suggestIndex.value < 0
              ? 0
              : (suggestIndex.value + 1) % suggestItems.value.length;
            scrollSuggestIntoView(suggestIndex.value);
            refreshGhostText();
            return;
          }
          if (domEvent.key === 'ArrowUp') {
            domEvent.preventDefault();
            suggestSelectionMode.value = 'keyboard';
            lastSuggestMouseX = Number.NaN;
            lastSuggestMouseY = Number.NaN;
            suggestIndex.value = suggestIndex.value < 0
              ? suggestItems.value.length - 1
              : (suggestIndex.value - 1 + suggestItems.value.length) % suggestItems.value.length;
            scrollSuggestIntoView(suggestIndex.value);
            refreshGhostText();
            return;
          }
          if (domEvent.key === 'Escape') {
            hideSuggestions();
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
          // Only treat as click-to-move if it's a simple click (no significant drag)
          if (dx > 6 || dy > 6 || elapsed > 500) return;
          if (!term || !sessionId || disposed || !currentLine || isTuiMode()) return;

          handleCursorClick(e);
        });
      }

      if (props.launchOptions.startupCommand) {
        await enqueuePtyWrite(props.launchOptions.startupCommand + '\n');
      }

      if (props.launchOptions.passwordSequence) {
        let delay = 1500;
        for (const seq of props.launchOptions.passwordSequence) {
          setTimeout(() => {
            if (!disposed && sessionId) {
              void enqueuePtyWrite(seq);
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
      jumpToPlaceholder(1, false);
    }

    function jumpToPlaceholder(direction: 1 | -1, wrap: boolean) {
      if (activePlaceholders.length === 0 || currentPlaceholderIdx < 0 || !sessionId || disposed) return;
      let nextIdx = currentPlaceholderIdx + direction;
      if (wrap) {
        nextIdx = (nextIdx + activePlaceholders.length) % activePlaceholders.length;
      } else if (nextIdx < 0 || nextIdx >= activePlaceholders.length) {
        return;
      }

      currentPlaceholderIdx = nextIdx;
      const target = activePlaceholders[nextIdx];
      moveCursorTo(target.position);
      setTimeout(highlightActivePlaceholder, 20);
    }

    function handleCursorClick(e: MouseEvent) {
      if (!term || !sessionId || disposed || !currentLine || isTuiMode()) return;

      const buf = term.buffer.active;
      const cursorY = buf.cursorY;
      const cursorX = buf.cursorX;

      // Find the actual rendering canvas — it's the element that maps 1:1 to cells.
      // The WebGL/Canvas renderer creates a canvas inside .xterm-screen.
      const screenEl = bodyRef.value?.querySelector('.xterm-screen') as HTMLElement | null;
      if (!screenEl) return;

      const screenRect = screenEl.getBoundingClientRect();

      // Relative position within the screen element
      const relX = e.clientX - screenRect.left;
      const relY = e.clientY - screenRect.top;

      // getBoundingClientRect 已包含画布缩放，因此直接按实际屏幕尺寸换算单元格。
      const cellW = screenRect.width / term.cols;
      const cellH = screenRect.height / term.rows;

      if (cellW <= 0 || cellH <= 0) return;

      // Determine clicked row and column (0-based)
      const clickRow = Math.max(0, Math.min(term.rows - 1, Math.floor(relY / cellH)));
      const clickCol = Math.max(0, Math.min(term.cols - 1, Math.floor(relX / cellW)));

      if (clickRow !== cursorY) return;

      // 中文等宽字符占两个单元格，提示符起点必须按显示宽度而非 JS 字符串长度计算。
      const promptStartCol = cursorX - textCellWidth(currentLine.slice(0, cursorPos));
      if (promptStartCol < 0) return;

      // Target position within the tracked input line
      const targetPos = textIndexAtCell(currentLine, clickCol - promptStartCol);

      if (targetPos === cursorPos) return;

      // Send arrow keys to move cursor
      const direction = targetPos - cursorPos;
      const steps = textCursorDistance(currentLine, cursorPos, targetPos);
      cursorPos = targetPos;
      placeholderSelectionArmed = false;
      clearSelectionAnchor();
      const clickedPlaceholderIndex = activePlaceholders.findIndex((placeholder) => (
        targetPos >= placeholder.position && targetPos <= placeholder.position + placeholder.length
      ));
      if (clickedPlaceholderIndex >= 0) currentPlaceholderIdx = clickedPlaceholderIndex;
      clearGhostText();
      scheduleSuggestPosition();
      if (direction < 0) {
        void enqueuePtyWrite('\x1b[D'.repeat(steps));
      } else {
        void enqueuePtyWrite('\x1b[C'.repeat(steps));
      }
      if (clickedPlaceholderIndex >= 0) setTimeout(highlightActivePlaceholder, 20);
    }

    function applySuggestion(item: SuggestionItem) {
      if (!term || !sessionId || disposed) return;

      const ph = item.placeholders;
      const hasPlaceholders = ph && ph.hasPlaceholders && ph.placeholders.length > 0;
      // Use the insertText that includes placeholder tokens (e.g. <src>) so
      // the user can see and replace them. Fall back to raw text if no placeholders.
      const newText = hasPlaceholders ? ph!.insertText : (item.insertText || item.executeText);

      hideSuggestions();

      // Move to the beginning and kill to the end so cursor edits cannot leave a suffix behind.
      void enqueuePtyWrite('\x01\x0b');

      setTimeout(() => {
        if (!sessionId || disposed) return;

        // Set up placeholder state before writing
        activePlaceholders = [];
        currentPlaceholderIdx = -1;
        templateSession = null;
        placeholderSelectionArmed = false;

        if (hasPlaceholders && ph!.placeholders.length > 0) {
          activePlaceholders = ph!.placeholders.map((placeholder) => ({ ...placeholder }));
          currentPlaceholderIdx = 0;
          currentLine = newText;
          cursorPos = newText.length;
          const firstPlaceholder = activePlaceholders[0];
          templateSession = {
            bodyEnd: newText.slice(0, firstPlaceholder.position).trimEnd().length,
            ownedEnd: newText.length,
          };
        } else {
          currentLine = newText;
          cursorPos = newText.length;
        }

        void enqueuePtyWrite(newText).then(() => {
          if (disposed || !sessionId) return;
          // Move cursor to first placeholder position after PTY has echoed the text
          if (hasPlaceholders && activePlaceholders.length > 0 && currentPlaceholderIdx >= 0) {
            setTimeout(() => {
              if (disposed || !sessionId) return;
              const targetPos = activePlaceholders[currentPlaceholderIdx].position;
              const moveLeft = cursorPos - targetPos;
              if (moveLeft > 0) {
                const moveSteps = textCursorDistance(currentLine, cursorPos, targetPos);
                cursorPos = targetPos;
                const seq = '\x1b[D'.repeat(moveSteps);
                void enqueuePtyWrite(seq);
              }
              setTimeout(highlightActivePlaceholder, 20);
            }, 80);
          }
        });
      }, 40);
    }

    // 选中并应用某条建议到命令行（委托给 applySuggestion）
    function selectSuggestion(item: SuggestionItem) {
      applySuggestion(item);
    }

    function selectSuggestionByMouse(index: number, event: MouseEvent) {
      const hasPrevious = Number.isFinite(lastSuggestMouseX) && Number.isFinite(lastSuggestMouseY);
      const moved = hasPrevious
        ? Math.abs(event.clientX - lastSuggestMouseX) > 1 || Math.abs(event.clientY - lastSuggestMouseY) > 1
        : Math.abs(event.movementX) > 0 || Math.abs(event.movementY) > 0;
      lastSuggestMouseX = event.clientX;
      lastSuggestMouseY = event.clientY;
      if (!moved) return;
      suggestSelectionMode.value = 'mouse';
      suggestIndex.value = index;
      refreshGhostText();
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
        scheduleSuggestPosition();
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
        scheduleSuggestPosition();
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
        scheduleSuggestPosition();
        // 用 requestAnimationFrame 节流，避免拖动缩放时每帧都调用 resize_pty（60+次/秒）
        if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
        resizeRafId = requestAnimationFrame(() => {
          handleResize();
          resizeRafId = null;
        });
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
      if (sessionId) void enqueuePtyWrite(data);
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
      hideSuggestions();
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
      if (resizeRafId !== null) {
        cancelAnimationFrame(resizeRafId);
        resizeRafId = null;
      }
      if (suggestTimer) {
        clearTimeout(suggestTimer);
        suggestTimer = null;
      }
      if (suggestPositionRafId !== null) {
        cancelAnimationFrame(suggestPositionRafId);
        suggestPositionRafId = null;
      }
      if (outputFlushTimer) {
        clearTimeout(outputFlushTimer);
        outputFlushTimer = null;
      }
      outputBuffer = '';
      if (onTermFontSizeChange) {
        window.removeEventListener('term-font-size-change', onTermFontSizeChange);
        onTermFontSizeChange = null;
      }
      if (onTermFontFamilyChange) {
        window.removeEventListener('term-font-family-change', onTermFontFamilyChange);
        onTermFontFamilyChange = null;
      }
      if (onTermFlagsChange) {
        window.removeEventListener('term-flags-change', onTermFlagsChange);
        onTermFlagsChange = null;
      }
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

      // 监听设置面板派发的终端字号/字体族变化事件，实时更新 xterm
      onTermFontSizeChange = () => {
        if (disposed || !term) return;
        term.options.fontSize = calcFontSize(rectState.value.w, rectState.value.h);
        fitAddon?.fit();
        scheduleSuggestPosition();
      };
      onTermFontFamilyChange = () => {
        if (disposed || !term) return;
        term.options.fontFamily = getTermFontFamily();
        fitAddon?.fit();
        scheduleSuggestPosition();
      };
      window.addEventListener('term-font-size-change', onTermFontSizeChange);
      window.addEventListener('term-font-family-change', onTermFontFamilyChange);

      // 监听设置面板派发的标志变化事件，实时响应命令补全 / Ghost Text 开关
      onTermFlagsChange = () => {
        if (disposed) return;
        // 命令智能补全被关闭时，立即清除已显示的建议弹窗
        if (!getLocalFlags().commandSuggest) {
          hideSuggestions();
        } else if (!getLocalFlags().ghostText) {
          clearGhostText();
        } else {
          refreshGhostText();
        }
      };
      window.addEventListener('term-flags-change', onTermFlagsChange);
    });

    watch(() => props.filePanelOpen, () => {
      void nextTick(() => {
        handleResize();
        scheduleSuggestPosition();
      });
    });

    watch(() => props.viewportZoom, scheduleSuggestPosition);

    onUnmounted(() => {
      document.removeEventListener('click', onSshMenuOutsideClick);
      destroy();
    });

    // 暴露命令式能力，供父组件统一标题栏和文件面板调用
    expose({ writeToTerminal, startDrag, startResize, minimize, toggleMaximize, requestClose, hideSuggestions, blur });

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
      suggestSelectionMode,
      suggestStyle,
      suggestPlacement,
      completionPopupRef,
      ghostText,
      ghostStyle,
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
      selectSuggestionByMouse,
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
