import { invoke } from '@tauri-apps/api/core';
import { getAllWindows, getCurrentWindow, type Window } from '@tauri-apps/api/window';
import { t } from './i18n';
import { applyStoredAppearance } from './mode-bootstrap';

interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

class DesktopDrawSnapController {
  private verticalGuide: HTMLDivElement;
  private horizontalGuide: HTMLDivElement;
  private hostOrigin = { x: 0, y: 0 };
  private targets: Bounds[] = [];

  constructor(private hostEl: HTMLElement, private appWindow: Window) {
    this.verticalGuide = this.createGuide('vertical');
    this.horizontalGuide = this.createGuide('horizontal');
  }

  async init() {
    await Promise.all([
      this.syncHostOrigin(),
      this.refreshTargets(),
    ]);
  }

  async refreshTargets() {
    await this.syncHostOrigin();
    const windows = await getAllWindows();
    const targets = await Promise.all(
      windows
        .filter((item) => item.label.startsWith('free-terminal-'))
        .map(async (item) => this.readWindowRect(item))
    );
    this.targets = targets.filter((item): item is Bounds => Boolean(item));
  }

  snapLocalRect(rect: Bounds): Bounds {
    const absolute = {
      x: rect.x + this.hostOrigin.x,
      y: rect.y + this.hostOrigin.y,
      w: rect.w,
      h: rect.h,
    };
    const verticalCandidates = new Set<number>();
    const horizontalCandidates = new Set<number>();

    for (const target of this.targets) {
      verticalCandidates.add(target.x);
      verticalCandidates.add(target.x + target.w / 2);
      verticalCandidates.add(target.x + target.w);
      horizontalCandidates.add(target.y);
      horizontalCandidates.add(target.y + target.h / 2);
      horizontalCandidates.add(target.y + target.h);
    }

    const xSnap = this.findBestRectSnap(
      [absolute.x, absolute.x + absolute.w / 2, absolute.x + absolute.w],
      [...verticalCandidates]
    );
    const ySnap = this.findBestRectSnap(
      [absolute.y, absolute.y + absolute.h / 2, absolute.y + absolute.h],
      [...horizontalCandidates]
    );

    const snappedAbsolute = {
      x: absolute.x + xSnap.delta,
      y: absolute.y + ySnap.delta,
      w: absolute.w,
      h: absolute.h,
    };

    this.updateGuides(xSnap.guide, ySnap.guide);

    return {
      x: snappedAbsolute.x - this.hostOrigin.x,
      y: snappedAbsolute.y - this.hostOrigin.y,
      w: snappedAbsolute.w,
      h: snappedAbsolute.h,
    };
  }

  clearGuides() {
    this.verticalGuide.style.display = 'none';
    this.horizontalGuide.style.display = 'none';
  }

  private async syncHostOrigin() {
    try {
      const [position, scale] = await Promise.all([
        this.appWindow.outerPosition(),
        this.appWindow.scaleFactor(),
      ]);
      const logical = position.toLogical(scale);
      this.hostOrigin = { x: logical.x, y: logical.y };
    } catch (error) {
      console.error('sync desktop draw host origin failed', error);
    }
  }

  private async readWindowRect(windowRef: Window): Promise<Bounds | null> {
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

  private findBestRectSnap(values: number[], candidates: number[]) {
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

  private createGuide(kind: 'vertical' | 'horizontal') {
    const el = document.createElement('div');
    el.className = `canvas-guide ${kind}`;
    this.hostEl.appendChild(el);
    return el;
  }

  private updateGuides(x: number | null, y: number | null) {
    if (x === null) {
      this.verticalGuide.style.display = 'none';
    } else {
      this.verticalGuide.style.display = 'block';
      this.verticalGuide.style.left = `${x - this.hostOrigin.x}px`;
    }

    if (y === null) {
      this.horizontalGuide.style.display = 'none';
    } else {
      this.horizontalGuide.style.display = 'block';
      this.horizontalGuide.style.top = `${y - this.hostOrigin.y}px`;
    }
  }
}

export async function initDesktopDrawMode() {
  await applyStoredAppearance();
  const armedAt = performance.now() + 180;

  document.documentElement.className = 'mode-desktop-draw';
  document.body.className = 'mode-desktop-draw';
  document.body.innerHTML = `
    <div id="desktop-draw-root">
      <div class="desktop-draw-backdrop"></div>
      <div class="desktop-draw-hint">
        <strong>${t('desktop.drawTitle')}</strong>
        <span>${t('desktop.drawHint')}</span>
      </div>
      <div id="desktop-draw-selection"></div>
    </div>
  `;

  const root = document.getElementById('desktop-draw-root') as HTMLDivElement;
  const selection = document.getElementById('desktop-draw-selection') as HTMLDivElement;
  const appWindow = getCurrentWindow();
  const snapController = new DesktopDrawSnapController(root, appWindow);
  await snapController.init();

  document.documentElement.style.cursor = 'crosshair';
  document.body.style.cursor = 'crosshair';
  root.style.cursor = 'crosshair';
  selection.style.cursor = 'crosshair';

  let drawing = false;
  let startX = 0;
  let startY = 0;
  let activePointerId: number | null = null;
  let currentBounds: Bounds | null = null;

  const resetSelection = () => {
    drawing = false;
    activePointerId = null;
    currentBounds = null;
    selection.style.display = 'none';
    selection.style.width = '0';
    selection.style.height = '0';
    snapController.clearGuides();
  };

  const renderSelection = (bounds: Bounds) => {
    selection.style.display = 'block';
    selection.style.left = `${bounds.x}px`;
    selection.style.top = `${bounds.y}px`;
    selection.style.width = `${bounds.w}px`;
    selection.style.height = `${bounds.h}px`;
  };

  const getBounds = (clientX: number, clientY: number): Bounds => ({
    x: Math.min(startX, clientX),
    y: Math.min(startY, clientY),
    w: Math.abs(clientX - startX),
    h: Math.abs(clientY - startY),
  });

  root.addEventListener('pointerdown', (event) => {
    if (performance.now() < armedAt) return;
    if (!event.isPrimary || event.button !== 0) return;
    drawing = true;
    activePointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    currentBounds = { x: startX, y: startY, w: 0, h: 0 };
    root.setPointerCapture(event.pointerId);
    renderSelection(currentBounds);
    void snapController.refreshTargets();
  });

  window.addEventListener('pointermove', (event) => {
    if (!drawing) return;
    if (activePointerId !== null && event.pointerId !== activePointerId) return;
    const rawBounds = getBounds(event.clientX, event.clientY);
    currentBounds = snapController.snapLocalRect(rawBounds);
    renderSelection(currentBounds);
  });

  window.addEventListener('pointerup', async (event) => {
    if (!drawing) return;
    if (activePointerId !== null && event.pointerId !== activePointerId) return;

    const pointerId = activePointerId;
    const bounds = currentBounds || getBounds(event.clientX, event.clientY);
    resetSelection();
    if (pointerId !== null) {
      try {
        root.releasePointerCapture(pointerId);
      } catch {
        // Ignore if capture has already been released.
      }
    }

    if (bounds.w < 180 || bounds.h < 120) {
      return;
    }

    try {
      await invoke('create_detached_terminal_window', { bounds });
      await appWindow.destroy();
    } catch (error) {
      console.error('create detached terminal window failed', error);
    }
  });

  window.addEventListener('pointercancel', () => {
    if (!drawing) return;
    resetSelection();
  });

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    snapController.clearGuides();
    void appWindow.destroy().catch((error) => {
      console.error('desktop draw window destroy failed', error);
    });
  });
}
