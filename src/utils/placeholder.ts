import type { ParsedPlaceholders, PlaceholderInfo } from '../types';

const BRACKET_PLACEHOLDER_RE = /\[%s(?::([^\]]+))?\]/g;
const ANGLE_PLACEHOLDER_RE = /<(\w[\w.-]*)>/g;

interface RawMatch {
  index: number;
  length: number;
  label: string;
}

function collectMatches(template: string): RawMatch[] {
  const matches: RawMatch[] = [];

  BRACKET_PLACEHOLDER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BRACKET_PLACEHOLDER_RE.exec(template)) !== null) {
    matches.push({ index: m.index, length: m[0].length, label: m[1] || '' });
  }

  ANGLE_PLACEHOLDER_RE.lastIndex = 0;
  while ((m = ANGLE_PLACEHOLDER_RE.exec(template)) !== null) {
    // Skip matches that overlap with already-found bracket placeholders
    const start = m.index;
    const end = start + m[0].length;
    const overlaps = matches.some(
      (existing) => start < existing.index + existing.length && end > existing.index,
    );
    if (!overlaps) {
      matches.push({ index: m.index, length: m[0].length, label: m[1] });
    }
  }

  matches.sort((a, b) => a.index - b.index);
  return matches;
}

export function parsePlaceholders(template: string): ParsedPlaceholders {
  if (!template) {
    return { insertText: template, displayParts: [], placeholders: [], hasPlaceholders: false };
  }

  const hasBracket = template.includes('[%s');
  const hasAngle = /<\w[\w.-]*>/.test(template);
  if (!hasBracket && !hasAngle) {
    return { insertText: template, displayParts: [], placeholders: [], hasPlaceholders: false };
  }

  const rawMatches = collectMatches(template);
  if (rawMatches.length === 0) {
    return { insertText: template, displayParts: [], placeholders: [], hasPlaceholders: false };
  }

  const placeholders: PlaceholderInfo[] = [];
  const displayParts: Array<{ text: string; isPlaceholder: boolean; label: string }> = [];
  let insertText = '';
  let lastIndex = 0;

  for (let i = 0; i < rawMatches.length; i++) {
    const raw = rawMatches[i];
    const before = template.slice(lastIndex, raw.index);

    if (before) {
      insertText += before;
      displayParts.push({ text: before, isPlaceholder: false, label: '' });
    }

    const pos = insertText.length;
    placeholders.push({
      index: i,
      position: pos,
      originalLength: raw.length,
      label: raw.label,
    });
    displayParts.push({ text: '', isPlaceholder: true, label: raw.label });

    lastIndex = raw.index + raw.length;
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
  return text != null && (text.includes('[%s') || /<\w[\w.-]*>/.test(text));
}
