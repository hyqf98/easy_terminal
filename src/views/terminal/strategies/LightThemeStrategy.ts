import type { ITerminalThemeStrategy, ITerminalTheme } from './TerminalThemeStrategy';

export class LightThemeStrategy implements ITerminalThemeStrategy {
  readonly name = 'light';

  getTheme(): ITerminalTheme {
    return {
      background: '#f7f9fc',
      foreground: '#24324a',
      cursor: '#2563eb',
      selectionBackground: 'rgba(37, 99, 235, 0.17)',
      black: '#24324a',
      red: '#c2414f',
      green: '#26835c',
      yellow: '#a76312',
      blue: '#2563eb',
      magenta: '#8b45c7',
      cyan: '#087f8c',
      white: '#b8c2d6',
      brightBlack: '#60708d',
      brightRed: '#e05a68',
      brightGreen: '#3ba477',
      brightYellow: '#c98122',
      brightBlue: '#4c82ed',
      brightMagenta: '#a970d8',
      brightCyan: '#1d9dad',
      brightWhite: '#dce3ef',
    };
  }
}
