import { invoke } from '@tauri-apps/api/core';
import { setLang, type Lang } from './i18n';

interface StoredSettings {
  theme: string;
  language: string;
}

export async function applyStoredAppearance() {
  try {
    const settings = await invoke<StoredSettings>('get_settings');
    document.documentElement.setAttribute('data-theme', settings.theme || 'light');
    if (settings.language) {
      setLang(settings.language as Lang);
    }
  } catch {
    document.documentElement.setAttribute('data-theme', 'light');
  }
}
