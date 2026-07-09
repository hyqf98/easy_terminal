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

  // 点吸附：将裸坐标吸附到最近的对齐候选点，并刷新对齐辅助线
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

  // 矩形吸附：拖拽时整体平移吸附，缩放时按方向单边吸附，同步更新辅助线
  snapRect(rect: Rect, options: SnapOptions): Rect {
    const next = { ...rect };
    const candidates = this.collectCandidates(options.sourceId);
    let guideX: number | null = null;
    let guideY: number | null = null;
    const minW = options.minW ?? 200;
    const minH = options.minH ?? 100;

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
        next.w = Math.max(minW, rect.w + (snap.value - (rect.x + rect.w)));
        guideX = snap.guide;
      }
      if (direction.includes('w')) {
        const snap = this.findClosest(rect.x, candidates.vertical);
        const delta = snap.value - rect.x;
        next.x += delta;
        next.w = Math.max(minW, rect.w - delta);
        if (next.w === minW) {
          next.x = rect.x + (rect.w - minW);
        }
        guideX = snap.guide;
      }
      if (direction.includes('s')) {
        const snap = this.findClosest(rect.y + rect.h, candidates.horizontal);
        next.h = Math.max(minH, rect.h + (snap.value - (rect.y + rect.h)));
        guideY = snap.guide;
      }
      if (direction.includes('n')) {
        const snap = this.findClosest(rect.y, candidates.horizontal);
        const delta = snap.value - rect.y;
        next.y += delta;
        next.h = Math.max(minH, rect.h - delta);
        if (next.h === minH) {
          next.y = rect.y + (rect.h - minH);
        }
        guideY = snap.guide;
      }
    }

    // 始终绘制全屏对齐辅助线（不再绘制终端之间的局部短线“分割线”），仅保留坐标徽标
    this.updateGuides(guideX, guideY);
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
    // 浮动面板（文件树、预览面板、弹框等）内部的滚动不触发画布平移/缩放
    if (target.closest('.files-layout, .preview-panel, .modal-overlay, .tree-context-menu, .n-select-menu')) return;

    const isOverTerminal = this.isTerminalInteractionTarget(target);

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
    if (this.isTerminalInteractionTarget(e.target as HTMLElement)) return;
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

  // 将画布的平移与缩放合成 transform 并应用，同时广播视图状态变化
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

  // 渲染或隐藏水平/垂直对齐辅助线及坐标徽标。
  // 统一使用“全屏辅助线”模式：吸附命中时画一条贯穿视口的线（top/left ±4000px, 8000px 长度），
  // 不再在拖拽终端与吸附目标终端之间绘制局部短线，避免出现“分割线”视觉。坐标徽标贴在视口边缘附近。
  private updateGuides(x: number | null, y: number | null) {
    // 视口左上角在 canvas 坐标系中的位置，用于把徽标钉在视口边缘
    const viewTop = -this.panY / this.zoom;
    const viewLeft = -this.panX / this.zoom;

    if (x === null) {
      this.verticalGuide.style.display = 'none';
      this.verticalBadge.style.display = 'none';
    } else {
      this.verticalGuide.style.display = 'block';
      this.verticalGuide.style.left = `${x}px`;
      // 全屏垂直线：覆盖整个视口高度，命中即显示
      this.verticalGuide.style.top = '-4000px';
      this.verticalGuide.style.height = '8000px';
      this.verticalBadge.style.display = 'block';
      this.verticalBadge.style.left = `${x - 14}px`;
      this.verticalBadge.style.top = `${viewTop + 6}px`;
      this.verticalBadge.textContent = `x: ${Math.round(x)}`;
    }

    if (y === null) {
      this.horizontalGuide.style.display = 'none';
      this.horizontalBadge.style.display = 'none';
    } else {
      this.horizontalGuide.style.display = 'block';
      this.horizontalGuide.style.top = `${y}px`;
      // 全屏水平线：覆盖整个视口宽度，命中即显示
      this.horizontalGuide.style.left = '-4000px';
      this.horizontalGuide.style.width = '8000px';
      this.horizontalBadge.style.display = 'block';
      this.horizontalBadge.style.left = `${viewLeft + 6}px`;
      this.horizontalBadge.style.top = `${y - 10}px`;
      this.horizontalBadge.textContent = `y: ${Math.round(y)}`;
    }
  }

  private canvasMenu: HTMLDivElement | null = null;

  private onContextMenu(e: MouseEvent) {
    if (this.isTerminalInteractionTarget(e.target as HTMLElement)) return;
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

  private isTerminalInteractionTarget(target: HTMLElement | null): boolean {
    return !!target?.closest('.terminal-window, .terminal-file-panel, .terminal-unified-window, .terminal-unified-titlebar, .unified-ssh-menu');
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
