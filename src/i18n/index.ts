export type Lang = 'zh-CN' | 'en-US';

import zhCN from './zhCN';
import enUS from './enUS';

type Listener = () => void;

let currentLang: Lang = 'zh-CN';
const listeners: Set<Listener> = new Set();

const messages: Record<Lang, Record<string, string>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

/**
 * Translate a key with optional interpolation params.
 * Usage: t('cmd.loaded', '42') → "已加载 42 条命令" / "Loaded 42 commands"
 */
export function t(key: string, ...args: string[]): string {
  let str = messages[currentLang]?.[key] || messages['zh-CN']?.[key] || key;
  args.forEach((arg, i) => {
    str = str.replace(`{${i}}`, arg);
  });
  return str;
}

export function setLang(lang: Lang): void {
  if (lang === currentLang) return;
  currentLang = lang;
  listeners.forEach((fn) => fn());
}

export function getLang(): Lang {
  return currentLang;
}

export function onLangChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
