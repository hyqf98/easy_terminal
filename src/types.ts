export interface CanvasState {
  panX: number;
  panY: number;
  zoom: number;
}

export interface TerminalInstance {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  maximized: boolean;
  savedRect?: { x: number; y: number; width: number; height: number };
}

export interface PtyOutputEvent {
  session_id: string;
  data: string;
}
