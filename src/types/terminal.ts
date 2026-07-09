export interface CanvasState {
  panX: number;
  panY: number;
  zoom: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SnapTarget extends Rect {
  id: string;
}

export interface SnapOptions {
  sourceId?: string;
  mode: 'drag' | 'resize';
  direction?: string;
  minW?: number;
  minH?: number;
}

export interface SnapPoint {
  x: number;
  y: number;
}

export interface CanvasController {
  getState(): CanvasState;
  setState?(state: Partial<CanvasState>): void;
  snapPoint(x: number, y: number, sourceId?: string): SnapPoint;
  snapRect(rect: Rect, options: SnapOptions): Rect;
  clearGuides(): void;
  refreshSnapTargets?(excludeId?: string): Promise<void>;
  getNativeWindowRect?(): Rect;
  updateNativeWindowRect?(rect: Rect): void;
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

export interface TerminalLaunchOptions {
  cwd?: string;
  startupCommand?: string;
  mode?: 'local' | 'ssh';
  profileName?: string;
  profileId?: string;
  passwordSequence?: string[];
  /** 启动 shell：'default' | 'bash' | 'zsh' | 'fish' 等，缺省由系统决定 */
  shell?: string;
}

export interface TerminalSessionState {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  cwd: string;
  minimized?: boolean;
  maximized?: boolean;
  launchOptions?: TerminalLaunchOptions;
}

export interface WorkspaceState {
  terminals: TerminalSessionState[];
  canvas: CanvasState;
  pendingSshProfileId: string;
  activeTerminalId: string;
}
