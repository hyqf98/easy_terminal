import type { ITerminalThemeStrategy, ITerminalTheme } from './TerminalThemeStrategy';

/** Craft 亮色终端配色 */
export class CraftLightThemeStrategy implements ITerminalThemeStrategy {
  readonly name = 'craft-light';

  getTheme(): ITerminalTheme {
    return {
      background: '#f5f0e8',
      foreground: '#3d3832',
      cursor: '#c17f59',
      selectionBackground: 'rgba(193, 127, 89, 0.18)',
      black: '#3d3832',
      red: '#c45c5c',
      green: '#6b9e5a',
      yellow: '#d4a24a',
      blue: '#5a8ec4',
      magenta: '#9a7ab8',
      cyan: '#5a9e8f',
      white: '#e8e0d4',
      brightBlack: '#9a8f82',
      brightRed: '#d47070',
      brightGreen: '#7ab86a',
      brightYellow: '#e8b85a',
      brightBlue: '#6aa8d4',
      brightMagenta: '#b09ad0',
      brightCyan: '#6ab8a8',
      brightWhite: '#ffffff',
    };
  }
}

/** Craft 暗色终端配色 */
export class CraftDarkThemeStrategy implements ITerminalThemeStrategy {
  readonly name = 'craft-dark';

  getTheme(): ITerminalTheme {
    return {
      background: '#252220',
      foreground: '#e8e0d4',
      cursor: '#d4956a',
      selectionBackground: 'rgba(212, 149, 106, 0.24)',
      black: '#252220',
      red: '#e07070',
      green: '#7ab86a',
      yellow: '#d4a24a',
      blue: '#6aa8d4',
      magenta: '#b09ad0',
      cyan: '#6ab8a8',
      white: '#e8e0d4',
      brightBlack: '#9a8f82',
      brightRed: '#f09090',
      brightGreen: '#8ac87a',
      brightYellow: '#e8c06a',
      brightBlue: '#c0b0e0',
      brightMagenta: '#d0b8f0',
      brightCyan: '#80d0c0',
      brightWhite: '#faf7f2',
    };
  }
}
