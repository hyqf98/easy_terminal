export class Canvas {
  private viewport: HTMLDivElement;
  private canvasEl: HTMLDivElement;
  private selectionRect: HTMLDivElement;

  private panX = 0;
  private panY = 0;
  private zoom = 1.0;

  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;

  public onTerminalCreate?: (x: number, y: number, w: number, h: number) => void;

  constructor(
    viewport: HTMLDivElement,
    canvasEl: HTMLDivElement,
    selectionRect: HTMLDivElement
  ) {
    this.viewport = viewport;
    this.canvasEl = canvasEl;
    this.selectionRect = selectionRect;
    this.bindEvents();
  }

  private bindEvents() {
    this.viewport.addEventListener('wheel', this.onWheel.bind(this), { passive: false });
    this.viewport.addEventListener('mousedown', this.onMouseDown.bind(this));
    window.addEventListener('mousemove', this.onMouseMove.bind(this));
    window.addEventListener('mouseup', this.onMouseUp.bind(this));
  }

  private onWheel(e: WheelEvent) {
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

    const x = Math.min(this.dragStartX, currentX);
    const y = Math.min(this.dragStartY, currentY);
    const w = Math.abs(currentX - this.dragStartX);
    const h = Math.abs(currentY - this.dragStartY);

    this.updateSelectionRect(x, y, w, h);
  }

  private onMouseUp(e: MouseEvent) {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.selectionRect.style.display = 'none';

    const rect = this.viewport.getBoundingClientRect();
    const endX = (e.clientX - rect.left - this.panX) / this.zoom;
    const endY = (e.clientY - rect.top - this.panY) / this.zoom;

    const x = Math.min(this.dragStartX, endX);
    const y = Math.min(this.dragStartY, endY);
    const w = Math.abs(endX - this.dragStartX);
    const h = Math.abs(endY - this.dragStartY);

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

  getZoom(): number {
    return this.zoom;
  }

  getPan(): { x: number; y: number } {
    return { x: this.panX, y: this.panY };
  }
}
