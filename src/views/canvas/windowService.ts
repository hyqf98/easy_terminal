import { invoke } from '@tauri-apps/api/core';
import type { Rect } from '../../types';

export const windowService = {
  openDesktopDrawWindow: () =>
    invoke('open_desktop_draw_window'),

  createDetachedTerminalWindow: (x: number, y: number, w: number, h: number) =>
    invoke('create_detached_terminal_window', { x, y, w, h }),

  syncDesktopDrawShortcut: (shortcut: string) =>
    invoke('sync_desktop_draw_shortcut', { shortcut }),

  getNativeWindowRect: (label: string) =>
    invoke<Rect>('get_native_window_rect', { label }),

  updateNativeWindowRect: (label: string, rect: Rect) =>
    invoke('update_native_window_rect', { label, rect }),
};
