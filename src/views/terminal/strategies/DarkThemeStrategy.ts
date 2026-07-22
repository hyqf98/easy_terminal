import type { ITerminalThemeStrategy, ITerminalTheme } from './TerminalThemeStrategy';

export class DarkThemeStrategy implements ITerminalThemeStrategy {
  readonly name = 'dark';

  getTheme(): ITerminalTheme {
    return {
      background: '#151923',
      foreground: '#c8d3f5',
      cursor: '#82aaff',
      selectionBackground: 'rgba(130, 170, 255, 0.24)',
      black: '#11151d',
      red: '#ff757f',
      green: '#c3e88d',
      yellow: '#ffc777',
      blue: '#82aaff',
      magenta: '#c099ff',
      cyan: '#86e1fc',
      white: '#c8d3f5',
      brightBlack: '#5b6b93',
      brightRed: '#ff98a4',
      brightGreen: '#d6f5ae',
      brightYellow: '#ffda9b',
      brightBlue: '#a9c8ff',
      brightMagenta: '#d5b7ff',
      brightCyan: '#b4ebff',
      brightWhite: '#eef4ff',
    };
  }
}
