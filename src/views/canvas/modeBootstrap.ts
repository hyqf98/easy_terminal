import { invoke } from '@tauri-apps/api/core';
import { setLang, type Lang } from '../../i18n';
import { migrateThemeId } from '../../composables/useCraftTheme';

interface StoredSettings {
  theme: string;
  language: string;
  uiFontSize?: number;
  termFontSize?: number;
}

function applyThemeAttribute(theme: string) {
  const migrated = migrateThemeId(theme);
  const isDark = migrated === 'craft-dark' ||
    (migrated === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', isDark ? 'craft-dark' : 'craft-light');
}

export async function applyStoredAppearance() {
  try {
    const settings = await invoke<StoredSettings>('get_settings');
    applyThemeAttribute(settings.theme || 'craft-light');
    document.documentElement.style.setProperty('--font-size-md', `${settings.uiFontSize ?? 13}px`);
    document.documentElement.style.setProperty('--term-font-size', `${settings.termFontSize ?? 15}px`);
    if (settings.language) {
      setLang(settings.language as Lang);
    }
  } catch {
    document.documentElement.setAttribute('data-theme', 'craft-light');
  }
}
