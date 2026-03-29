import { TerminalWindow } from './terminal-window';
import { CommandSuggest } from './command-suggest';
import { buildSshStartupCommand } from './command-intercept';
import type { CanvasController, Rect, SSHProfile, SnapTarget, TerminalLaunchOptions } from './types';

export class TerminalManager {
  private terminals: Map<string, TerminalWindow> = new Map();
  private canvasEl: HTMLElement;
  private canvasController: CanvasController;
  private commandSuggest: CommandSuggest;
  private activeId: string | null = null;
  private copiedInfo: { launchOptions: TerminalLaunchOptions; w: number; h: number } | null = null;
  private canvasMouseX = 0;
  private canvasMouseY = 0;
  private hasCanvasMouse = false;
  private zCounter = 1;
  private pendingSshProfile: SSHProfile | null = null;
  private sshProfiles: SSHProfile[] = [];

  /** Called when Ctrl+C successfully copies a terminal (for toast) */
  public onTerminalCopied: (() => void) | null = null;

  constructor(
    canvasEl: HTMLElement,
    canvasController: CanvasController,
    commandSuggest: CommandSuggest,
    private onCommandExecuted: ((command: string, cwd: string) => void | Promise<void>) | null = null
  ) {
    this.canvasEl = canvasEl;
    this.canvasController = canvasController;
    this.commandSuggest = commandSuggest;
  }

  async createTerminal(x: number, y: number, w: number, h: number, options: TerminalLaunchOptions = {}) {
    const launchOptions = this.resolveLaunchOptions(options);
    const tw = new TerminalWindow(
      this.canvasEl,
      x,
      y,
      w,
      h,
      this.canvasController,
      this.commandSuggest
    );
    await tw.initPty(launchOptions);
    tw.onActivate = (id) => this.focusTerminal(id);
    tw.onCommandExecuted = (command, currentCwd) => this.onCommandExecuted?.(command, currentCwd);

    this.terminals.set(tw.getId(), tw);
    this.focusTerminal(tw.getId());
  }

  async createTerminalAt(x: number, y: number, w: number, h: number, dirPath: string) {
    await this.createTerminal(x, y, w, h, { cwd: dirPath, mode: 'local' });
  }

  async closeTerminal(id: string) {
    const tw = this.terminals.get(id);
    if (tw) {
      await tw.close();
      this.terminals.delete(id);
      if (this.activeId === id) {
        this.activeId = null;
      }
    }
  }

  async closeAll() {
    for (const [, tw] of this.terminals) {
      await tw.close();
    }
    this.terminals.clear();
    this.activeId = null;
  }

  getTerminalCount(): number {
    return this.terminals.size;
  }

  setThemeAll(theme: string) {
    for (const [, tw] of this.terminals) {
      tw.setTheme(theme);
    }
  }

  focusTerminal(id: string) {
    // Blur previous
    if (this.activeId && this.activeId !== id) {
      const prev = this.terminals.get(this.activeId);
      if (prev) prev.blur();
    }
    this.activeId = id;
    const tw = this.terminals.get(id);
    if (tw) {
      tw.setZIndex(++this.zCounter);
      tw.focus();
    }
  }

  blurActive() {
    if (this.activeId) {
      const tw = this.terminals.get(this.activeId);
      if (tw) tw.blur();
      this.activeId = null;
    }
  }

  getActiveId(): string | null {
    return this.activeId;
  }

  getTerminalStates(): Array<{ id: string; x: number; y: number; w: number; h: number; title: string; cwd: string }> {
    const states: Array<{ id: string; x: number; y: number; w: number; h: number; title: string; cwd: string }> = [];
    for (const [id, tw] of this.terminals) {
      const rect = tw.getRect();
      states.push({
        id,
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        title: tw.getTitle(),
        cwd: tw.getCwd(),
      });
    }
    return states;
  }

  /** Copy the active terminal's info (cwd, w, h) */
  copyActiveTerminal(): boolean {
    if (!this.activeId) return false;
    const tw = this.terminals.get(this.activeId);
    if (!tw) return false;
    const rect = tw.getRect();
    this.copiedInfo = {
      launchOptions: tw.getLaunchOptions(),
      w: rect.w,
      h: rect.h,
    };
    return true;
  }

  /** Paste (create) a new terminal at given canvas coordinates */
  async pasteTerminal(canvasX: number, canvasY: number) {
    if (!this.copiedInfo) return;
    const { launchOptions, w, h } = this.copiedInfo;
    await this.createTerminal(canvasX, canvasY, w, h, launchOptions);
  }

  hasCopiedTerminal(): boolean {
    return this.copiedInfo !== null;
  }

  /** Update the tracked mouse position on the canvas */
  setCanvasMousePos(x: number, y: number) {
    this.canvasMouseX = x;
    this.canvasMouseY = y;
    this.hasCanvasMouse = true;
  }

  getCanvasMousePos(): { x: number; y: number } {
    return { x: this.canvasMouseX, y: this.canvasMouseY };
  }

  getPastePosition(): { x: number; y: number } {
    if (this.hasCanvasMouse) {
      return this.getCanvasMousePos();
    }
    const rect = this.getActiveRect();
    if (rect) {
      return { x: rect.x + 32, y: rect.y + 32 };
    }
    return { x: 80, y: 80 };
  }

  getActiveRect(): Rect | null {
    if (!this.activeId) return null;
    const tw = this.terminals.get(this.activeId);
    return tw ? tw.getRect() : null;
  }

  async sendCommandToActiveTerminal(command: string): Promise<boolean> {
    if (!this.activeId) return false;
    const tw = this.terminals.get(this.activeId);
    if (!tw) return false;
    await tw.sendText(command);
    return true;
  }

  setPendingSshProfile(profile: SSHProfile | null) {
    this.pendingSshProfile = profile;
  }

  setSshProfiles(profiles: SSHProfile[]) {
    this.sshProfiles = profiles.map((profile) => ({ ...profile }));
  }

  getPendingSshProfile(): SSHProfile | null {
    return this.pendingSshProfile ? { ...this.pendingSshProfile } : null;
  }

  async createSshTerminal(profile: SSHProfile, x = 80, y = 80, w = 760, h = 480) {
    await this.createTerminal(x, y, w, h, {
      mode: 'ssh',
      profileId: profile.id,
      profileName: profile.name,
      startupCommand: buildSshStartupCommand(profile, this.sshProfiles),
    });
  }

  getSnapTargets(excludeId?: string): SnapTarget[] {
    const targets: SnapTarget[] = [];
    for (const [id, tw] of this.terminals) {
      if (excludeId && id === excludeId) continue;
      const rect = tw.getRect();
      targets.push({ id, ...rect });
    }
    return targets;
  }

  private resolveLaunchOptions(options: TerminalLaunchOptions): TerminalLaunchOptions {
    if (options.mode === 'ssh' || options.startupCommand) {
      return { ...options, mode: 'ssh' };
    }

    if (!options.cwd && this.pendingSshProfile) {
      return {
        mode: 'ssh',
        profileId: this.pendingSshProfile.id,
        profileName: this.pendingSshProfile.name,
        startupCommand: buildSshStartupCommand(this.pendingSshProfile, this.sshProfiles),
      };
    }

    return {
      mode: 'local',
      ...options,
    };
  }
}
