import { Canvas } from './canvas';
import { TerminalManager } from './terminal-manager';
import { Sidebar } from './sidebar';
import { FileTree } from './file-tree';
import { Settings } from './settings';
import { CommandConfigPanel } from './command-config';
import { CommandSuggest } from './command-suggest';
import { CommandIntelligence } from './command-intelligence';
import { HistoryPanel } from './history-panel';
import { MappingPanel } from './mapping-panel';
import { SSHPanel } from './ssh-panel';
import { AppUpdater } from './app-update';
import { t, onLangChange } from './i18n';
import { invoke } from '@tauri-apps/api/core';
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
  const viewport = document.getElementById('app-viewport')! as HTMLDivElement;
  const canvasEl = document.getElementById('canvas')! as HTMLDivElement;
  const selectionRect = document.getElementById('selection-rect')! as HTMLDivElement;
  const sidebarContainer = document.getElementById('sidebar-container')! as HTMLDivElement;
  const panelArea = document.getElementById('panel-area')! as HTMLDivElement;
  const panelFiles = document.getElementById('panel-files')! as HTMLDivElement;
  const panelSettings = document.getElementById('panel-settings')! as HTMLDivElement;
  const panelCommands = document.getElementById('panel-commands')! as HTMLDivElement;
  const panelHistory = document.getElementById('panel-history')! as HTMLDivElement;
  const panelMappings = document.getElementById('panel-mappings')! as HTMLDivElement;
  const panelSsh = document.getElementById('panel-ssh')! as HTMLDivElement;

  const intelligence = new CommandIntelligence();
  const commandSuggest = new CommandSuggest(intelligence);
  await commandSuggest.init();
  const updater = new AppUpdater();
  let announcedUpdateVersion = '';

  // Canvas
  const canvas = new Canvas(viewport, canvasEl, selectionRect);

  // Terminal Manager
  const terminalManager = new TerminalManager(canvasEl, canvas, commandSuggest, async (command, cwd) => {
    await intelligence.recordHistory(command, cwd);
  });
  canvas.getSnapTargets = (excludeId) => terminalManager.getSnapTargets(excludeId);

  // Sidebar (three-column layout)
  new Sidebar(sidebarContainer, panelArea);

  // File Tree Panel
  const fileTree = new FileTree(panelFiles);
  fileTree.onOpenTerminal = (dirPath: string) => {
    terminalManager.createTerminalAt(50, 50, 700, 450, dirPath);
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
  new CommandConfigPanel(panelCommands, async (command: string) => {
    const sent = await terminalManager.sendCommandToActiveTerminal(command);
    return sent;
  }, async () => {
    await intelligence.reloadCommands();
  });

  new HistoryPanel(panelHistory, intelligence, async (command: string) => {
    const sent = await terminalManager.sendCommandToActiveTerminal(command);
    return sent;
  });

  new MappingPanel(panelMappings, intelligence);

  const sshPanel = new SSHPanel(panelSsh);
  sshPanel.onProfilesChange = (profiles) => {
    terminalManager.setSshProfiles(profiles);
  };
  sshPanel.onSelectionChange = (profile, profiles) => {
    terminalManager.setSshProfiles(profiles);
    terminalManager.setPendingSshProfile(profile);
  };
  sshPanel.onConnect = async (profile, profiles) => {
    terminalManager.setSshProfiles(profiles);
    hint.classList.add('hidden');
    await terminalManager.createSshTerminal(profile);
  };

  // Hint
  const hint = document.createElement('div');
  hint.className = 'canvas-hint';
  hint.textContent = t('hint.canvas');
  document.body.appendChild(hint);

  // Update hint on language change
  onLangChange(() => {
    hint.textContent = t('hint.canvas');
  });

  // Hide hint after first terminal is created
  canvas.onTerminalCreate = (x, y, w, h) => {
    hint.classList.add('hidden');
    terminalManager.createTerminal(x, y, w, h);
  };

  // Restore terminals from previous session
  try {
    const saved = await invoke<Array<{ x: number; y: number; w: number; h: number; title: string; cwd: string }>>('load_terminal_state');
    if (saved.length > 0) {
      hint.classList.add('hidden');
      for (const s of saved) {
        await terminalManager.createTerminal(s.x, s.y, s.w, s.h, { cwd: s.cwd || undefined, mode: 'local' });
      }
    }
  } catch (e) {
    // No saved state or error - ignore
  }

  // Save terminal state before window closes
  const appWin = (window as any).__TAURI__.window.getCurrentWindow();
  appWin.onCloseRequested(async () => {
    try {
      const states = terminalManager.getTerminalStates();
      await invoke('save_terminal_state', { sessions: states });
    } catch {
      // Ignore save errors on close
    }
  });

  // App window controls
  document.getElementById('app-minimize')?.addEventListener('click', () => {
    appWin.minimize();
  });
  document.getElementById('app-maximize')?.addEventListener('click', async () => {
    await (await appWin.isMaximized() ? appWin.unmaximize() : appWin.maximize());
  });
  document.getElementById('app-close')?.addEventListener('click', () => {
    appWin.close();
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

  // Toast notification when terminal is copied via Ctrl+C
  terminalManager.onTerminalCopied = () => {
    showToast(t('terminal.copied'));
  };

  // Global terminal duplicate shortcuts
  document.addEventListener('keydown', (e) => {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') && !activeEl.classList.contains('xterm-helper-textarea')) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'c' || e.key === 'C')) {
      if (!terminalManager.getActiveId()) return;
      const copied = terminalManager.copyActiveTerminal();
      if (!copied) return;
      e.preventDefault();
      e.stopPropagation();
      terminalManager.onTerminalCopied?.();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'v' || e.key === 'V')) {
      if (!terminalManager.hasCopiedTerminal()) return;

      e.preventDefault();
      e.stopPropagation();
      const pos = terminalManager.getPastePosition();
      void terminalManager.pasteTerminal(pos.x, pos.y);
    }
  }, true); // capture phase to intercept before xterm
});
