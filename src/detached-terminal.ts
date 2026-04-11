import { getCurrentWindow } from '@tauri-apps/api/window';
import { CommandIntelligence } from './command-intelligence';
import { CommandSuggest } from './command-suggest';
import { applyStoredAppearance } from './mode-bootstrap';
import { ShortcutManager } from './shortcut-manager';
import { TerminalWindow } from './terminal-window';
import type { CanvasController, CanvasState, Rect, SnapOptions, SnapPoint } from './types';

class FixedCanvasController implements CanvasController {
  getState(): CanvasState {
    return { panX: 0, panY: 0, zoom: 1 };
  }

  snapPoint(x: number, y: number): SnapPoint {
    return { x, y };
  }

  snapRect(rect: Rect, _options: SnapOptions): Rect {
    return rect;
  }

  clearGuides(): void {}
}

export async function initDetachedTerminalMode() {
  await applyStoredAppearance();

  document.documentElement.className = 'mode-detached-terminal';
  document.body.className = 'mode-detached-terminal';
  document.body.innerHTML = `
    <div id="app-viewport" class="detached-viewport">
      <div id="canvas" class="detached-canvas"></div>
    </div>
  `;

  const viewport = document.getElementById('app-viewport') as HTMLDivElement;
  const canvasEl = document.getElementById('canvas') as HTMLDivElement;
  const appWindow = getCurrentWindow();
  const intelligence = new CommandIntelligence();
  const commandSuggest = new CommandSuggest(intelligence);
  const shortcutManager = new ShortcutManager();
  const controller = new FixedCanvasController();

  await Promise.all([
    intelligence.init(),
    commandSuggest.init(),
    shortcutManager.init(),
  ]);

  const terminal = new TerminalWindow(
    canvasEl,
    0,
    0,
    viewport.clientWidth || window.innerWidth,
    viewport.clientHeight || window.innerHeight,
    controller,
    commandSuggest,
    shortcutManager,
    'native-window'
  );
  await terminal.initPty({ mode: 'local' });
  terminal.onCommandExecuted = (command, cwd) => intelligence.recordHistory(command, cwd);

  const syncSize = () => {
    terminal.setRect(0, 0, viewport.clientWidth || window.innerWidth, viewport.clientHeight || window.innerHeight);
  };

  window.addEventListener('resize', syncSize);
  syncSize();

  let closing = false;
  appWindow.onCloseRequested(async (event) => {
    if (closing) return;
    closing = true;
    event.preventDefault();
    try {
      await terminal.close();
    } finally {
      await appWindow.destroy().catch((error) => {
        console.error('detached terminal destroy failed', error);
      });
    }
  });
}
