import type { CanvasController, CanvasState, Rect, SnapOptions, SnapPoint, SnapTarget } from './types';

export class Canvas implements CanvasController {
  private viewport: HTMLDivElement;
  private canvasEl: HTMLDivElement;
  private selectionRect: HTMLDivElement;
  private verticalGuide: HTMLDivElement;
  private horizontalGuide: HTMLDivElement;

  private panX = 0;
  private panY = 0;
  private zoom = 1.0;

  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;

  public onTerminalCreate?: (x: number, y: number, w: number, h: number) => void;
  public getSnapTargets: ((excludeId?: string) => SnapTarget[]) | null = null;

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
    this.bindEvents();
  }

  getState(): CanvasState {
    return {
      panX: this.panX,
      panY: this.panY,
      zoom: this.zoom,
    };
  }

  getZoom(): number {
    return this.zoom;
  }

  getPan(): { x: number; y: number } {
    return { x: this.panX, y: this.panY };
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

    this.updateGuides(guideX, guideY);
    return next;
  }

  clearGuides(): void {
    this.verticalGuide.style.display = 'none';
    this.horizontalGuide.style.display = 'none';
  }

  private bindEvents() {
    this.viewport.addEventListener('wheel', this.onWheel.bind(this), { passive: false });
    this.viewport.addEventListener('mousedown', this.onMouseDown.bind(this));
    window.addEventListener('mousemove', this.onMouseMove.bind(this));
    window.addEventListener('mouseup', this.onMouseUp.bind(this));
  }

  private createGuide(kind: 'vertical' | 'horizontal'): HTMLDivElement {
    const el = document.createElement('div');
    el.className = `canvas-guide ${kind}`;
    this.canvasEl.appendChild(el);
    return el;
  }

  private onWheel(e: WheelEvent) {
    if ((e.target as HTMLElement).closest('.json-editor-overlay')) return;
    e.preventDefault();
    if (e.shiftKey) {
      this.panX -= e.deltaY;
    } else if (e.ctrlKey) {
      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      this.zoom = Math.max(0.2, Math.min(3.0, this.zoom + delta));
    } else {
      this.panY -= e.deltaY;
    }
    this.applyTransform();
  }

  private onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.terminal-window')) return;

    this.isDragging = true;
    const rect = this.viewport.getBoundingClientRect();
    this.dragStartX = (e.clientX - rect.left - this.panX) / this.zoom;
    this.dragStartY = (e.clientY - rect.top - this.panY) / this.zoom;

    this.selectionRect.style.display = 'block';
    this.updateSelectionRect(this.dragStartX, this.dragStartY, 0, 0);
  }

  private onMouseMove(e: MouseEvent) {
    if (!this.isDragging) return;
    const rect = this.viewport.getBoundingClientRect();
    const currentX = (e.clientX - rect.left - this.panX) / this.zoom;
    const currentY = (e.clientY - rect.top - this.panY) / this.zoom;
    const snapped = this.snapPoint(currentX, currentY);

    const x = Math.min(this.dragStartX, snapped.x);
    const y = Math.min(this.dragStartY, snapped.y);
    const w = Math.abs(snapped.x - this.dragStartX);
    const h = Math.abs(snapped.y - this.dragStartY);

    this.updateSelectionRect(x, y, w, h);
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
    this.canvasEl.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
  }

  private collectCandidates(excludeId?: string): { vertical: number[]; horizontal: number[] } {
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

    return {
      vertical: [...vertical],
      horizontal: [...horizontal],
    };
  }

  private findClosest(value: number, candidates: number[]): { value: number; guide: number | null } {
    const threshold = 10 / this.zoom;
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

  private updateGuides(x: number | null, y: number | null) {
    if (x === null) {
      this.verticalGuide.style.display = 'none';
    } else {
      this.verticalGuide.style.display = 'block';
      this.verticalGuide.style.left = `${x}px`;
    }

    if (y === null) {
      this.horizontalGuide.style.display = 'none';
    } else {
      this.horizontalGuide.style.display = 'block';
      this.horizontalGuide.style.top = `${y}px`;
    }
  }
}
