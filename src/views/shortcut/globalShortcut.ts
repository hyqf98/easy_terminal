import { invoke } from '@tauri-apps/api/core';
import type { ShortcutManager } from './shortcutManager';

export function setupDesktopDrawShortcut(shortcutManager: ShortcutManager) {
  let syncedShortcut = '';

  const sync = async () => {
    const next = shortcutManager.getBindingLabel('desktop.drawTerminal').trim();
    if (syncedShortcut === next) return;

    const previous = syncedShortcut;
    syncedShortcut = next;

    try {
      const registered = await invoke<string | null>('sync_desktop_draw_shortcut', { shortcut: next });
      if (registered) {
        console.info('desktop draw shortcut registered', registered);
      } else if (next) {
        console.warn('desktop draw shortcut registration failed', next);
      }
    } catch (error) {
      syncedShortcut = previous;
      console.error('sync desktop draw shortcut failed', error);
    }
  };

  void sync();
  return shortcutManager.onChange(() => {
    void sync();
  });
}
