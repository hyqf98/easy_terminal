import { getAllWindows, getCurrentWindow, type Window } from '@tauri-apps/api/window';
import { CommandIntelligence } from '../terminal/commandIntelligence';
import { applyStoredAppearance } from './modeBootstrap';
import { ShortcutManager } from '../shortcut/shortcutManager';
import type { CanvasController, CanvasState, Rect, SnapOptions, SnapPoint } from '../../types';

class DetachedWindowCanvasController implements CanvasController {
  private verticalGuide: HTMLDivElement;
  private horizontalGuide: HTMLDivElement;
  private currentRect: Rect = { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
  private targets: Rect[] = [];

  constructor(private hostEl: HTMLElement, private appWindow: Window) {
    this.verticalGuide = this.createGuide('vertical');
    this.horizontalGuide = this.createGuide('horizontal');
    void this.syncCurrentRect();
    void this.bindWindowEvents();
  }

  getState(): CanvasState {
    return { panX: 0, panY: 0, zoom: 1 };
  }

  snapPoint(x: number, y: number): SnapPoint {
    return { x, y };
  }

  async refreshSnapTargets(excludeId?: string): Promise<void> {
    const windows = await getAllWindows();
    const targets = await Promise.all(
      windows
        .filter((item) => item.label.startsWith('free-terminal-') && item.label !== (excludeId || this.appWindow.label))
        .map(async (item) => this.readWindowRect(item))
    );
    this.targets = targets.filter((item): item is Rect => Boolean(item));
  }

  getNativeWindowRect(): Rect {
    return { ...this.currentRect };
  }

  snapRect(rect: Rect, options: SnapOptions): Rect {
    const next = { ...rect };
    let guideX: number | null = null;
    let guideY: number | null = null;
    const candidates = this.collectCandidates();

    if (options.mode === 'drag') {
      const xSnap = this.findBestRectSnap(
        [rect.x, rect.x + rect.w / 2, rect.x + rect.w],
        candidates.vertical
      );
      const ySnap = this.findBestRectSnap(
        [rect.y, rect.y + rect.h / 2, rect.y + rect.h],
        candidates.horizontal
      );
      next.x += xSnap.delta;
      next.y += ySnap.delta;
      guideX = xSnap.guide;
      guideY = ySnap.guide;
    } else {
      const direction = options.direction || '';
      if (direction.includes('e')) {
        const snap = this.findClosest(rect.x + rect.w, candidates.vertical);
        next.w = Math.max(320, rect.w + (snap.value - (rect.x + rect.w)));
        guideX = snap.guide;
      }
      if (direction.includes('w')) {
        const snap = this.findClosest(rect.x, candidates.vertical);
        const delta = snap.value - rect.x;
        next.x += delta;
        next.w = Math.max(320, rect.w - delta);
        if (next.w === 320) {
          next.x = rect.x + (rect.w - 320);
        }
        guideX = snap.guide;
      }
      if (direction.includes('s')) {
        const snap = this.findClosest(rect.y + rect.h, candidates.horizontal);
        next.h = Math.max(220, rect.h + (snap.value - (rect.y + rect.h)));
        guideY = snap.guide;
      }
      if (direction.includes('n')) {
        const snap = this.findClosest(rect.y, candidates.horizontal);
        const delta = snap.value - rect.y;
        next.y += delta;
        next.h = Math.max(220, rect.h - delta);
        if (next.h === 220) {
          next.y = rect.y + (rect.h - 220);
        }
        guideY = snap.guide;
      }
    }

    this.updateGuides(guideX, guideY, next);
    return next;
  }

  clearGuides(): void {
    this.verticalGuide.style.display = 'none';
    this.horizontalGuide.style.display = 'none';
  }

  updateNativeWindowRect(rect: Rect) {
    this.currentRect = { ...rect };
  }

  private async bindWindowEvents() {
    await this.appWindow.onMoved(async () => {
      await this.syncCurrentRect();
    });
    await this.appWindow.onResized(async () => {
      await this.syncCurrentRect();
    });
  }

  private async syncCurrentRect() {
    const rect = await this.readWindowRect(this.appWindow);
    if (rect) {
      this.currentRect = rect;
    }
  }

  private async readWindowRect(windowRef: Window): Promise<Rect | null> {
    try {
      const [position, size, scale] = await Promise.all([
        windowRef.outerPosition(),
        windowRef.outerSize(),
        windowRef.scaleFactor(),
      ]);
      const logicalPosition = position.toLogical(scale);
      const logicalSize = size.toLogical(scale);
      return {
        x: logicalPosition.x,
        y: logicalPosition.y,
        w: logicalSize.width,
        h: logicalSize.height,
      };
    } catch {
      return null;
    }
  }

  private createGuide(kind: 'vertical' | 'horizontal'): HTMLDivElement {
    const el = document.createElement('div');
    el.className = `canvas-guide ${kind}`;
    this.hostEl.appendChild(el);
    return el;
  }

  private collectCandidates(): { vertical: number[]; horizontal: number[] } {
    const vertical = new Set<number>();
    const horizontal = new Set<number>();
    for (const target of this.targets) {
      vertical.add(target.x);
      vertical.add(target.x + target.w / 2);
      vertical.add(target.x + target.w);
      horizontal.add(target.y);
      horizontal.add(target.y + target.h / 2);
      horizontal.add(target.y + target.h);
    }
    return {
      vertical: [...vertical],
      horizontal: [...horizontal],
    };
  }

  private findClosest(value: number, candidates: number[]): { value: number; guide: number | null } {
    const threshold = 12;
    let bestGuide: number | null = null;
    let bestDelta = threshold + 1;

    for (const candidate of candidates) {
      const delta = candidate - value;
      if (Math.abs(delta) < Math.abs(bestDelta) && Math.abs(delta) <= threshold) {
        bestDelta = delta;
        bestGuide = candidate;
      }
    }

    if (bestGuide === null) {
      return { value, guide: null };
    }
    return { value: value + bestDelta, guide: bestGuide };
  }

  private findBestRectSnap(values: number[], candidates: number[]): { delta: number; guide: number | null } {
    const threshold = 12;
    let bestGuide: number | null = null;
    let bestDelta = 0;
    let bestDistance = threshold + 1;

    for (const value of values) {
      for (const candidate of candidates) {
        const delta = candidate - value;
        const distance = Math.abs(delta);
        if (distance <= threshold && distance < bestDistance) {
          bestDistance = distance;
          bestDelta = delta;
          bestGuide = candidate;
        }
      }
    }

    return { delta: bestDelta, guide: bestGuide };
  }

  private updateGuides(x: number | null, y: number | null, rect: Rect) {
    if (x === null) {
      this.verticalGuide.style.display = 'none';
    } else {
      this.verticalGuide.style.display = 'block';
      this.verticalGuide.style.left = `${x - rect.x}px`;
    }

    if (y === null) {
      this.horizontalGuide.style.display = 'none';
    } else {
      this.horizontalGuide.style.display = 'block';
      this.horizontalGuide.style.top = `${y - rect.y}px`;
    }
  }
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

  const canvasEl = document.getElementById('canvas') as HTMLDivElement;
  const appWindow = getCurrentWindow();
  const intelligence = new CommandIntelligence();
  const shortcutManager = new ShortcutManager();
  void new DetachedWindowCanvasController(canvasEl, appWindow);

  await Promise.all([
    intelligence.init(),
    shortcutManager.init(),
  ]);

  const { Terminal } = await import('@xterm/xterm');
  const { FitAddon } = await import('@xterm/addon-fit');
  const { WebLinksAddon } = await import('@xterm/addon-web-links');
  const { getTerminalThemeStrategy } = await import('../terminal/strategies/terminalIndex');
  const { defaultWindowIcon } = await import('@tauri-apps/api/app');
  const { listen } = await import('@tauri-apps/api/event');
  const sessionId = appWindow.label;

  try {
    const icon = await defaultWindowIcon();
    if (icon) {
      await appWindow.setIcon(icon);
    }
  } catch { /* ignore */ }

  const themeName = document.documentElement.getAttribute('data-theme') || 'dark';
  const theme = getTerminalThemeStrategy(themeName).getTheme();

  const term = new Terminal({
    theme,
    fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, monospace',
    fontSize: 14,
    fontWeight: '400',
    fontWeightBold: '600',
    lineHeight: 1.2,
    cursorBlink: true,
    cursorStyle: 'bar',
    cursorWidth: 1,
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon());
  term.open(canvasEl);
  fitAddon.fit();

  const unlisten = await listen(`pty-output-${sessionId}`, (event) => {
    const output = (event.payload as { data: string }).data;
    term.write(output);
  });

  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');

  await tauriInvoke('create_pty', {
    sessionId,
    cols: term.cols,
    rows: term.rows,
    cwd: undefined,
  });

  term.onData((data) => {
    void tauriInvoke('write_pty', {
      sessionId,
      data,
    });
  });

  term.focus();

  const syncSize = () => {
    fitAddon.fit();
    void tauriInvoke('resize_pty', {
      sessionId,
      cols: term.cols,
      rows: term.rows,
    });
  };

  window.addEventListener('resize', syncSize);
  syncSize();

  let closing = false;
  appWindow.onCloseRequested(async (event) => {
    if (closing) return;
    closing = true;
    event.preventDefault();
    try {
      await tauriInvoke('kill_pty', { sessionId });
      unlisten();
      term.dispose();
    } finally {
      await appWindow.destroy().catch((error) => {
        console.error('detached terminal destroy failed', error);
      });
    }
  });
}
