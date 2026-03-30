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
}

export interface SnapPoint {
  x: number;
  y: number;
}

export interface CanvasController {
  getState(): CanvasState;
  snapPoint(x: number, y: number, sourceId?: string): SnapPoint;
  snapRect(rect: Rect, options: SnapOptions): Rect;
  clearGuides(): void;
}

export interface CommandEntry {
  name: string;
  alias: string[];
  name_cn: string;
  description: string;
  usage: string;
  category: string;
  command: string;
  tags: string[];
  examples: string[];
  hint?: string;
}

export interface CommandConfig {
  id: string;
  kind: string;
  platforms: string[];
  commands: CommandEntry[];
  platform: string;
}

export interface CommandHistoryEntry {
  id: string;
  command: string;
  cwd: string;
  timestamp: number;
  count: number;
}

export interface CommandMapping {
  id: string;
  trigger: string;
  command: string;
  description: string;
  tags: string[];
  examples: string[];
  hint?: string;
  enabled: boolean;
}

export interface SSHProfile {
  id: string;
  name: string;
  group: string;
  host: string;
  port: number;
  user: string;
  jumpProfileId: string;
  authType: 'password' | 'key';
  password: string;
  privateKeyPath: string;
}

export interface TerminalLaunchOptions {
  cwd?: string;
  startupCommand?: string;
  mode?: 'local' | 'ssh';
  profileName?: string;
  profileId?: string;
}

export interface FilePreviewData {
  path: string;
  language: string;
  content: string;
  truncated: boolean;
  size: number;
}

export interface ShortcutBinding {
  id: string;
  label: string;
  description: string;
  windows: string;
  darwin: string;
  linux: string;
}

export type SuggestionSourceType = 'command' | 'mapping' | 'history';

export interface SuggestionItem {
  id: string;
  type: SuggestionSourceType;
  title: string;
  subtitle: string;
  description: string;
  insertText: string;
  executeText: string;
  usage: string;
  hint?: string;
  examples: string[];
  aliases: string[];
  tags: string[];
  category: string;
  sourceLabel: string;
  score: number;
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
