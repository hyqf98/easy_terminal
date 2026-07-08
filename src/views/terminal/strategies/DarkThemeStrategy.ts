import type { ITerminalThemeStrategy, ITerminalTheme } from './TerminalThemeStrategy';

export class DarkThemeStrategy implements ITerminalThemeStrategy {
  readonly name = 'dark';

  getTheme(): ITerminalTheme {
    return {
      background: '#1a1b2e',
      foreground: '#a9b1d6',
      cursor: '#c0caf5',
      selectionBackground: 'rgba(122, 162, 247, 0.28)',
      black: '#15161e',
      red: '#f7768e',
      green: '#9ece6a',
      yellow: '#e0af68',
      blue: '#7aa2f7',
      magenta: '#bb9af7',
      cyan: '#7dcfff',
      white: '#a9b1d6',
      brightBlack: '#414868',
      brightRed: '#f7768e',
      brightGreen: '#9ece6a',
      brightYellow: '#e0af68',
      brightBlue: '#7aa2f7',
      brightMagenta: '#bb9af7',
      brightCyan: '#7dcfff',
      brightWhite: '#c0caf5',
    };
  }
}
