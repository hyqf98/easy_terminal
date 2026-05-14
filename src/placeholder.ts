import type { ParsedPlaceholders, PlaceholderInfo } from './types';

const PLACEHOLDER_RE = /\[%s(?::([^\]]+))?\]/g;

export function parsePlaceholders(template: string): ParsedPlaceholders {
  if (!template || !template.includes('[%s')) {
    return { insertText: template, displayParts: [], placeholders: [], hasPlaceholders: false };
  }

  const placeholders: PlaceholderInfo[] = [];
  const displayParts: Array<{ text: string; isPlaceholder: boolean; label: string }> = [];
  let insertText = '';
  let lastIndex = 0;
  let phIndex = 0;
  let match: RegExpExecArray | null;

  PLACEHOLDER_RE.lastIndex = 0;
  while ((match = PLACEHOLDER_RE.exec(template)) !== null) {
    const label = match[1] || '';
    const before = template.slice(lastIndex, match.index);

    if (before) {
      insertText += before;
      displayParts.push({ text: before, isPlaceholder: false, label: '' });
    }

    const pos = insertText.length;
    placeholders.push({
      index: phIndex++,
      position: pos,
      originalLength: match[0].length,
      label,
    });
    displayParts.push({ text: '', isPlaceholder: true, label });

    lastIndex = match.index + match[0].length;
  }

  const remainder = template.slice(lastIndex);
  if (remainder) {
    insertText += remainder;
    displayParts.push({ text: remainder, isPlaceholder: false, label: '' });
  }

  return {
    insertText,
    displayParts,
    placeholders,
    hasPlaceholders: placeholders.length > 0,
  };
}

export function hasPlaceholder(text: string): boolean {
  return text != null && text.includes('[%s');
}
