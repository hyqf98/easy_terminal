import { TerminalWindow } from './terminal-window';
import { CommandSuggest } from './command-suggest';
import { buildSshPasswordSequence, buildSshStartupCommand, resolveSshKeyPath } from './command-intercept';
import type { ShortcutManager } from './shortcut-manager';
import { Perf } from './perf';
import type {
  CanvasController,
  Rect,
  SSHProfile,
  SnapTarget,
  TerminalLaunchOptions,
  TerminalSessionState,
} from './types';

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
  private shortcutManager?: ShortcutManager;
  private activeInteractions = new Set<string>();
  private viewChangeRaf: number | null = null;

  /** Called when Ctrl+C successfully copies a terminal (for toast) */
  public onTerminalCopied: (() => void) | null = null;
  /** Called when text selection is auto-copied */
  public onTextCopied: (() => void) | null = null;
  public onActiveTerminalCwdChange: ((cwd: string) => void) | null = null;
  public onActiveTerminalChange: ((context: { cwd: string; launchOptions: TerminalLaunchOptions } | null) => void) | null = null;
  public onAddMappingFromSelection: ((text: string) => void) | null = null;

  constructor(
    canvasEl: HTMLElement,
    canvasController: CanvasController,
    commandSuggest: CommandSuggest,
    shortcutManager: ShortcutManager | undefined,
    private onCommandExecuted: ((command: string, cwd: string) => void | Promise<void>) | null = null
  ) {
    this.canvasEl = canvasEl;
    this.canvasController = canvasController;
    this.commandSuggest = commandSuggest;
    this.shortcutManager = shortcutManager;
  }

  async createTerminal(x: number, y: number, w: number, h: number, options: TerminalLaunchOptions = {}) {
    Perf.mark('manager.createTerminal');
    const launchOptions = await this.resolveLaunchOptionsAsync(options);
    Perf.mark('manager.createTerminal.initPty');
    const tw = new TerminalWindow(
      this.canvasEl,
      x,
      y,
      w,
      h,
      this.canvasController,
      this.commandSuggest,
      this.shortcutManager
    );
    await tw.initPty(launchOptions);
    Perf.end('manager.createTerminal.initPty');
    tw.onActivate = (id, options) => this.focusTerminal(id, options);
    tw.onCloseRequested = (id) => this.closeTerminal(id);
    tw.onCommandExecuted = (command, currentCwd) => this.onCommandExecuted?.(command, currentCwd);
    tw.onCwdChange = (cwd) => {
      if (this.activeId === tw.getId() && launchOptions.mode !== 'ssh') {
        this.onActiveTerminalCwdChange?.(cwd);
      }
      if (this.activeId === tw.getId()) {
        this.onActiveTerminalChange?.({
          cwd,
          launchOptions: tw.getLaunchOptions(),
        });
      }
    };
    tw.onAddMappingFromSelection = (text) => this.onAddMappingFromSelection?.(text);
    tw.onSelectionCopied = () => this.onTextCopied?.();
    tw.onInteractionStart = (id) => this.beginTerminalInteraction(id);
    tw.onInteractionEnd = (id) => this.endTerminalInteraction(id);

    this.terminals.set(tw.getId(), tw);
    this.focusTerminal(tw.getId());
    Perf.end('manager.createTerminal');
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

  alignAll(canvasRect: { w: number; h: number }) {
    const ids = [...this.terminals.keys()];
    if (ids.length === 0) return;

    const count = ids.length;
    const padding = 20;
    const gap = 16;
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    const cellW = (canvasRect.w - padding * 2 - gap * (cols - 1)) / cols;
    const cellH = (canvasRect.h - padding * 2 - gap * (rows - 1)) / rows;
    const w = Math.max(280, cellW);
    const h = Math.max(180, cellH);

    ids.forEach((id, index) => {
      const tw = this.terminals.get(id);
      if (!tw) return;
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = padding + col * (w + gap);
      const y = padding + row * (h + gap);
      tw.setRect(x, y, w, h);
    });
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

  focusTerminal(id: string, options?: { focusInput?: boolean; pulse?: boolean; syncContext?: boolean }) {
    const shouldSyncContext = options?.syncContext ?? true;
    // Blur previous
    if (this.activeId && this.activeId !== id) {
      const prev = this.terminals.get(this.activeId);
      if (prev) prev.blur();
    }
    this.activeId = id;
    const tw = this.terminals.get(id);
    if (tw) {
      tw.setZIndex(++this.zCounter);
      tw.focus(options);
      if (shouldSyncContext) {
        if (tw.getLaunchOptions().mode !== 'ssh') {
          this.onActiveTerminalCwdChange?.(tw.getCwd());
        }
        this.onActiveTerminalChange?.({
          cwd: tw.getCwd(),
          launchOptions: tw.getLaunchOptions(),
        });
      }
    }
  }

  blurActive() {
    if (this.activeId) {
      const tw = this.terminals.get(this.activeId);
      if (tw) {
        tw.hideTransientUi();
        tw.blur();
      }
      this.activeId = null;
      this.onActiveTerminalCwdChange?.('');
      this.onActiveTerminalChange?.(null);
    }
  }

  hideTransientUi() {
    for (const [, tw] of this.terminals) {
      tw.hideTransientUi();
    }
  }

  freezeAllExcept(excludeId?: string) {
    for (const [id, tw] of this.terminals) {
      if (id !== excludeId) tw.freeze();
    }
  }

  freezeAll() {
    for (const [, tw] of this.terminals) {
      tw.freeze();
    }
  }

  freezeTerminal(id: string) {
    const tw = this.terminals.get(id);
    if (tw) tw.freeze();
  }

  thawAll() {
    for (const [, tw] of this.terminals) {
      tw.thaw();
    }
  }

  thawTerminal(id: string) {
    const tw = this.terminals.get(id);
    if (tw) tw.thaw();
  }

  private beginTerminalInteraction(id: string) {
    if (!id || this.activeInteractions.has(id)) return;
    this.activeInteractions.add(id);
    this.freezeTerminal(id);
  }

  private endTerminalInteraction(id: string) {
    if (!id || !this.activeInteractions.has(id)) return;
    this.activeInteractions.delete(id);
    this.thawTerminal(id);
  }

  getActiveId(): string | null {
    return this.activeId;
  }

  async debugSetFocusedInput(value: string): Promise<boolean> {
    if (!this.activeId) return false;
    const tw = this.terminals.get(this.activeId);
    if (!tw) return false;
    await tw.debugSetInput(value);
    return true;
  }

  async debugHandleFocusedSuggestionKey(key: string): Promise<boolean> {
    if (!this.activeId) return false;
    const tw = this.terminals.get(this.activeId);
    if (!tw) return false;
    return tw.debugHandleSuggestionKey(key);
  }

  async debugRefreshFocusedSuggestions() {
    if (!this.activeId) return null;
    const tw = this.terminals.get(this.activeId);
    return tw ? tw.debugRefreshSuggestions() : null;
  }

  async debugSubmitFocusedInput(): Promise<boolean> {
    if (!this.activeId) return false;
    const tw = this.terminals.get(this.activeId);
    return tw ? tw.debugSubmitCurrentInput() : false;
  }

  getFocusedSuggestionState() {
    if (!this.activeId) return null;
    const tw = this.terminals.get(this.activeId);
    return tw ? tw.getSuggestionDebugState() : null;
  }

  getTerminalStates(): TerminalSessionState[] {
    const states: TerminalSessionState[] = [];
    for (const [, tw] of this.terminals) {
      if (tw.isWindowMinimized()) continue;
      const rect = tw.getRect();
      const opts = tw.getLaunchOptions();
      if (rect.w <= 200 && rect.h <= 100 && opts.mode !== 'ssh') continue;
      states.push({
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        title: tw.getTitle(),
        cwd: tw.getCwd(),
        minimized: false,
        maximized: tw.isWindowMaximized(),
        launchOptions: this.cloneLaunchOptions(opts),
      });
    }
    return states;
  }

  async restoreTerminalSession(session: TerminalSessionState) {
    const launchOptions = await this.resolveRestoreLaunchOptions(session);
    await this.createTerminal(session.x, session.y, session.w, session.h, launchOptions);
    const active = this.activeId ? this.terminals.get(this.activeId) : null;
    if (!active) return;

    if (session.minimized) {
      active.toggleMinimize();
    }
    if (session.maximized) {
      active.toggleMaximize();
    }
  }

  /** Copy the active terminal's info (cwd, w, h) */
  copyActiveTerminal(): boolean {
    if (!this.activeId) return false;
    const tw = this.terminals.get(this.activeId);
    if (!tw) return false;
    const rect = tw.getRect();
    this.copiedInfo = {
      launchOptions: this.cloneLaunchOptions(tw.getLaunchOptions()),
      w: rect.w,
      h: rect.h,
    };
    return true;
  }

  /** Paste (create) a new terminal at given canvas coordinates */
  async pasteTerminal(canvasX: number, canvasY: number) {
    if (!this.copiedInfo) return;
    const { launchOptions, w, h } = this.copiedInfo;
    await this.createTerminal(canvasX, canvasY, w, h, this.cloneLaunchOptions(launchOptions));
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
    let resolvedKeyPath: string | undefined;
    if (profile.authType === 'key' && profile.privateKeyPath) {
      resolvedKeyPath = await resolveSshKeyPath(profile.privateKeyPath);
    }
    await this.createTerminal(x, y, w, h, {
      mode: 'ssh',
      profileId: profile.id,
      profileName: profile.name,
      startupCommand: buildSshStartupCommand(profile, this.sshProfiles, resolvedKeyPath),
      passwordSequence: buildSshPasswordSequence(profile, this.sshProfiles),
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

  handleCanvasViewChange() {
    if (this.viewChangeRaf !== null) return;
    this.viewChangeRaf = window.requestAnimationFrame(() => {
      this.viewChangeRaf = null;
      for (const [, tw] of this.terminals) {
        tw.handleCanvasViewChange();
      }
    });
  }

  private async resolveLaunchOptionsAsync(options: TerminalLaunchOptions): Promise<TerminalLaunchOptions> {
    if (options.mode === 'ssh' || options.startupCommand) {
      return { ...options, mode: 'ssh' };
    }

    if (!options.cwd && this.pendingSshProfile) {
      let resolvedKeyPath: string | undefined;
      if (this.pendingSshProfile.authType === 'key' && this.pendingSshProfile.privateKeyPath) {
        resolvedKeyPath = await resolveSshKeyPath(this.pendingSshProfile.privateKeyPath);
      }
      return {
        mode: 'ssh',
        profileId: this.pendingSshProfile.id,
        profileName: this.pendingSshProfile.name,
        startupCommand: buildSshStartupCommand(this.pendingSshProfile, this.sshProfiles, resolvedKeyPath),
      };
    }

    return {
      mode: 'local',
      ...options,
    };
  }

  private cloneLaunchOptions(options: TerminalLaunchOptions): TerminalLaunchOptions {
    return {
      ...options,
      passwordSequence: options.passwordSequence ? [...options.passwordSequence] : undefined,
    };
  }

  private async resolveRestoreLaunchOptions(session: TerminalSessionState): Promise<TerminalLaunchOptions> {
    const options = session.launchOptions || {};
    if (options.mode === 'ssh' && options.profileId) {
      const profile = this.sshProfiles.find((item) => item.id === options.profileId);
      if (profile) {
        let resolvedKeyPath: string | undefined;
        if (profile.authType === 'key' && profile.privateKeyPath) {
          resolvedKeyPath = await resolveSshKeyPath(profile.privateKeyPath);
        }
        return {
          mode: 'ssh',
          profileId: profile.id,
          profileName: profile.name,
          startupCommand: buildSshStartupCommand(profile, this.sshProfiles, resolvedKeyPath),
          passwordSequence: buildSshPasswordSequence(profile, this.sshProfiles),
        };
      }
    }

    return {
      mode: 'local',
      cwd: session.cwd || options.cwd,
    };
  }
}
