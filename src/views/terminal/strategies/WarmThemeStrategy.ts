import type { ITerminalThemeStrategy, ITerminalTheme } from './TerminalThemeStrategy';

export class WarmThemeStrategy implements ITerminalThemeStrategy {
  readonly name = 'warm';

  getTheme(): ITerminalTheme {
    return {
      background: '#faf8f5',
      foreground: '#2c2820',
      cursor: '#c2711e',
      selectionBackground: 'rgba(194, 113, 30, 0.16)',
      black: '#4a443a',
      red: '#c44830',
      green: '#5a9a3e',
      yellow: '#c49010',
      blue: '#c2711e',
      magenta: '#8b5cf6',
      cyan: '#2a8a7a',
      white: '#2c2820',
      brightBlack: '#7a7265',
      brightRed: '#d96040',
      brightGreen: '#6aad4e',
      brightYellow: '#daa520',
      brightBlue: '#c2711e',
      brightMagenta: '#a78bfa',
      brightCyan: '#30a090',
      brightWhite: '#1a1510',
    };
  }
}
