import type { ITerminalThemeStrategy, ITerminalTheme } from './TerminalThemeStrategy';

export class WarmThemeStrategy implements ITerminalThemeStrategy {
  readonly name = 'warm';

  getTheme(): ITerminalTheme {
    return {
      background: '#fbf6ed',
      foreground: '#3a3028',
      cursor: '#b65e2e',
      selectionBackground: 'rgba(182, 94, 46, 0.18)',
      black: '#3a3028',
      red: '#b9483f',
      green: '#4e8655',
      yellow: '#a87511',
      blue: '#8b5dcb',
      magenta: '#a0447d',
      cyan: '#177e82',
      white: '#d7cab8',
      brightBlack: '#796b5b',
      brightRed: '#d55d52',
      brightGreen: '#68a16a',
      brightYellow: '#c69224',
      brightBlue: '#aa7ce3',
      brightMagenta: '#c269a0',
      brightCyan: '#32999a',
      brightWhite: '#f0e8dc',
    };
  }
}
