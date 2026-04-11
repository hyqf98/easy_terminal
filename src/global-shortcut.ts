import { invoke } from '@tauri-apps/api/core';
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';
import type { ShortcutManager } from './shortcut-manager';

function normalizeGlobalShortcut(shortcut: string): string {
  if (!shortcut.trim()) return '';

  return shortcut
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === 'cmd' || lower === 'meta' || lower === 'command') return 'Command';
      if (lower === 'ctrl' || lower === 'control') return 'Ctrl';
      if (lower === 'alt' || lower === 'option') return 'Alt';
      if (lower === 'shift') return 'Shift';
      if (lower === 'space') return 'Space';
      if (lower === 'left') return 'Left';
      if (lower === 'right') return 'Right';
      if (lower === 'up') return 'Up';
      if (lower === 'down') return 'Down';
      if (part.length === 1) return part.toUpperCase();
      return part;
    })
    .join('+');
}

export function setupDesktopDrawShortcut(shortcutManager: ShortcutManager) {
  let registered = '';
  let syncToken = 0;

  const sync = async () => {
    const token = ++syncToken;
    const next = normalizeGlobalShortcut(shortcutManager.getBindingLabel('desktop.drawTerminal'));
    if (registered === next) return;

    if (registered) {
      try {
        await unregister(registered);
      } catch (error) {
        console.error('unregister desktop draw shortcut failed', error);
      }
      if (token !== syncToken) return;
      registered = '';
    }

    if (!next) return;

    try {
      await register(next, () => {
        void invoke('open_desktop_draw_window').catch((error) => {
          console.error('open desktop draw window failed', error);
        });
      });
      if (token === syncToken) {
        registered = next;
      }
    } catch (error) {
      console.error('register desktop draw shortcut failed', error);
    }
  };

  void sync();
  return shortcutManager.onChange(() => {
    void sync();
  });
}
