import type { CanvasController, CanvasState, Rect, SnapOptions, SnapPoint, SnapTarget } from '../../types';
import { Perf } from '../../utils/perf';

export class Canvas implements CanvasController {
  private viewport: HTMLDivElement;
  private canvasEl: HTMLDivElement;
  private selectionRect: HTMLDivElement;
  private verticalGuide: HTMLDivElement;
  private horizontalGuide: HTMLDivElement;
  private verticalBadge: HTMLDivElement;
  private horizontalBadge: HTMLDivElement;

  private panX = 0;
  private panY = 0;
  private zoom = 1.0;

  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;

  private snapCache: { excludeId?: string; targets: SnapTarget[]; vertical: number[]; horizontal: number[] } | null = null;

  public onTerminalCreate?: (x: number, y: number, w: number, h: number) => void;
  public getSnapTargets: ((excludeId?: string) => SnapTarget[]) | null = null;
  public onCanvasContextMenu?: ((canvas: Canvas, clientX: number, clientY: number) => void) | null = null;
  public getViewportSize: (() => { w: number; h: number }) | null = null;
  public onViewChange?: ((state: CanvasState) => void) | null = null;

  private boundOnWheel: (e: WheelEvent) => void;
  private boundOnMouseDown: (e: MouseEvent) => void;
  private boundOnMouseMove: (e: MouseEvent) => void;
  private boundOnMouseUp: (e: MouseEvent) => void;
  private boundOnContextMenu: (e: MouseEvent) => void;
  private boundOnDocumentClick: (ev: MouseEvent) => void;

  constructor(
    viewport: HTMLDivElement,
    canvasEl: HTMLDivElement,
    selectionRect: HTMLDivElement
  ) {
    this.viewport = viewport;
    this.canvasEl = canvasEl;
    this.selectionRect = selectionRect;
    this.verticalGuide = this.createGuide('vertical');
    this.horizontalGuide = this.createGuide('horizontal');
    this.verticalBadge = this.createBadge();
    this.horizontalBadge = this.createBadge();

    this.boundOnWheel = this.onWheel.bind(this);
    this.boundOnMouseDown = this.onMouseDown.bind(this);
    this.boundOnMouseMove = this.onMouseMove.bind(this);
    this.boundOnMouseUp = this.onMouseUp.bind(this);
    this.boundOnContextMenu = this.onContextMenu.bind(this);
    this.boundOnDocumentClick = (ev: MouseEvent) => {
      if (!(ev.target as HTMLElement).closest('.canvas-context-menu')) {
        this.closeCanvasMenu();
      }
    };

    this.bindEvents();
  }

  destroy() {
    this.viewport.removeEventListener('wheel', this.boundOnWheel);
    this.viewport.removeEventListener('mousedown', this.boundOnMouseDown);
    this.viewport.removeEventListener('contextmenu', this.boundOnContextMenu);
    window.removeEventListener('mousemove', this.boundOnMouseMove);
    window.removeEventListener('mouseup', this.boundOnMouseUp);
    document.removeEventListener('click', this.boundOnDocumentClick);
    this.closeCanvasMenu();
  }

  getState(): CanvasState {
    return {
      panX: this.panX,
      panY: this.panY,
      zoom: this.zoom,
    };
  }

  setState(state: Partial<CanvasState>) {
    if (typeof state.panX === 'number') {
      this.panX = state.panX;
    }
    if (typeof state.panY === 'number') {
      this.panY = state.panY;
    }
    if (typeof state.zoom === 'number' && Number.isFinite(state.zoom)) {
      this.zoom = Math.max(0.2, Math.min(3, state.zoom));
    }
    this.applyTransform();
  }

  getZoom(): number {
    return this.zoom;
  }

  getPan(): { x: number; y: number } {
    return { x: this.panX, y: this.panY };
  }

  resetView() {
    this.panX = 0;
    this.panY = 0;
    this.zoom = 1.0;
    this.applyTransform();
  }

  snapPoint(x: number, y: number, excludeId?: string): SnapPoint {
    const candidates = this.collectCandidates(excludeId);
    const xSnap = this.findClosest(x, candidates.vertical);
    const ySnap = this.findClosest(y, candidates.horizontal);
    this.updateGuides(xSnap.guide, ySnap.guide);
    return {
      x: xSnap.value,
      y: ySnap.value,
    };
  }

  snapRect(rect: Rect, options: SnapOptions): Rect {
    const next = { ...rect };
    const candidates = this.collectCandidates(options.sourceId);
    let guideX: number | null = null;
    let guideY: number | null = null;

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
        next.w = Math.max(200, rect.w + (snap.value - (rect.x + rect.w)));
        guideX = snap.guide;
      }
      if (direction.includes('w')) {
        const snap = this.findClosest(rect.x, candidates.vertical);
        const delta = snap.value - rect.x;
        next.x += delta;
        next.w = Math.max(200, rect.w - delta);
        if (next.w === 200) {
          next.x = rect.x + (rect.w - 200);
        }
        guideX = snap.guide;
      }
      if (direction.includes('s')) {
        const snap = this.findClosest(rect.y + rect.h, candidates.horizontal);
        next.h = Math.max(100, rect.h + (snap.value - (rect.y + rect.h)));
        guideY = snap.guide;
      }
      if (direction.includes('n')) {
        const snap = this.findClosest(rect.y, candidates.horizontal);
        const delta = snap.value - rect.y;
        next.y += delta;
        next.h = Math.max(100, rect.h - delta);
        if (next.h === 100) {
          next.y = rect.y + (rect.h - 100);
        }
        guideY = snap.guide;
      }
    }

    // 反查吸附目标终端，把辅助线收敛为两终端边缘之间的局部短线
    const xRange = guideX !== null ? this.computeVerticalRange(guideX, next) : null;
    const yRange = guideY !== null ? this.computeHorizontalRange(guideY, next) : null;
    this.updateGuides(guideX, guideY, xRange, yRange);
    return next;
  }

  clearGuides(): void {
    this.verticalGuide.style.display = 'none';
    this.horizontalGuide.style.display = 'none';
    this.verticalBadge.style.display = 'none';
    this.horizontalBadge.style.display = 'none';
    this.snapCache = null;
  }

  private bindEvents() {
    this.viewport.addEventListener('wheel', this.boundOnWheel, { passive: false });
    this.viewport.addEventListener('mousedown', this.boundOnMouseDown);
    this.viewport.addEventListener('contextmenu', this.boundOnContextMenu);
    window.addEventListener('mousemove', this.boundOnMouseMove);
    window.addEventListener('mouseup', this.boundOnMouseUp);
    document.addEventListener('click', this.boundOnDocumentClick);
  }

  private createGuide(kind: 'vertical' | 'horizontal'): HTMLDivElement {
    const el = document.createElement('div');
    el.className = `canvas-guide ${kind}`;
    // 对齐辅助线脉冲动画（来自 components.css 的 craftAlignPulse）
    el.style.animation = 'craftAlignPulse 1.6s ease-in-out infinite';
    this.canvasEl.appendChild(el);
    return el;
  }

  private createBadge(): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'canvas-guide-badge';
    el.style.display = 'none';
    this.canvasEl.appendChild(el);
    return el;
  }

  private onWheel(e: WheelEvent) {
    Perf.mark('canvas.onWheel');
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('.json-editor-overlay')) return;

    const isOverTerminal = !!target.closest('.terminal-window');

    if (e.ctrlKey) {
      e.preventDefault();
      this.handleZoomAtMouse(e);
      Perf.end('canvas.onWheel');
      return;
    }

    if (isOverTerminal && document.querySelector('.terminal-window.focused')) {
      Perf.end('canvas.onWheel');
      return;
    }

    e.preventDefault();
    if (e.shiftKey) {
      const horizontalDelta = Math.abs(e.deltaX) > 0 ? e.deltaX : e.deltaY;
      this.panX -= horizontalDelta;
    } else {
      this.panX -= e.deltaX;
      this.panY -= e.deltaY;
    }
    this.applyTransform();
    Perf.end('canvas.onWheel');
  }

  private handleZoomAtMouse(e: WheelEvent) {
    Perf.mark('canvas.handleZoomAtMouse');
    const rect = this.viewport.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    const oldZoom = this.zoom;
    this.zoom = Math.max(0.2, Math.min(3.0, this.zoom + delta));
    const ratio = this.zoom / oldZoom;
    this.panX = mouseX - (mouseX - this.panX) * ratio;
    this.panY = mouseY - (mouseY - this.panY) * ratio;
    this.applyTransform();
    Perf.end('canvas.handleZoomAtMouse');
  }

  private onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.terminal-window')) return;
    this.closeCanvasMenu();

    this.isDragging = true;
    const rect = this.viewport.getBoundingClientRect();
    this.dragStartX = (e.clientX - rect.left - this.panX) / this.zoom;
    this.dragStartY = (e.clientY - rect.top - this.panY) / this.zoom;

    this.selectionRect.style.display = 'block';
    this.updateSelectionRect(this.dragStartX, this.dragStartY, 0, 0);
  }

  private onMouseMove(e: MouseEvent) {
    if (!this.isDragging) return;
    Perf.frameStart('canvas.onMouseMove');
    const rect = this.viewport.getBoundingClientRect();
    const currentX = (e.clientX - rect.left - this.panX) / this.zoom;
    const currentY = (e.clientY - rect.top - this.panY) / this.zoom;
    const snapped = this.snapPoint(currentX, currentY);

    const x = Math.min(this.dragStartX, snapped.x);
    const y = Math.min(this.dragStartY, snapped.y);
    const w = Math.abs(snapped.x - this.dragStartX);
    const h = Math.abs(snapped.y - this.dragStartY);

    this.updateSelectionRect(x, y, w, h);
    Perf.frameEnd('canvas.onMouseMove');
  }

  private onMouseUp(e: MouseEvent) {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.selectionRect.style.display = 'none';

    const rect = this.viewport.getBoundingClientRect();
    const endX = (e.clientX - rect.left - this.panX) / this.zoom;
    const endY = (e.clientY - rect.top - this.panY) / this.zoom;
    const snapped = this.snapPoint(endX, endY);
    this.clearGuides();

    const x = Math.min(this.dragStartX, snapped.x);
    const y = Math.min(this.dragStartY, snapped.y);
    const w = Math.abs(snapped.x - this.dragStartX);
    const h = Math.abs(snapped.y - this.dragStartY);

    if (w >= 100 && h >= 80) {
      this.onTerminalCreate?.(x, y, w, h);
    }
  }

  private updateSelectionRect(x: number, y: number, w: number, h: number) {
    this.selectionRect.style.left = `${x}px`;
    this.selectionRect.style.top = `${y}px`;
    this.selectionRect.style.width = `${w}px`;
    this.selectionRect.style.height = `${h}px`;
  }

  private applyTransform() {
    Perf.mark('canvas.applyTransform');
    this.canvasEl.style.transform = `translate3d(${this.panX}px, ${this.panY}px, 0) scale(${this.zoom})`;
    this.onViewChange?.(this.getState());
    Perf.end('canvas.applyTransform');
  }

  private collectCandidates(excludeId?: string): { vertical: number[]; horizontal: number[] } {
    if (this.snapCache && this.snapCache.excludeId === excludeId) {
      return { vertical: this.snapCache.vertical, horizontal: this.snapCache.horizontal };
    }

    Perf.mark('canvas.collectCandidates');
    const targets = this.getSnapTargets ? this.getSnapTargets(excludeId) : [];
    const vertical = new Set<number>([0]);
    const horizontal = new Set<number>([0]);

    for (const target of targets) {
      vertical.add(target.x);
      vertical.add(target.x + target.w / 2);
      vertical.add(target.x + target.w);
      horizontal.add(target.y);
      horizontal.add(target.y + target.h / 2);
      horizontal.add(target.y + target.h);
    }

    const result = {
      vertical: [...vertical].sort((a, b) => a - b),
      horizontal: [...horizontal].sort((a, b) => a - b),
    };

    this.snapCache = { excludeId, targets, ...result };
    Perf.end('canvas.collectCandidates');
    return result;
  }

  private findClosest(value: number, candidates: number[]): { value: number; guide: number | null } {
    const threshold = 10 / this.zoom;
    let bestGuide: number | null = null;
    let bestDelta = threshold + 1;

    const idx = binarySearch(candidates, value);
    const start = Math.max(0, idx - 2);
    const end = Math.min(candidates.length - 1, idx + 2);

    for (let i = start; i <= end; i++) {
      const delta = candidates[i] - value;
      if (Math.abs(delta) < Math.abs(bestDelta) && Math.abs(delta) <= threshold) {
        bestDelta = delta;
        bestGuide = candidates[i];
      }
    }

    if (bestGuide === null) {
      return { value, guide: null };
    }
    return { value: value + bestDelta, guide: bestGuide };
  }

  private findBestRectSnap(values: number[], candidates: number[]): { delta: number; guide: number | null } {
    const threshold = 10 / this.zoom;
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

  private updateGuides(
    x: number | null,
    y: number | null,
    xRange: { top: number; height: number } | null = null,
    yRange: { left: number; width: number } | null = null,
  ) {
    // 视口左上角在 canvas 坐标系中的位置，用于 badge 兜底定位
    const viewTop = -this.panY / this.zoom;
    const viewLeft = -this.panX / this.zoom;

    if (x === null) {
      this.verticalGuide.style.display = 'none';
      this.verticalBadge.style.display = 'none';
    } else {
      this.verticalGuide.style.display = 'block';
      this.verticalGuide.style.left = `${x}px`;
      let vTop = xRange ? xRange.top : viewTop;
      let vHeight = xRange ? xRange.height : 0;
      if (xRange && vHeight > 160) { vTop = vTop + vHeight / 2 - 80; vHeight = 160; }
      if (xRange) {
        // 局部短线：吸附点附近 ±80px，避免穿过其他终端
        this.verticalGuide.style.top = `${vTop}px`;
        this.verticalGuide.style.height = `${vHeight}px`;
      } else {
        // 无明确目标终端（如吸附画布原点）时退化为全屏线
        this.verticalGuide.style.top = '-4000px';
        this.verticalGuide.style.height = '8000px';
      }
      this.verticalBadge.style.display = 'block';
      this.verticalBadge.style.left = `${x - 14}px`;
      this.verticalBadge.style.top = `${vTop + 6}px`;
      this.verticalBadge.textContent = `x: ${Math.round(x)}`;
    }

    if (y === null) {
      this.horizontalGuide.style.display = 'none';
      this.horizontalBadge.style.display = 'none';
    } else {
      this.horizontalGuide.style.display = 'block';
      this.horizontalGuide.style.top = `${y}px`;
      let hLeft = yRange ? yRange.left : viewLeft;
      let hWidth = yRange ? yRange.width : 0;
      if (yRange && hWidth > 160) { hLeft = hLeft + hWidth / 2 - 80; hWidth = 160; }
      if (yRange) {
        // 局部短线：吸附点附近 ±80px，避免穿过其他终端
        this.horizontalGuide.style.left = `${hLeft}px`;
        this.horizontalGuide.style.width = `${hWidth}px`;
      } else {
        this.horizontalGuide.style.left = '-4000px';
        this.horizontalGuide.style.width = '8000px';
      }
      this.horizontalBadge.style.display = 'block';
      this.horizontalBadge.style.left = `${hLeft + 6}px`;
      this.horizontalBadge.style.top = `${y - 10}px`;
      this.horizontalBadge.textContent = `y: ${Math.round(y)}`;
    }
  }

  // 在已吸附的垂直坐标上反查目标终端，返回拖拽终端与目标终端的垂直并集范围，用于绘制局部短线
  private computeVerticalRange(guideX: number, rect: Rect): { top: number; height: number } | null {
    const targets = this.snapCache?.targets;
    if (!targets || targets.length === 0) return null;
    const tol = 0.5;
    for (const target of targets) {
      if (
        Math.abs(target.x - guideX) < tol ||
        Math.abs(target.x + target.w / 2 - guideX) < tol ||
        Math.abs(target.x + target.w - guideX) < tol
      ) {
        const top = Math.min(rect.y, target.y);
        const bottom = Math.max(rect.y + rect.h, target.y + target.h);
        return { top, height: bottom - top };
      }
    }
    return null;
  }

  // 在已吸附的水平坐标上反查目标终端，返回拖拽终端与目标终端的水平并集范围，用于绘制局部短线
  private computeHorizontalRange(guideY: number, rect: Rect): { left: number; width: number } | null {
    const targets = this.snapCache?.targets;
    if (!targets || targets.length === 0) return null;
    const tol = 0.5;
    for (const target of targets) {
      if (
        Math.abs(target.y - guideY) < tol ||
        Math.abs(target.y + target.h / 2 - guideY) < tol ||
        Math.abs(target.y + target.h - guideY) < tol
      ) {
        const left = Math.min(rect.x, target.x);
        const right = Math.max(rect.x + rect.w, target.x + target.w);
        return { left, width: right - left };
      }
    }
    return null;
  }

  private canvasMenu: HTMLDivElement | null = null;

  private onContextMenu(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('.terminal-window')) return;
    e.preventDefault();
    this.closeCanvasMenu();
    if (this.onCanvasContextMenu) {
      this.onCanvasContextMenu(this, e.clientX, e.clientY);
    }
  }

  closeCanvasMenu() {
    if (this.canvasMenu) {
      this.canvasMenu.remove();
      this.canvasMenu = null;
    }
  }

  showCanvasMenu(x: number, y: number, items: Array<{ label: string; action: () => void }>) {
    this.closeCanvasMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu canvas-context-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    for (const item of items) {
      const el = document.createElement('div');
      el.className = 'context-menu-item';
      el.textContent = item.label;
      el.addEventListener('click', () => {
        item.action();
        this.closeCanvasMenu();
      });
      menu.appendChild(el);
    }

    document.body.appendChild(menu);
    this.canvasMenu = menu;

    const close = (ev: MouseEvent) => {
      if (!(ev.target as HTMLElement).closest('.canvas-context-menu')) {
        this.closeCanvasMenu();
      }
    };
    const cleanup = () => {
      document.removeEventListener('click', close);
      document.removeEventListener('contextmenu', close as EventListener);
    };
    setTimeout(() => {
      document.addEventListener('click', close);
      document.addEventListener('contextmenu', close as EventListener);
    }, 0);
    menu.addEventListener('remove', cleanup);
  }
}

function binarySearch(sorted: number[], target: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return lo;
}
