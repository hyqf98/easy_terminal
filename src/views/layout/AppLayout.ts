import { defineComponent, ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { t, onLangChange } from '../../i18n';
import { useCraftTheme, migrateThemeId } from '../../composables/useCraftTheme';
import { showMessage, useAppMessage } from '../../composables/useAppMessage';
import { useAppDialog } from '../../composables/useAppDialog';
import Titlebar from '../titlebar/Titlebar.vue';
import Dock from '../../components/Dock.vue';
import CanvasMinimap from '../canvas/CanvasMinimap.vue';
import TerminalModal from '../../components/modals/TerminalModal.vue';
import PreviewPanel from '../preview/PreviewPanel.vue';
import CommandConfigPanel from '../command/CommandConfigPanel.vue';
import CommandMarketPanel from '../command/CommandMarketPanel.vue';
import HistoryPanel from '../history/HistoryPanel.vue';
import SshPanel from '../ssh/SshPanel.vue';
import ShortcutPanel from '../shortcut/ShortcutPanel.vue';
import SettingsPanel from '../settings/SettingsPanel.vue';
import TerminalWindow from '../terminal/TerminalWindow.vue';
import TerminalFilePanel from '../terminal/TerminalFilePanel.vue';
import FileManager from '../filemanager/FileManager.vue';
import { Canvas } from '../canvas/canvas';
import { ShortcutManager } from '../shortcut/shortcutManager';
import { setupDesktopDrawShortcut } from '../shortcut/globalShortcut';
import type { SSHProfile, TerminalLaunchOptions, WorkspaceState, SnapTarget, Rect, SnapOptions } from '../../types';
import type { IFileOperationStrategy } from '../filetree/strategies/FileOperationStrategy';
import { Perf } from '../../utils/perf';

type ViewId = 'canvas' | 'files' | 'commands' | 'market' | 'history' | 'ssh' | 'shortcuts' | 'settings';

interface TerminalEntry {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  zIndex: number;
  launchOptions: TerminalLaunchOptions;
}

type TerminalInteractionKind = 'drag' | 'resize';

// Dock 视图与 sidebar 快捷键目标的映射
const SHORTCUT_VIEW_MAP: Record<string, ViewId> = {
  'sidebar.files': 'files',
  'sidebar.commands': 'commands',
  'sidebar.history': 'history',
  'sidebar.ssh': 'ssh',
  'sidebar.shortcuts': 'shortcuts',
  'sidebar.settings': 'settings',
};

let nextTerminalId = 1;

export default defineComponent({
  name: 'AppLayout',
  components: {
    Titlebar, Dock, CanvasMinimap, TerminalModal,
    PreviewPanel, CommandConfigPanel, CommandMarketPanel,
    HistoryPanel, SshPanel, ShortcutPanel, SettingsPanel, TerminalWindow, TerminalFilePanel,
    FileManager,
  },
  setup() {
    useAppMessage();
    useAppDialog();
    const { setTheme: setCraftTheme } = useCraftTheme();

    const settingsRef = ref<InstanceType<typeof SettingsPanel> | null>(null);
    const sshPanelRef = ref<InstanceType<typeof SshPanel> | null>(null);
    const marketRef = ref<InstanceType<typeof CommandMarketPanel> | null>(null);
    const viewportRef = ref<HTMLDivElement | null>(null);
    const canvasRef = ref<HTMLDivElement | null>(null);

    const activeView = ref<ViewId>('canvas');
    // 当前预览文件路径：非空则弹出右侧 PreviewPanel
    const previewPath = ref('');
    const showHint = ref(true);
    const terminalModalOpen = ref(false);
    const hintLabel = computed(() => t('hint.canvas'));
    const canvasHintLabel = computed(() => t('hint.canvasDrag'));
    const newTerminalLabel = computed(() => t('canvas.newTerminal'));
    // 文件管理空视图占位文案
    const filesPlaceholderLabel = '文件管理';

    const terminals = ref<TerminalEntry[]>([]);
    const activeTerminalId = ref('');
    const unifiedHoveredTerminalId = ref('');
    const unifiedInteraction = ref<{ id: string; kind: TerminalInteractionKind | '' }>({ id: '', kind: '' });
    const unifiedSshMenuTerminalId = ref('');
    // 当前激活终端的工作目录：用于「定位当前目录」按钮同步文件树
    const activeTerminalCwd = ref('');
    // 各终端实时 CWD（按 terminalId 索引），供文件面板与其绑定终端联动
    const terminalCwds = ref<Record<string, string>>({});
    // 展开的文件面板所属终端 ID（同时只展开一个）
    const filePanelTerminalId = ref('');
    // 各终端实例引用（非响应式 Map，仅用于命令式访问）
    const terminalInstanceMap = new Map<string, any>();
    /** v-for 函数 ref 回调：存储/清理终端实例引用 */
    function setTerminalRef(id: string, el: any) {
      if (el) terminalInstanceMap.set(id, el);
      else terminalInstanceMap.delete(id);
    }
    // 激活终端高亮：activeTerminalId 变化时，激活终端 focus()、其余 blur()。
    // flush:'post' 确保 v-for 渲染后 ref 已注入 terminalInstanceMap 再执行。
    watch(activeTerminalId, (activeId) => {
      if (!activeId) return;
      for (const [id, el] of terminalInstanceMap) {
        if (id === activeId) el?.focus?.();
        else el?.blur?.();
      }
    }, { flush: 'post' });
    // 可用的 SSH 配置列表：透传给每个终端以支持标题栏快速切换
    const sshProfiles = ref<SSHProfile[]>([]);
    // 当前文件操作策略：本地为 null（走 invoke），远程为对应策略实例（由后续 Change 接线）
    const currentFileStrategy = ref<IFileOperationStrategy | null>(null);
    const zCounter = ref(1);

    let canvas: Canvas | null = null;
    const canvasZoom = ref(1);
    let shortcutManager: ShortcutManager | null = null;

    const appWin = getCurrentWindow();

    function onMinimize() { void appWin.minimize(); }
    function onMaximize() { void appWin.toggleMaximize(); }
    async function onClose() {
      try { await persistWorkspace(); } catch { /* ignore */ }
      await appWin.destroy();
    }

    function onViewChange(view: string) {
      const next = view as ViewId;
      activeView.value = next;
      // 切换到非画布视图时，隐藏所有终端的命令提示弹窗（弹窗 Teleport 到 body，
      // v-show 切换不会连带隐藏）
      if (next !== 'canvas') {
        for (const [, el] of terminalInstanceMap) {
          el?.hideSuggestions?.();
          el?.blur?.();
        }
      }
      if (next === 'market' && marketRef.value) {
        // @ts-expect-error exposed component method
        void marketRef.value.init?.();
      }
    }

    function onToolbarNewTerminal(options?: TerminalLaunchOptions) {
      createTerminal(80, 80, 700, 450, options || {});
    }

    function onToolbarResetView() {
      canvas?.resetView();
    }

    function openTerminalModal() {
      terminalModalOpen.value = true;
    }

    function createTerminal(
      x = 80,
      y = 80,
      w = 700,
      h = 450,
      options: TerminalLaunchOptions = {},
      zIndexOverride?: number,
      autoFitViewport = true,
    ) {
      const id = `term-${nextTerminalId++}`;
      const entry: TerminalEntry = {
        id, x, y, w, h,
        zIndex: zIndexOverride ?? zCounter.value++,
        launchOptions: options,
      };
      terminals.value.push(entry);
      activeTerminalId.value = id;
      showHint.value = false;
      // 首个终端创建后：智能调整视口缩放让终端以合理大小居中显示
      // 避免在极小 zoom 下终端内容看不清（非框选入口：Dock新建、SSH连接等）
      if (autoFitViewport && terminals.value.length === 1) {
        void nextTick(() => fitTerminalToViewport(x, y, w, h));
      }
      return id;
    }

    /** 调整画布视口让指定终端以约 70% 占比居中显示 */
    function fitTerminalToViewport(x: number, y: number, w: number, h: number) {
      const vp = viewportRef.value;
      if (!vp || !canvas) return;
      const targetZoomW = (vp.clientWidth * 0.7) / w;
      const targetZoomH = (vp.clientHeight * 0.7) / h;
      const targetZoom = Math.min(targetZoomW, targetZoomH, 1.5);
      const panX = vp.clientWidth / 2 - (x + w / 2) * targetZoom;
      const panY = vp.clientHeight / 2 - (y + h / 2) * targetZoom;
      canvas.setState({ panX, panY, zoom: targetZoom });
    }

    // 在指定位置创建 SSH 终端（复用 SSH 启动命令与密码序列逻辑）
    function createSshTerminal(profile: SSHProfile, pos: { x: number; y: number; w: number; h: number; zIndex?: number }) {
      const passwordSeq = profile.authType === 'password' && profile.password
        ? [`${profile.password}\n`] : undefined;
      const startupCmd = `ssh ${profile.user}@${profile.host} -p ${profile.port}`;
      activeView.value = 'canvas';
      createTerminal(pos.x, pos.y, pos.w, pos.h, {
        mode: 'ssh',
        profileName: profile.name,
        profileId: profile.id,
        cwd: undefined,
        startupCommand: startupCmd,
        passwordSequence: passwordSeq,
      }, pos.zIndex);
    }

    function onTerminalActivate(id: string) {
      activeTerminalId.value = id;
      const entry = terminals.value.find((term) => term.id === id);
      if (entry) {
        entry.zIndex = zCounter.value++;
        terminals.value = [...terminals.value];
        // 同步当前激活终端的工作目录，供文件树「定位」使用
        activeTerminalCwd.value = entry.launchOptions.cwd || '';
      }
    }

    function onTerminalClose(id: string) {
      terminals.value = terminals.value.filter((term) => term.id !== id);
      if (activeTerminalId.value === id) {
        activeTerminalId.value = terminals.value[terminals.value.length - 1]?.id || '';
      }
      showHint.value = terminals.value.length === 0;
      void persistWorkspace();
    }

    function onTerminalInteractionStart(id: string, kind: TerminalInteractionKind = 'drag') {
      unifiedInteraction.value = { id, kind };
    }
    function onTerminalInteractionEnd(id: string) {
      if (unifiedInteraction.value.id === id) {
        unifiedInteraction.value = { id: '', kind: '' };
      }
    }

    function onCommandExecuted(command: string, cwd: string, launchOptions?: TerminalLaunchOptions) {
      // 透传终端类型与 SSH 配置名，便于历史按 本地/SSH 分组
      const mode = launchOptions?.mode || 'local';
      const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        command,
        cwd,
        timestamp: Date.now(),
        count: 1,
        variants: [],
        mode,
        profileName: mode === 'ssh' ? (launchOptions?.profileName || '') : '',
      };
      void invoke('record_command_history', { entry });
    }

    function onOpenTerminalAt(dirPath: string) {
      activeView.value = 'canvas';
      createTerminal(50, 50, 700, 450, { cwd: dirPath });
    }

    /** 终端文件面板触发的预览：携带面板当前策略（本地/远程）以正确预览 */
    function onTerminalPanelPreview(payload: { path: string; strategy: IFileOperationStrategy | null }) {
      currentFileStrategy.value = payload.strategy;
      previewPath.value = payload.path;
    }

    /** 终端位置/尺寸变化（拖拽/缩放中实时同步），更新 terminals 数组以驱动文件面板跟随 */
    function onTerminalRectChange(terminalId: string, rect: { x: number; y: number; w: number; h: number }) {
      const entry = terminals.value.find((t) => t.id === terminalId);
      if (entry) {
        entry.x = rect.x;
        entry.y = rect.y;
        entry.w = rect.w;
        entry.h = rect.h;
        terminals.value = [...terminals.value];
      }
    }

    /** 终端箭头点击：切换该终端的独立文件面板 */
    function onToggleFilePanel(terminalId: string) {
      filePanelTerminalId.value = filePanelTerminalId.value === terminalId ? '' : terminalId;
    }

    /** 当前展开的文件面板对应的终端条目 */
    const filePanelTerminal = computed(() => {
      if (!filePanelTerminalId.value) return null;
      return terminals.value.find((t) => t.id === filePanelTerminalId.value) || null;
    });

    /** 文件面板宽度（可拖拽调整，localStorage 持久化） */
    const FILEPANEL_WIDTH_KEY = 'easy_terminal_filepanel_width';
    const FILEPANEL_MIN = 200;
    const FILEPANEL_MAX = 480;
    const UNIFIED_TITLEBAR_H = 28;
    const filePanelWidth = ref<number>((() => {
      const raw = localStorage.getItem(FILEPANEL_WIDTH_KEY);
      const n = raw ? parseInt(raw, 10) : NaN;
      return Number.isFinite(n) && n >= FILEPANEL_MIN && n <= FILEPANEL_MAX ? n : 220;
    })());

    function getUnifiedRect(term: TerminalEntry): Rect {
      if (filePanelTerminalId.value !== term.id) {
        return { x: term.x, y: term.y, w: term.w, h: term.h };
      }
      return {
        x: term.x - filePanelWidth.value,
        y: term.y,
        w: term.w + filePanelWidth.value,
        h: term.h,
      };
    }

    function getUnifiedWindowStyle(term: TerminalEntry): Record<string, string> {
      const rect = getUnifiedRect(term);
      return {
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.w}px`,
        height: `${rect.h}px`,
        zIndex: String(term.zIndex),
      };
    }

    function getUnifiedTitlebarStyle(term: TerminalEntry): Record<string, string> {
      const rect = getUnifiedRect(term);
      return {
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.w}px`,
        height: `${UNIFIED_TITLEBAR_H}px`,
        zIndex: String(term.zIndex + 1),
      };
    }

    function getUnifiedWindowClasses(term: TerminalEntry): Record<string, boolean> {
      return {
        focused: activeTerminalId.value === term.id,
        hovered: unifiedHoveredTerminalId.value === term.id,
        dragging: unifiedInteraction.value.id === term.id && unifiedInteraction.value.kind === 'drag',
        resizing: unifiedInteraction.value.id === term.id && unifiedInteraction.value.kind === 'resize',
      };
    }

    function onUnifiedPointerEnter(terminalId: string) {
      unifiedHoveredTerminalId.value = terminalId;
    }

    function onUnifiedPointerLeave(terminalId: string, event: MouseEvent) {
      const related = event.relatedTarget as HTMLElement | null;
      const relatedGroup = related?.closest('[data-unified-terminal-id]') as HTMLElement | null;
      if (relatedGroup?.dataset.unifiedTerminalId === terminalId) return;
      if (unifiedHoveredTerminalId.value === terminalId) {
        unifiedHoveredTerminalId.value = '';
      }
    }

    function getUnifiedTitle(term: TerminalEntry): string {
      return term.launchOptions.profileName || t('terminal.unnamed');
    }

    function getUnifiedCwd(term: TerminalEntry): string {
      return terminalCwds.value[term.id] || term.launchOptions.cwd || '';
    }

    function isUnifiedSsh(term: TerminalEntry): boolean {
      return term.launchOptions.mode === 'ssh';
    }

    function getUnifiedStatusPulse(term: TerminalEntry): string {
      return isUnifiedSsh(term) ? 'accent' : 'green';
    }

    function getUnifiedStatusText(term: TerminalEntry): string {
      return isUnifiedSsh(term) ? 'SSH' : 'Local';
    }

    function onUnifiedTitleDrag(terminalId: string, event: MouseEvent) {
      onTerminalActivate(terminalId);
      terminalInstanceMap.get(terminalId)?.startDrag?.(event);
    }

    function onUnifiedClose(terminalId: string) {
      terminalInstanceMap.get(terminalId)?.requestClose?.();
    }

    function onUnifiedMinimize(terminalId: string) {
      terminalInstanceMap.get(terminalId)?.minimize?.();
    }

    function onUnifiedMaximize(terminalId: string) {
      terminalInstanceMap.get(terminalId)?.toggleMaximize?.();
    }

    function toggleUnifiedSshMenu(terminalId: string) {
      unifiedSshMenuTerminalId.value = unifiedSshMenuTerminalId.value === terminalId ? '' : terminalId;
    }

    function onUnifiedSwitchSsh(terminalId: string, profileId: string | null) {
      unifiedSshMenuTerminalId.value = '';
      onSwitchSsh(terminalId, profileId);
    }

    /** 文件面板左下角手柄：触发绑定终端自身的 startResize('sw')，面板随之同步缩放（一体） */
    function onPanelResizeStart(e: MouseEvent) {
      const term = filePanelTerminal.value;
      if (!term) return;
      const inst = terminalInstanceMap.get(term.id);
      // TerminalWindow 通过 expose 暴露了 startResize，直接调用即可让面板跟随终端同步缩放
      // 面板定位（filePanelStyle）依赖终端 rect，终端 startResize 变化后面板自动跟随
      const startResize = (inst as any)?.startResize;
      if (typeof startResize === 'function') {
        startResize.call(inst, 'sw', e);
      }
    }

    /** 文件面板在画布上的定位：拼接在终端左侧，紧贴无缝，宽度可拖拽调整 */
    const filePanelStyle = computed(() => {
      const term = filePanelTerminal.value;
      if (!term) return { display: 'none' } as Record<string, string>;
      const PANEL_W = filePanelWidth.value;
      return {
        left: `${term.x - PANEL_W}px`,
        top: `${term.y + UNIFIED_TITLEBAR_H}px`,
        width: `${PANEL_W}px`,
        height: `${Math.max(100, term.h - UNIFIED_TITLEBAR_H)}px`,
        zIndex: String(term.zIndex),
      } as Record<string, string>;
    });

    /** 文件面板「在终端打开（cd）」：写入面板所绑定终端的 PTY */
    function onPanelCdTo(payload: { path: string; terminalId: string }) {
      const term = terminalInstanceMap.get(payload.terminalId);
      term?.writeToTerminal?.(`cd "${payload.path}"\n`);
    }

    /** 终端 cwd 变化：记录到 terminalCwds 并同步 activeTerminalCwd */
    function onTerminalCwdChange(terminalId: string, cwd: string) {
      terminalCwds.value[terminalId] = cwd;
      if (terminalId === activeTerminalId.value) activeTerminalCwd.value = cwd;
    }

    async function onSshConnect(profile: SSHProfile, _profiles: SSHProfile[]) {
      activeView.value = 'canvas';
      createSshTerminal(profile, { x: 80, y: 80, w: 700, h: 450 });
    }

    function onSshProfilesChange(profiles: SSHProfile[]) {
      sshProfiles.value = profiles;
    }

    function onSshSelectionChange(_profile: SSHProfile | null, _profiles: SSHProfile[]) { /* track */ }

    // 在终端标题栏切换 SSH / 本地：保留原位置，关闭旧终端并以新模式重建
    function onSwitchSsh(terminalId: string, profileId: string | null) {
      const entry = terminals.value.find((term) => term.id === terminalId);
      if (!entry) return;
      // 保存原位置/层级，重建后还原
      const { x, y, w, h, zIndex } = entry;
      // 关闭旧终端（触发 PTY 清理）
      terminals.value = terminals.value.filter((term) => term.id !== terminalId);
      if (profileId) {
        const profile = sshProfiles.value.find((p) => p.id === profileId);
        if (profile) {
          createSshTerminal(profile, { x, y, w, h, zIndex });
        }
        return;
      }
      // profileId 为空：创建本地终端，保留原位置
      createTerminal(x, y, w, h, { mode: 'local' }, zIndex);
    }

    function onThemeChange(theme: string) {
      const migrated = migrateThemeId(theme);
      setCraftTheme(migrated);
    }

    function onCommandsChanged() { /* reload intel */ }

    async function onSendCommand(command: string) {
      if (!activeTerminalId.value) return;
      activeView.value = 'canvas';
      await invoke('write_pty', {
        sessionId: activeTerminalId.value,
        data: command + '\n',
      });
    }

    function getSnapTargets(excludeId?: string): SnapTarget[] {
      return terminals.value
        .filter((term) => term.id !== excludeId)
        .map((term) => ({ id: term.id, ...getUnifiedRect(term) }));
    }

    async function persistWorkspace() {
      try {
        const canvasState = canvas?.getState() || { panX: 0, panY: 0, zoom: 1 };
        const states = terminals.value.map((term) => ({
          x: term.x, y: term.y, w: term.w, h: term.h,
          title: '', cwd: '',
          minimized: false, maximized: false,
          launchOptions: term.launchOptions,
        }));
        await invoke('save_workspace_state', {
          state: {
            terminals: states,
            canvas: canvasState,
            pendingSshProfileId: '',
            activeTerminalId: activeTerminalId.value,
          },
        });
      } catch { /* ignore */ }
    }

    async function restoreWorkspace() {
      try {
        const saved = await invoke<WorkspaceState>('load_workspace_state');
        if (canvas) {
          canvas.setState(saved.canvas);
        }
        const valid = saved.terminals
          .filter((session) => !session.minimized && (session.w > 200 || session.h > 100 || session.launchOptions?.mode === 'ssh'))
          .map((session) => ({
            ...session,
            x: Math.max(-500, Math.min(3000, session.x)),
            y: Math.max(-100, Math.min(2000, session.y)),
            w: Math.max(200, Math.min(2000, session.w)),
            h: Math.max(100, Math.min(1200, session.h)),
          }));
        for (const session of valid) {
          createTerminal(session.x, session.y, session.w, session.h, session.launchOptions || { mode: 'local' }, undefined, false);
        }
        if (valid.length > 0) showHint.value = false;

        await nextTick();
        if (canvas && valid.length > 0) {
          const viewport = viewportRef.value;
          if (viewport) {
            const canvasState = canvas.getState();
            const zoom = canvasState.zoom || 1;
            const vpW = viewport.clientWidth;
            const vpH = viewport.clientHeight;
            const anyVisible = valid.some((session) => {
              const screenX = session.x * zoom + canvasState.panX;
              const screenY = session.y * zoom + canvasState.panY;
              const screenW = session.w * zoom;
              const screenH = session.h * zoom;
              return screenX + screenW > 0 && screenX < vpW &&
                     screenY + screenH > 0 && screenY < vpH;
            });
            if (!anyVisible) {
              const first = valid[0];
              canvas.setState({ panX: -first.x * zoom + 50, panY: -first.y * zoom + 50, zoom });
            }
          }
        }
      } catch { /* no saved state */ }
    }

    function setupResizeHandles() {
      const handles = document.querySelectorAll<HTMLElement>('[data-resize-direction]');
      handles.forEach((handle) => {
        handle.addEventListener('mousedown', (event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          const direction = handle.dataset.resizeDirection;
          if (!direction) return;
          // @ts-expect-error Tauri window resize
          void appWin.startResizeDragging(direction);
        });
      });
    }

    function setupTitlebarDrag() {
      const titlebar = document.getElementById('app-titlebar');
      if (!titlebar) return;
      titlebar.addEventListener('mousedown', (event) => {
        if ((event.target as HTMLElement).closest('.app-window-controls')) return;
        if (event.button !== 0) return;
        void appWin.startDragging();
      });
      titlebar.addEventListener('dblclick', (event) => {
        if ((event.target as HTMLElement).closest('.app-window-controls')) return;
        void appWin.toggleMaximize();
      });
    }

    function setupCloseHandler() {
      appWin.onCloseRequested(async (event) => {
        event.preventDefault();
        try { await persistWorkspace(); } catch { /* ignore */ }
        await appWin.destroy();
      });
    }

    function initCanvas() {
      const viewport = viewportRef.value;
      const canvasEl = canvasRef.value;
      const selectionRect = document.getElementById('selection-rect');
      if (!viewport || !canvasEl || !selectionRect) return;

      canvas = new Canvas(viewport, canvasEl, selectionRect as HTMLDivElement);
      canvas.getSnapTargets = getSnapTargets;
      // 画布缩放变化时同步响应式 zoom，供终端拖拽/缩放做坐标换算
      canvas.onViewChange = (state) => { canvasZoom.value = state.zoom; };
      canvas.getViewportSize = () => {
        const vp = viewportRef.value;
        if (!vp) return { w: 0, h: 0 };
        return { w: vp.clientWidth, h: vp.clientHeight };
      };
      canvas.onTerminalCreate = (x, y, w, h) => {
        // 框选坐标已经按当前 pan/zoom 反算为画布坐标，创建后不能再次改变视口，
        // 否则终端的屏幕尺寸和落点会偏离用户刚刚画出的矩形。
        createTerminal(x, y, w, h, { mode: 'local' }, undefined, false);
      };
      canvas.onCanvasContextMenu = (cvs, clientX, clientY) => {
        const items: Array<{ label: string; action: () => void }> = [];
        if (terminals.value.length > 0) {
          items.push({
            label: t('canvas.alignAll'),
            action: () => { cvs.resetView(); },
          });
        }
        items.push({
          label: t('canvas.newTerminal'),
          action: () => { createTerminal(80, 80, 700, 450); },
        });
        cvs.showCanvasMenu(clientX, clientY, items);
      };
    }

    function setupKeyboardShortcuts() {
      document.addEventListener('keydown', (event) => {
        // ⌘K / Ctrl+K：打开命令面板
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
          event.preventDefault();
          event.stopPropagation();
          onCmdk();
          return;
        }
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') && !activeEl.classList.contains('xterm-helper-textarea')) return;
        if (!shortcutManager) return;

        if (shortcutManager.matches('terminal.duplicate', event)) {
          if (!activeTerminalId.value) return;
          const entry = terminals.value.find((term) => term.id === activeTerminalId.value);
          if (!entry) return;
          event.preventDefault();
          event.stopPropagation();
          createTerminal(entry.x + 30, entry.y + 30, entry.w, entry.h, { ...entry.launchOptions });
          showMessage(t('terminal.copied'), 'success');
          return;
        }

        // Delete 键：关闭当前激活的终端
        if (event.key === 'Delete' && activeTerminalId.value) {
          event.preventDefault();
          event.stopPropagation();
          onTerminalClose(activeTerminalId.value);
          return;
        }

        for (const [shortcutKey, viewId] of Object.entries(SHORTCUT_VIEW_MAP)) {
          if (shortcutManager.matches(shortcutKey, event)) {
            event.preventDefault();
            onViewChange(viewId);
            return;
          }
        }
      }, true);
    }

    let unsubLang: (() => void) | null = null;

    onMounted(async () => {
      Perf.mark('app.startup');
      setupResizeHandles();
      setupTitlebarDrag();
      setupCloseHandler();

      try {
        const settings = await invoke<{ theme: string; language: string; restoreSession: boolean }>('get_settings');
        setCraftTheme(migrateThemeId(settings.theme));
      } catch { /* ignore */ }

      shortcutManager = new ShortcutManager();
      await shortcutManager.init();
      setupDesktopDrawShortcut(shortcutManager);
      setupKeyboardShortcuts();

      await nextTick();
      initCanvas();
      await restoreWorkspace();

      unsubLang = onLangChange(() => { /* computed auto-update via langTick in Dock */ });
      Perf.end('app.startup');

      // FileManager 预览请求：复用 PreviewPanel
      window.addEventListener('fm-open-preview', ((e: CustomEvent) => {
        currentFileStrategy.value = null; // FileManager 仅处理本地文件
        previewPath.value = e.detail as string;
      }) as EventListener);
    });

    onUnmounted(() => {
      canvas?.destroy();
      canvas = null;
      unsubLang?.();
      window.removeEventListener('fm-open-preview', (() => {}) as EventListener);
    });

    // 把画布吸附能力注入到每个终端窗口，拖拽/缩放时触发对齐辅助线
    const snapRectFn = (rect: Rect, options: SnapOptions): Rect => (canvas ? canvas.snapRect(rect, options) : rect);
    const clearGuidesFn = (): void => { canvas?.clearGuides(); };

    // ===== ⌘K 命令面板 =====
    const cmdkOpen = ref(false);
    const cmdkQuery = ref('');
    const cmdkIndex = ref(0);
    const cmdkInputRef = ref<HTMLInputElement | null>(null);
    const cmdkPlaceholder = '搜索命令 / 主机 / 文件…';

    /** 命令面板的单条搜索结果 */
    interface CmdkItem {
      id: string;
      title: string;
      desc: string;
      type: string;
      icon: string;
      color: string;
      action: () => void;
    }

    /** 汇总各来源数据，按关键词过滤 */
    const cmdkResults = computed<CmdkItem[]>(() => {
      const q = cmdkQuery.value.trim().toLowerCase();
      const items: CmdkItem[] = [];

      // 视图导航项
      const viewDefs: { id: ViewId; label: string; icon: string }[] = [
        { id: 'canvas', label: '终端画布', icon: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>' },
        { id: 'commands', label: '命令库', icon: '<path d="M4 4h6v16H4z"/><path d="M10 4h4v16h-4z"/><path d="M14 4l6 1-3 15-6-1z"/>' },
        { id: 'market', label: '命令市场', icon: '<path d="M3 9l1.5-5h15L21 9"/><path d="M3 9v11h18V9"/>' },
        { id: 'history', label: '历史命令', icon: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>' },
        { id: 'ssh', label: 'SSH 连接', icon: '<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>' },
        { id: 'shortcuts', label: '快捷键', icon: '<rect x="3" y="6" width="18" height="12" rx="2"/>' },
        { id: 'settings', label: '设置', icon: '<circle cx="12" cy="12" r="3"/>' },
      ];
      for (const v of viewDefs) {
        if (!q || v.label.toLowerCase().includes(q)) {
          items.push({ id: `view-${v.id}`, title: v.label, desc: '切换到' + v.label, type: '视图', icon: v.icon, color: 'var(--accent)', action: () => onViewChange(v.id) });
        }
      }
      // 文件树切换
      if (!q || '文件树文件管理files'.toLowerCase().includes(q)) {
        items.push({ id: 'toggle-files', title: '文件管理', desc: '打开/关闭文件树面板', type: '面板', icon: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', color: 'var(--yellow)', action: () => onViewChange('files') });
      }

      // 过滤结果
      const filtered = q ? items.filter((i) => i.title.toLowerCase().includes(q) || i.desc.toLowerCase().includes(q)) : items;
      return filtered.slice(0, 12);
    });

    /** 打开命令面板，聚焦输入框 */
    function onCmdk() {
      cmdkOpen.value = true;
      cmdkQuery.value = '';
      cmdkIndex.value = 0;
      void nextTick(() => cmdkInputRef.value?.focus());
    }

    /** 回车确认：执行选中的 action */
    function onCmdkEnter() {
      const item = cmdkResults.value[cmdkIndex.value];
      if (item) {
        cmdkOpen.value = false;
        item.action();
      }
    }

    return {
      settingsRef, sshPanelRef, marketRef,
      viewportRef, canvasRef,
      activeView, previewPath, showHint, hintLabel, canvasHintLabel, newTerminalLabel, filesPlaceholderLabel,
      terminals, activeTerminalId, activeTerminalCwd, setTerminalRef,
      onMinimize, onMaximize, onClose, onViewChange,
      onToolbarNewTerminal, onToolbarResetView, openTerminalModal,
      terminalModalOpen,
      onTerminalActivate, onTerminalClose,
      onTerminalInteractionStart, onTerminalInteractionEnd,
      onCommandExecuted, onOpenTerminalAt, onTerminalPanelPreview, onSshConnect,
      onSshProfilesChange, onSshSelectionChange, onThemeChange,
      onCommandsChanged, onSendCommand, onSwitchSsh,
      onToggleFilePanel, onPanelCdTo, onTerminalRectChange, onTerminalCwdChange, terminalCwds,
      filePanelTerminalId, filePanelTerminal, filePanelStyle, filePanelWidth, onPanelResizeStart,
      unifiedSshMenuTerminalId,
      getUnifiedWindowStyle, getUnifiedTitlebarStyle, getUnifiedWindowClasses,
      onUnifiedPointerEnter, onUnifiedPointerLeave,
      getUnifiedTitle, getUnifiedCwd, isUnifiedSsh, getUnifiedStatusPulse, getUnifiedStatusText,
      onUnifiedTitleDrag, onUnifiedClose, onUnifiedMinimize, onUnifiedMaximize,
      toggleUnifiedSshMenu, onUnifiedSwitchSsh,
      snapRectFn, clearGuidesFn, canvasZoom, sshProfiles, currentFileStrategy,
      // ⌘K 命令面板
      cmdkOpen, cmdkQuery, cmdkIndex, cmdkInputRef, cmdkPlaceholder, cmdkResults, onCmdk, onCmdkEnter,
    };
  },
});
