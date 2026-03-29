import { Canvas } from './canvas';
import { TerminalManager } from './terminal-manager';
import { Sidebar } from './sidebar';
import { FileTree } from './file-tree';
import { Settings } from './settings';
import { CommandConfigPanel } from './command-config';
import { CommandSuggest } from './command-suggest';
import './styles.css';

window.addEventListener('DOMContentLoaded', async () => {
  const viewport = document.getElementById('app-viewport')! as HTMLDivElement;
  const canvasEl = document.getElementById('canvas')! as HTMLDivElement;
  const selectionRect = document.getElementById('selection-rect')! as HTMLDivElement;
  const sidebarContainer = document.getElementById('sidebar-container')! as HTMLDivElement;
  const panelArea = document.getElementById('panel-area')! as HTMLDivElement;
  const panelFiles = document.getElementById('panel-files')! as HTMLDivElement;
  const panelSettings = document.getElementById('panel-settings')! as HTMLDivElement;
  const panelCommands = document.getElementById('panel-commands')! as HTMLDivElement;

  // Command Suggest (shared across all terminals)
  const commandSuggest = new CommandSuggest();
  await commandSuggest.init();

  // Canvas
  const canvas = new Canvas(viewport, canvasEl, selectionRect);

  // Terminal Manager
  const terminalManager = new TerminalManager(canvasEl, () => ({
    panX: canvas.getPan().x,
    panY: canvas.getPan().y,
    zoom: canvas.getZoom(),
  }), commandSuggest);

  // Sidebar (three-column layout)
  new Sidebar(sidebarContainer, panelArea);

  // File Tree Panel
  const fileTree = new FileTree(panelFiles);
  fileTree.onOpenTerminal = (dirPath: string) => {
    terminalManager.createTerminalAt(50, 50, 700, 450, dirPath);
  };

  // Settings Panel
  new Settings(panelSettings);

  // Command Config Panel
  new CommandConfigPanel(panelCommands);

  // Hint
  const hint = document.createElement('div');
  hint.className = 'canvas-hint';
  hint.textContent = '在空白区域拖拽以创建终端 | 滚轮平移 | Shift+滚轮水平移动 | Ctrl+滚轮缩放';
  document.body.appendChild(hint);

  // Hide hint after first terminal is created
  canvas.onTerminalCreate = (x, y, w, h) => {
    hint.classList.add('hidden');
    terminalManager.createTerminal(x, y, w, h);
  };

  // App window controls
  const appWin = (window as any).__TAURI__.window.getCurrentWindow();

  document.getElementById('app-minimize')?.addEventListener('click', () => {
    appWin.minimize();
  });
  document.getElementById('app-maximize')?.addEventListener('click', async () => {
    await (await appWin.isMaximized() ? appWin.unmaximize() : appWin.maximize());
  });
  document.getElementById('app-close')?.addEventListener('click', () => {
    appWin.close();
  });
});
