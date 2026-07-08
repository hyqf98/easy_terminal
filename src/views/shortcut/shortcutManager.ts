import { invoke } from '@tauri-apps/api/core';
import type { ShortcutBinding } from '../../types';

type Listener = (bindings: ShortcutBinding[]) => void;

export class ShortcutManager {
  private platform: 'windows' | 'darwin' | 'linux' = 'windows';
  private bindings: ShortcutBinding[] = [];
  private listeners = new Set<Listener>();

  async init() {
    this.platform = await invoke<'windows' | 'darwin' | 'linux'>('get_os_platform');
    this.bindings = await invoke<ShortcutBinding[]>('load_shortcuts');
    this.emit();
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getBindings());
    return () => this.listeners.delete(listener);
  }

  getPlatform() {
    return this.platform;
  }

  getBindings(): ShortcutBinding[] {
    return this.bindings.map((binding) => ({ ...binding }));
  }

  async saveBindings(bindings: ShortcutBinding[]) {
    await invoke('save_shortcuts', { entries: bindings });
    this.bindings = bindings;
    this.emit();
  }

  async loadDefaultBindings(): Promise<ShortcutBinding[]> {
    return invoke<ShortcutBinding[]>('load_default_shortcuts');
  }

  matches(actionId: string, event: KeyboardEvent): boolean {
    const binding = this.bindings.find((item) => item.id === actionId);
    if (!binding) return false;
    return matchShortcut(resolvePlatformShortcut(binding, this.platform), event);
  }

  getBindingLabel(actionId: string): string {
    const binding = this.bindings.find((item) => item.id === actionId);
    return binding ? resolvePlatformShortcut(binding, this.platform) : '';
  }

  private emit() {
    const snapshot = this.getBindings();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}

export function resolvePlatformShortcut(binding: ShortcutBinding, platform: 'windows' | 'darwin' | 'linux'): string {
  if (platform === 'darwin') return binding.darwin;
  if (platform === 'linux') return binding.linux;
  return binding.windows;
}

export function matchShortcut(shortcut: string, event: KeyboardEvent): boolean {
  const normalized = shortcut.trim();
  if (!normalized) return false;
  const parts = normalized.split('+').map((part) => part.trim().toLowerCase()).filter(Boolean);
  const key = parts.pop();
  if (!key) return false;

  const wantsCtrl = parts.includes('ctrl');
  const wantsCmd = parts.includes('cmd') || parts.includes('meta');
  const wantsAlt = parts.includes('alt') || parts.includes('option');
  const wantsShift = parts.includes('shift');

  if (!!event.ctrlKey !== wantsCtrl) return false;
  if (!!event.metaKey !== wantsCmd) return false;
  if (!!event.altKey !== wantsAlt) return false;
  if (!!event.shiftKey !== wantsShift) return false;

  return normalizeKey(event.key) === normalizeKey(key);
}

export function formatShortcutFromEvent(event: KeyboardEvent): string {
  const key = formatShortcutKey(event.key);
  if (!key) return '';

  const parts: string[] = [];
  if (event.metaKey) parts.push('Cmd');
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(key);

  return parts.join('+');
}

function formatShortcutKey(value: string): string {
  const normalized = normalizeKey(value);
  if (['control', 'shift', 'alt', 'meta'].includes(normalized)) {
    return '';
  }

  const aliases: Record<string, string> = {
    escape: 'Escape',
    enter: 'Enter',
    tab: 'Tab',
    space: 'Space',
    arrowleft: 'Left',
    arrowright: 'Right',
    arrowup: 'Up',
    arrowdown: 'Down',
    backspace: 'Backspace',
    delete: 'Delete',
    home: 'Home',
    end: 'End',
    pagedown: 'PageDown',
    pageup: 'PageUp',
  };

  if (aliases[normalized]) {
    return aliases[normalized];
  }
  if (/^f\d{1,2}$/.test(normalized)) {
    return normalized.toUpperCase();
  }
  if (normalized.length === 1) {
    return normalized.toUpperCase();
  }

  return value.length === 1 ? value.toUpperCase() : value;
}

function normalizeKey(value: string): string {
  const normalized = value.toLowerCase();
  const aliases: Record<string, string> = {
    esc: 'escape',
    return: 'enter',
    cmd: 'meta',
    command: 'meta',
    option: 'alt',
    left: 'arrowleft',
    right: 'arrowright',
    up: 'arrowup',
    down: 'arrowdown',
  };
  return aliases[normalized] || normalized;
}
