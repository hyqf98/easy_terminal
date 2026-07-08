import type { ITerminalThemeStrategy } from './TerminalThemeStrategy';
import { DarkThemeStrategy } from './DarkThemeStrategy';
import { LightThemeStrategy } from './LightThemeStrategy';
import { WarmThemeStrategy } from './WarmThemeStrategy';
import { CraftLightThemeStrategy, CraftDarkThemeStrategy } from './CraftThemeStrategy';
import { migrateThemeId } from '../../../composables/useCraftTheme';

const strategies: Record<string, ITerminalThemeStrategy> = {
  'craft-light': new CraftLightThemeStrategy(),
  'craft-dark': new CraftDarkThemeStrategy(),
  dark: new CraftDarkThemeStrategy(),
  light: new CraftLightThemeStrategy(),
  warm: new CraftDarkThemeStrategy(),
  system: new CraftLightThemeStrategy(),
};

export function getTerminalThemeStrategy(theme: string): ITerminalThemeStrategy {
  const migrated = migrateThemeId(theme);
  if (migrated === 'craft-dark') return strategies['craft-dark'];
  if (migrated === 'craft-light') return strategies['craft-light'];
  if (migrated === 'system') {
    const isDark = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return isDark ? strategies['craft-dark'] : strategies['craft-light'];
  }
  return strategies[migrated] || strategies['craft-light'];
}

export { DarkThemeStrategy, LightThemeStrategy, WarmThemeStrategy, CraftLightThemeStrategy, CraftDarkThemeStrategy };
export type { ITerminalThemeStrategy, ITerminalTheme } from './TerminalThemeStrategy';
