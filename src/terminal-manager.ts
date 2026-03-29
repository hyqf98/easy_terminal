import { TerminalWindow } from './terminal-window';
import { CommandSuggest } from './command-suggest';
import type { CanvasState } from './types';

export class TerminalManager {
  private terminals: Map<string, TerminalWindow> = new Map();
  private canvasEl: HTMLElement;
  private getCanvasState: () => CanvasState;
  private commandSuggest: CommandSuggest;

  constructor(
    canvasEl: HTMLElement,
    getCanvasState: () => CanvasState,
    commandSuggest: CommandSuggest
  ) {
    this.canvasEl = canvasEl;
    this.getCanvasState = getCanvasState;
    this.commandSuggest = commandSuggest;
  }

  async createTerminal(x: number, y: number, w: number, h: number, cwd?: string) {
    const tw = new TerminalWindow(
      this.canvasEl,
      x,
      y,
      w,
      h,
      this.getCanvasState,
      this.commandSuggest
    );
    await tw.initPty(cwd);
    tw.focus();
    this.terminals.set(tw.getId(), tw);
  }

  async createTerminalAt(x: number, y: number, w: number, h: number, dirPath: string) {
    await this.createTerminal(x, y, w, h, dirPath);
  }

  async closeTerminal(id: string) {
    const tw = this.terminals.get(id);
    if (tw) {
      await tw.close();
      this.terminals.delete(id);
    }
  }

  async closeAll() {
    for (const [, tw] of this.terminals) {
      await tw.close();
    }
    this.terminals.clear();
  }

  getTerminalCount(): number {
    return this.terminals.size;
  }
}
