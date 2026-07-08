import { defineComponent, ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { t, onLangChange } from '../../i18n';
import { useCraftTheme, migrateThemeId } from '../../composables/useCraftTheme';
import { showMessage, useAppMessage } from '../../composables/useAppMessage';
import { useAppDialog } from '../../composables/useAppDialog';
import Titlebar from '../titlebar/Titlebar.vue';
import Dock from '../../components/Dock.vue';
import CanvasStatus from '../canvas/CanvasStatus.vue';
import CanvasMinimap from '../canvas/CanvasMinimap.vue';
import TerminalModal from '../../components/modals/TerminalModal.vue';
import FileTree from '../filetree/FileTree.vue';
import CommandConfigPanel from '../command/CommandConfigPanel.vue';
import CommandMarketPanel from '../command/CommandMarketPanel.vue';
import HistoryPanel from '../history/HistoryPanel.vue';
import MappingPanel from '../mapping/MappingPanel.vue';
import SshPanel from '../ssh/SshPanel.vue';
import ShortcutPanel from '../shortcut/ShortcutPanel.vue';
import SettingsPanel from '../settings/SettingsPanel.vue';
import TerminalWindow from '../terminal/TerminalWindow.vue';
import { Canvas } from '../canvas/canvas';
import { ShortcutManager } from '../shortcut/shortcutManager';
import { setupDesktopDrawShortcut } from '../shortcut/globalShortcut';
import type { SSHProfile, TerminalLaunchOptions, WorkspaceState, SnapTarget, Rect, SnapOptions } from '../../types';
import { Perf } from '../../utils/perf';

type ViewId = 'canvas' | 'files' | 'commands' | 'market' | 'history' | 'mappings' | 'ssh' | 'shortcuts' | 'settings';

interface TerminalEntry {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  zIndex: number;
  launchOptions: TerminalLaunchOptions;
}

// Dock 视图与 sidebar 快捷键目标的映射
const SHORTCUT_VIEW_MAP: Record<string, ViewId> = {
  'sidebar.files': 'files',
  'sidebar.commands': 'commands',
  'sidebar.history': 'history',
  'sidebar.mappings': 'mappings',
  'sidebar.ssh': 'ssh',
  'sidebar.shortcuts': 'shortcuts',
  'sidebar.settings': 'settings',
};

let nextTerminalId = 1;

export default defineComponent({
  name: 'AppLayout',
  components: {
    Titlebar, Dock, CanvasStatus, CanvasMinimap, TerminalModal,
    FileTree, CommandConfigPanel, CommandMarketPanel,
    HistoryPanel, MappingPanel, SshPanel, ShortcutPanel, SettingsPanel, TerminalWindow,
  },
  setup() {
    useAppMessage();
    useAppDialog();
    const { setTheme: setCraftTheme } = useCraftTheme();

    const fileTreeRef = ref<InstanceType<typeof FileTree> | null>(null);
    const settingsRef = ref<InstanceType<typeof SettingsPanel> | null>(null);
    const sshPanelRef = ref<InstanceType<typeof SshPanel> | null>(null);
    const marketRef = ref<InstanceType<typeof CommandMarketPanel> | null>(null);
    const viewportRef = ref<HTMLDivElement | null>(null);
    const canvasRef = ref<HTMLDivElement | null>(null);

    const activeView = ref<ViewId>('canvas');
    const showHint = ref(true);
    const terminalModalOpen = ref(false);
    const hintLabel = computed(() => t('hint.canvas'));
    const newTerminalLabel = computed(() => t('canvas.newTerminal'));

    const terminals = ref<TerminalEntry[]>([]);
    const activeTerminalId = ref('');
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

    function createTerminal(x = 80, y = 80, w = 700, h = 450, options: TerminalLaunchOptions = {}) {
      const id = `term-${nextTerminalId++}`;
      const entry: TerminalEntry = {
        id, x, y, w, h,
        zIndex: zCounter.value++,
        launchOptions: options,
      };
      terminals.value.push(entry);
      activeTerminalId.value = id;
      showHint.value = false;
      return id;
    }

    function onTerminalActivate(id: string) {
      activeTerminalId.value = id;
      const entry = terminals.value.find((term) => term.id === id);
      if (entry) {
        entry.zIndex = zCounter.value++;
        terminals.value = [...terminals.value];
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

    function onTerminalInteractionStart(_id: string) { /* freeze optional */ }
    function onTerminalInteractionEnd(_id: string) { /* unfreeze optional */ }

    function onCommandExecuted(command: string, cwd: string) {
      const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        command,
        cwd,
        timestamp: Date.now(),
        count: 1,
        variants: [],
      };
      void invoke('record_command_history', { entry });
    }

    function onOpenTerminalAt(dirPath: string) {
      activeView.value = 'canvas';
      createTerminal(50, 50, 700, 450, { cwd: dirPath });
    }

    async function onSshConnect(profile: SSHProfile, _profiles: SSHProfile[]) {
      const passwordSeq = profile.authType === 'password' && profile.password
        ? [`${profile.password}\n`] : undefined;
      const startupCmd = `ssh ${profile.user}@${profile.host} -p ${profile.port}`;
      activeView.value = 'canvas';
      createTerminal(80, 80, 700, 450, {
        mode: 'ssh',
        profileName: profile.name,
        profileId: profile.id,
        cwd: undefined,
        startupCommand: startupCmd,
        passwordSequence: passwordSeq,
      });
    }

    function onSshProfilesChange(profiles: SSHProfile[]) {
      // @ts-expect-error exposed component method
      fileTreeRef.value?.setSshProfiles?.(profiles);
    }

    function onSshSelectionChange(_profile: SSHProfile | null, _profiles: SSHProfile[]) { /* track */ }

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
        .map((term) => ({ id: term.id, x: term.x, y: term.y, w: term.w, h: term.h }));
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
          createTerminal(session.x, session.y, session.w, session.h, session.launchOptions || { mode: 'local' });
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
        createTerminal(x, y, w, h);
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
    });

    onUnmounted(() => {
      canvas?.destroy();
      canvas = null;
      unsubLang?.();
    });

    // 把画布吸附能力注入到每个终端窗口，拖拽/缩放时触发对齐辅助线
    const snapRectFn = (rect: Rect, options: SnapOptions): Rect => (canvas ? canvas.snapRect(rect, options) : rect);
    const clearGuidesFn = (): void => { canvas?.clearGuides(); };

    return {
      fileTreeRef, settingsRef, sshPanelRef, marketRef,
      viewportRef, canvasRef,
      activeView, showHint, hintLabel, newTerminalLabel,
      terminals, activeTerminalId,
      onMinimize, onMaximize, onClose, onViewChange,
      onToolbarNewTerminal, onToolbarResetView, openTerminalModal,
      terminalModalOpen,
      onTerminalActivate, onTerminalClose,
      onTerminalInteractionStart, onTerminalInteractionEnd,
      onCommandExecuted, onOpenTerminalAt, onSshConnect,
      onSshProfilesChange, onSshSelectionChange, onThemeChange,
      onCommandsChanged, onSendCommand,
      snapRectFn, clearGuidesFn, canvasZoom,
    };
  },
});
