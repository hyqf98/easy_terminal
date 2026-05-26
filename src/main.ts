import { Canvas } from './canvas';
import { TerminalManager } from './terminal-manager';
import { Sidebar } from './sidebar';
import { FileTree } from './file-tree';
import { Settings } from './settings';
import { CommandConfigPanel } from './command-config';
import { CommandMarketPanel } from './command-market';
import { CommandSuggest } from './command-suggest';
import { CommandIntelligence } from './command-intelligence';
import { HistoryPanel } from './history-panel';
import { MappingPanel } from './mapping-panel';
import { SSHPanel } from './ssh-panel';
import { AppUpdater } from './app-update';
import { ShortcutManager } from './shortcut-manager';
import { ShortcutPanel } from './shortcut-panel';
import { initDesktopDrawMode } from './desktop-draw';
import { initDetachedTerminalMode } from './detached-terminal';
import { setupDesktopDrawShortcut } from './global-shortcut';
import { t, onLangChange } from './i18n';
import { Perf } from './perf';
import { defaultWindowIcon } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { WorkspaceState } from './types';
import './styles.css';

function showToast(message: string) {
  const existing = document.querySelector('.toast-notification');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast-notification';
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

window.addEventListener('DOMContentLoaded', async () => {
  Perf.autoInit();
  Perf.mark('app.startup');
  const mode = new URLSearchParams(window.location.search).get('mode');
  if (mode === 'desktop-draw') {
    await initDesktopDrawMode();
    return;
  }
  if (mode === 'detached-terminal') {
    await initDetachedTerminalMode();
    return;
  }

  const appBody = document.getElementById('app-body')! as HTMLDivElement;
  const viewport = document.getElementById('app-viewport')! as HTMLDivElement;
  const canvasEl = document.getElementById('canvas')! as HTMLDivElement;
  const selectionRect = document.getElementById('selection-rect')! as HTMLDivElement;
  const sidebarContainer = document.getElementById('sidebar-container')! as HTMLDivElement;
  const panelArea = document.getElementById('panel-area')! as HTMLDivElement;
  const panelFiles = document.getElementById('panel-files')! as HTMLDivElement;
  const panelSettings = document.getElementById('panel-settings')! as HTMLDivElement;
  const panelCommands = document.getElementById('panel-commands')! as HTMLDivElement;
  const panelMarket = document.getElementById('panel-market')! as HTMLDivElement;
  const panelHistory = document.getElementById('panel-history')! as HTMLDivElement;
  const panelMappings = document.getElementById('panel-mappings')! as HTMLDivElement;
  const panelSsh = document.getElementById('panel-ssh')! as HTMLDivElement;
  const panelShortcuts = document.getElementById('panel-shortcuts')! as HTMLDivElement;
  const titlebar = document.getElementById('app-titlebar')! as HTMLDivElement;
  const resizeHandles = Array.from(document.querySelectorAll<HTMLElement>('[data-resize-direction]'));
  const appWin = getCurrentWindow();
  let hint: HTMLDivElement | null = null;
  let hintDismissed = false;

  try {
    const icon = await defaultWindowIcon();
    if (icon) {
      await appWin.setIcon(icon);
    }
  } catch (error) {
    console.error('window icon init failed', error);
  }

  const intelligence = new CommandIntelligence();
  const commandSuggest = new CommandSuggest(intelligence);
  Perf.mark('app.commandSuggestInit');
  await commandSuggest.init();
  Perf.end('app.commandSuggestInit');
  const updater = new AppUpdater();
  Perf.mark('app.shortcutManagerInit');
  const shortcutManager = new ShortcutManager();
  await shortcutManager.init();
  Perf.end('app.shortcutManagerInit');
  setupDesktopDrawShortcut(shortcutManager);
  let announcedUpdateVersion = '';

  // Canvas
  const canvas = new Canvas(viewport, canvasEl, selectionRect);
  Perf.mark('app.canvasCreated');

  // Terminal Manager
  const terminalManager = new TerminalManager(canvasEl, canvas, commandSuggest, shortcutManager, async (command, cwd) => {
    await intelligence.recordHistory(command, cwd);
  });
  const isDevRuntime = /localhost|127\.0\.0\.1/.test(window.location.hostname);
  if (isDevRuntime) {
    (window as Window & {
      __EASY_TERMINAL_DEBUG__?: {
        setFocusedInput: (value: string) => Promise<boolean>;
        handleFocusedSuggestionKey: (key: string) => Promise<boolean>;
        getFocusedSuggestionState: () => unknown;
        refreshFocusedSuggestions: () => Promise<unknown>;
        submitFocusedInput: () => Promise<boolean>;
        searchSuggestions: (value: string) => Promise<unknown>;
      };
    }).__EASY_TERMINAL_DEBUG__ = {
      setFocusedInput: (value: string) => terminalManager.debugSetFocusedInput(value),
      handleFocusedSuggestionKey: (key: string) => terminalManager.debugHandleFocusedSuggestionKey(key),
      getFocusedSuggestionState: () => terminalManager.getFocusedSuggestionState(),
      refreshFocusedSuggestions: () => terminalManager.debugRefreshFocusedSuggestions(),
      submitFocusedInput: () => terminalManager.debugSubmitFocusedInput(),
      searchSuggestions: (value: string) => intelligence.searchSuggestions(value),
    };
  }
  canvas.getSnapTargets = (excludeId) => terminalManager.getSnapTargets(excludeId);
  canvas.onViewChange = () => {
    terminalManager.handleCanvasViewChange();
  };
  canvas.onCanvasContextMenu = (cvs, clientX, clientY) => {
    const items: Array<{ label: string; action: () => void }> = [];
    if (terminalManager.getTerminalCount() > 0) {
      items.push({
        label: t('canvas.alignAll'),
        action: () => {
          const rect = viewport.getBoundingClientRect();
          terminalManager.alignAll({ w: rect.width, h: rect.height });
          canvas.resetView();
        },
      });
    }
    items.push({
      label: t('canvas.newTerminal'),
      action: () => {
        terminalManager.createTerminal(80, 80, 700, 450);
      },
    });
    cvs.showCanvasMenu(clientX, clientY, items);
  };

  // Sidebar (three-column layout)
  const sidebar = new Sidebar(sidebarContainer, panelArea);

  // Panel resize handle
  const panelResizeHandle = document.createElement('div');
  panelResizeHandle.id = 'panel-area-resize-handle';
  panelArea.appendChild(panelResizeHandle);
  let panelResizing = false;
  panelResizeHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    panelResizing = true;
    panelResizeHandle.classList.add('active');
    panelArea.classList.add('resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const startX = e.clientX;
    const startWidth = panelArea.getBoundingClientRect().width;
    const onMove = (ev: MouseEvent) => {
      if (!panelResizing) return;
      const newWidth = Math.max(200, Math.min(startWidth + (ev.clientX - startX), window.innerWidth - 200));
      panelArea.style.width = newWidth + 'px';
      panelArea.style.flex = '0 0 ' + newWidth + 'px';
    };
    const onUp = () => {
      panelResizing = false;
      panelResizeHandle.classList.remove('active');
      panelArea.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  const updateCanvasHintVisibility = () => {
    if (!hint) return;
    const layout = appBody.dataset.layout || 'canvas';
    hint.classList.toggle('hidden', layout !== 'canvas' || hintDismissed);
  };
  const updateLayoutMode = (tab: string | null) => {
    appBody.dataset.layout = tab === 'files' || tab === 'ssh' ? 'files' : tab ? 'workspace' : 'canvas';
    updateCanvasHintVisibility();
  };
  sidebar.onTabChange = updateLayoutMode;
  updateLayoutMode(sidebar.getActiveTab() || null);

  // File Tree Panel
  const fileTree = new FileTree(panelFiles);
  fileTree.onOpenTerminal = (dirPath: string) => {
    terminalManager.createTerminalAt(50, 50, 700, 450, dirPath);
  };
  terminalManager.onActiveTerminalChange = (context) => {
    void fileTree.syncToTerminal(context);
  };
  terminalManager.onTerminalClosed = () => {
    void persistWorkspace();
  };

  // Settings Panel
  const settings = new Settings(panelSettings, updater);
  settings.onThemeChange = (theme: string) => {
    terminalManager.setThemeAll(theme);
  };
  await settings.ready;
  updater.onChange((state) => {
    if (state.status === 'available' && state.latestVersion && state.latestVersion !== announcedUpdateVersion) {
      announcedUpdateVersion = state.latestVersion;
      showToast(t('settings.updateAvailable', state.latestVersion));
    }
  });
  await updater.init(settings.getAutoCheckUpdate());

  // Command Config Panel
  new CommandConfigPanel(panelCommands, async () => {
    await intelligence.reloadCommands();
  });

  const marketPanel = new CommandMarketPanel(panelMarket, async () => {
    await intelligence.reloadCommands();
  });

  const origTabChange = sidebar.onTabChange;
  let marketInitialized = false;
  sidebar.onTabChange = (tab: string | null) => {
    origTabChange?.call(sidebar, tab);
    if (tab === 'market' && !marketInitialized) {
      marketInitialized = true;
      void marketPanel.init();
    }
  };

  new HistoryPanel(panelHistory, intelligence, async (command: string) => {
    const sent = await terminalManager.sendCommandToActiveTerminal(command);
    return sent;
  });

  const mappingPanel = new MappingPanel(panelMappings, intelligence);
  terminalManager.onAddMappingFromSelection = (text) => {
    mappingPanel.openCreate({
      trigger: text.slice(0, 24),
      command: text,
      description: t('terminal.selectionToMapping'),
      hint: text,
    });
    sidebar.openTab('mappings');
  };

  const sshPanel = new SSHPanel(panelSsh);
  sshPanel.onProfilesChange = (profiles) => {
    terminalManager.setSshProfiles(profiles);
    fileTree.setSshProfiles(profiles);
  };
  sshPanel.onSelectionChange = (profile) => {
    terminalManager.setPendingSshProfile(profile);
  };

  new ShortcutPanel(panelShortcuts, shortcutManager);
  sshPanel.onConnect = async (profile, profiles) => {
    terminalManager.setSshProfiles(profiles);
    fileTree.setSshProfiles(profiles);
    hintDismissed = true;
    updateCanvasHintVisibility();
    await terminalManager.createSshTerminal(profile);
  };

  const persistWorkspace = async () => {
    if (!settings.getRestoreSession()) {
      await invoke('save_workspace_state', {
        state: {
          terminals: [],
          canvas: canvas.getState(),
          pendingSshProfileId: '',
          activeTerminalId: '',
        },
      });
      return;
    }

    await invoke('save_workspace_state', {
      state: {
        terminals: terminalManager.getTerminalStates(),
        canvas: canvas.getState(),
        pendingSshProfileId: terminalManager.getPendingSshProfile()?.id || '',
        activeTerminalId: terminalManager.getActiveId() || '',
      },
    });
  };

  // Hint
  hint = document.createElement('div');
  hint.className = 'canvas-hint';
  hint.textContent = t('hint.canvas');
  document.body.appendChild(hint);
  updateCanvasHintVisibility();

  // Update hint on language change
  onLangChange(() => {
    if (!hint) return;
    hint.textContent = t('hint.canvas');
    updateCanvasHintVisibility();
  });

  // Hide hint after first terminal is created
  canvas.onTerminalCreate = (x, y, w, h) => {
    hintDismissed = true;
    updateCanvasHintVisibility();
    terminalManager.createTerminal(x, y, w, h);
  };

  Perf.mark('app.sshPanelReady');
  await sshPanel.ready;
  Perf.end('app.sshPanelReady');

  // Restore workspace from previous session
  if (settings.getRestoreSession()) {
    Perf.mark('app.restoreSession');
    try {
      const saved = await invoke<WorkspaceState>('load_workspace_state');
      canvas.setState(saved.canvas);
      if (saved.pendingSshProfileId) {
        sshPanel.setActiveProfile(saved.pendingSshProfileId);
      }
      const valid = saved.terminals.filter((s) => {
        if (s.minimized) return false;
        if (s.w <= 200 && s.h <= 100 && s.launchOptions?.mode !== 'ssh') return false;
        return true;
      });
      if (valid.length > 0) {
        hintDismissed = true;
        updateCanvasHintVisibility();
        for (const session of valid) {
          terminalManager.restoreTerminalSession(session);
        }
      }
      Perf.end('app.restoreSession');
    } catch (e) {
      // No saved state or error - ignore
    }
  }

  // Save terminal state before window closes (only if restore session is enabled)
  appWin.onCloseRequested(async (event) => {
    event.preventDefault();
    try {
      await persistWorkspace();
    } catch {
      // Ignore save errors on close
    }
    await appWin.destroy();
  });

  // App window controls — use mousedown to avoid WebKit backdrop-filter compositing issues
  // where click events may never fire on buttons inside a backdrop-filter container
  const bindControl = (id: string, fn: () => void) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      e.preventDefault();
      fn();
    });
  };
  bindControl('app-minimize', () => {
    void appWin.minimize().catch((error) => {
      console.error('window minimize failed', error);
    });
  });
  bindControl('app-maximize', () => {
    void appWin.toggleMaximize().catch((error) => {
      console.error('window maximize toggle failed', error);
    });
  });
  bindControl('app-close', () => {
    void (async () => {
      try {
        await persistWorkspace();
      } catch {
        // Ignore save errors on close
      }
      // Use destroy() to force-close (bypasses onCloseRequested lifecycle)
      await appWin.destroy().catch((error) => {
        console.error('window destroy failed, falling back to close', error);
        return appWin.close().catch((e) => console.error('window close also failed', e));
      });
    })();
  });

  const startWindowDrag = async (event: MouseEvent) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('.app-window-controls')) return;
    try {
      await appWin.startDragging();
    } catch (error) {
      console.error('window drag failed', error);
    }
  };

  titlebar.addEventListener('mousedown', (event) => {
    void startWindowDrag(event);
  });
  titlebar.addEventListener('dblclick', (event) => {
    if ((event.target as HTMLElement).closest('.app-window-controls')) return;
    void appWin.toggleMaximize().catch((error) => {
      console.error('titlebar maximize toggle failed', error);
    });
  });

  resizeHandles.forEach((handle) => {
    handle.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const direction = handle.dataset.resizeDirection;
      if (!direction) return;
      void appWin.startResizeDragging(direction as Parameters<typeof appWin.startResizeDragging>[0]).catch((error) => {
        console.error('window resize drag failed', error);
      });
    });
  });

  // Track mouse position on canvas for Ctrl+V terminal placement
  viewport.addEventListener('mousemove', (e) => {
    const rect = viewport.getBoundingClientRect();
    const { x: panX, y: panY } = canvas.getPan();
    const zoom = canvas.getZoom();
    const cx = (e.clientX - rect.left - panX) / zoom;
    const cy = (e.clientY - rect.top - panY) / zoom;
    terminalManager.setCanvasMousePos(cx, cy);
  });

  // Click on empty canvas area → blur active terminal
  viewport.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).closest('.terminal-window')) return;
    terminalManager.blurActive();
  });
  viewport.addEventListener('wheel', (e) => {
    if ((e.target as HTMLElement).closest('.terminal-window')) return;
    terminalManager.hideTransientUi();
  }, { passive: true });

  // Toast notification when terminal is copied via Ctrl+C
  terminalManager.onTerminalCopied = () => {
    showToast(t('terminal.copied'));
  };
  terminalManager.onTextCopied = () => {
    showToast(t('terminal.textCopied'));
  };

  // Global terminal duplicate shortcuts (Ctrl/Cmd+D and Ctrl/Cmd+Shift+D)
  document.addEventListener('keydown', (e) => {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') && !activeEl.classList.contains('xterm-helper-textarea')) return;
    if (shortcutManager.matches('terminal.duplicate', e)) {
      if (!terminalManager.getActiveId()) return;
      const copied = terminalManager.copyActiveTerminal();
      if (!copied) return;
      e.preventDefault();
      e.stopPropagation();
      terminalManager.onTerminalCopied?.();
      return;
    }
    if (shortcutManager.matches('terminal.paste', e)) {
      if (!terminalManager.hasCopiedTerminal()) return;

      e.preventDefault();
      e.stopPropagation();
      const pos = terminalManager.getPastePosition();
      void terminalManager.pasteTerminal(pos.x, pos.y);
      return;
    }
    if (shortcutManager.matches('sidebar.files', e)) { e.preventDefault(); sidebar.openTab('files'); return; }
    if (shortcutManager.matches('sidebar.commands', e)) { e.preventDefault(); sidebar.openTab('commands'); return; }
    if (shortcutManager.matches('sidebar.history', e)) { e.preventDefault(); sidebar.openTab('history'); return; }
    if (shortcutManager.matches('sidebar.mappings', e)) { e.preventDefault(); sidebar.openTab('mappings'); return; }
    if (shortcutManager.matches('sidebar.ssh', e)) { e.preventDefault(); sidebar.openTab('ssh'); return; }
    if (shortcutManager.matches('sidebar.shortcuts', e)) { e.preventDefault(); sidebar.openTab('shortcuts'); return; }
    if (shortcutManager.matches('sidebar.settings', e)) { e.preventDefault(); sidebar.openTab('settings'); return; }
  }, true); // capture phase to intercept before xterm
  Perf.end('app.startup');
  Perf.printReport();
});
