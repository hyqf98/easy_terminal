import type { ITerminalThemeStrategy, ITerminalTheme } from './TerminalThemeStrategy';

export class LightThemeStrategy implements ITerminalThemeStrategy {
  readonly name = 'light';

  getTheme(): ITerminalTheme {
    return {
      background: '#ffffff',
      foreground: '#1d1d1f',
      cursor: '#3b82f6',
      selectionBackground: 'rgba(59, 130, 246, 0.16)',
      black: '#1d1d1f',
      red: '#ef4444',
      green: '#22c55e',
      yellow: '#eab308',
      blue: '#3b82f6',
      magenta: '#8b5cf6',
      cyan: '#06b6d4',
      white: '#737373',
      brightBlack: '#525252',
      brightRed: '#f87171',
      brightGreen: '#4ade80',
      brightYellow: '#facc15',
      brightBlue: '#60a5fa',
      brightMagenta: '#a78bfa',
      brightCyan: '#22d3ee',
      brightWhite: '#d4d4d4',
    };
  }
}
