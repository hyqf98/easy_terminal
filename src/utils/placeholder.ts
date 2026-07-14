import type { ParsedPlaceholders, PlaceholderInfo } from '../types';

const BRACKET_PLACEHOLDER_RE = /\[%s(?::([^\]]+))?\]/g;
const ANGLE_PLACEHOLDER_RE = /<(\w[\w.-]*)>/g;
const CURLY_PLACEHOLDER_RE = /\{(\w[\w.-]*)\}/g;

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
    const label = m[1] || '';
    matches.push({ index: m.index, length: m[0].length, label });
  }

  ANGLE_PLACEHOLDER_RE.lastIndex = 0;
  while ((m = ANGLE_PLACEHOLDER_RE.exec(template)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    const overlaps = matches.some(
      (existing) => start < existing.index + existing.length && end > existing.index,
    );
    if (!overlaps) {
      matches.push({ index: m.index, length: m[0].length, label: m[1] });
    }
  }

  CURLY_PLACEHOLDER_RE.lastIndex = 0;
  while ((m = CURLY_PLACEHOLDER_RE.exec(template)) !== null) {
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
  const hasCurly = /\{\w[\w.-]*\}/.test(template);
  if (!hasBracket && !hasAngle && !hasCurly) {
    return { insertText: template, displayParts: [], placeholders: [], hasPlaceholders: false };
  }

  const rawMatches = collectMatches(template);
  if (rawMatches.length === 0) {
    return { insertText: template, displayParts: [], placeholders: [], hasPlaceholders: false };
  }

  const placeholders: PlaceholderInfo[] = [];
  const displayParts: Array<{ text: string; isPlaceholder: boolean; label: string }> = [];
  // Keep the placeholder tokens in insertText so the user can see and replace them
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
    const token = template.slice(raw.index, raw.index + raw.length);
    insertText += token;
    placeholders.push({
      index: i,
      position: pos,
      originalLength: raw.length,
      length: raw.length,
      label: raw.label,
      token,
      resolved: false,
    });
    displayParts.push({ text: token, isPlaceholder: true, label: raw.label });

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
  return text != null && (text.includes('[%s') || /<\w[\w.-]*>/.test(text) || /\{\w[\w.-]*\}/.test(text));
}

export function isPlaceholderToken(text: string): boolean {
  return /^<[^>]+>$|^\[%s(?::[^\]]+)?\]$|^\{[^}]+\}$/.test(text);
}

export interface PlaceholderEditResult {
  line: string;
  placeholders: PlaceholderInfo[];
  cursorPosition: number;
}

/** Replace one placeholder as a single edit and shift every later range. */
export function replacePlaceholderRange(
  line: string,
  placeholders: PlaceholderInfo[],
  index: number,
  replacement: string,
): PlaceholderEditResult {
  const next = placeholders.map((placeholder) => ({ ...placeholder }));
  const target = next[index];
  if (!target) {
    return { line, placeholders: next, cursorPosition: line.length };
  }

  const oldLength = target.length;
  const updatedLine = line.slice(0, target.position)
    + replacement
    + line.slice(target.position + oldLength);
  const delta = replacement.length - oldLength;

  target.length = replacement.length;
  target.resolved = true;
  for (let cursor = index + 1; cursor < next.length; cursor++) {
    next[cursor].position += delta;
  }

  return {
    line: updatedLine,
    placeholders: next,
    cursorPosition: target.position + replacement.length,
  };
}

/**
 * Update placeholder ranges after an ordinary line edit. The active placeholder
 * grows or shrinks with edits inside its range; later placeholders are shifted.
 */
export function updatePlaceholderRanges(
  placeholders: PlaceholderInfo[],
  editStart: number,
  removedLength: number,
  insertedLength: number,
  activeIndex: number,
): PlaceholderInfo[] {
  const editEnd = editStart + removedLength;
  const delta = insertedLength - removedLength;

  return placeholders.map((placeholder, index) => {
    const next = { ...placeholder };
    const placeholderEnd = placeholder.position + placeholder.length;
    const insertionInsideActive = removedLength === 0
      && index === activeIndex
      && editStart >= placeholder.position
      && editStart <= placeholderEnd;

    if (insertionInsideActive) {
      next.length += insertedLength;
      next.resolved = true;
      return next;
    }

    if (placeholder.position >= editEnd && !(removedLength === 0 && placeholder.position < editStart)) {
      next.position += delta;
      return next;
    }

    const overlapStart = Math.max(editStart, placeholder.position);
    const overlapEnd = Math.min(editEnd, placeholderEnd);
    const overlap = Math.max(0, overlapEnd - overlapStart);
    if (overlap > 0) {
      next.length = Math.max(0, placeholder.length - overlap + (index === activeIndex ? insertedLength : 0));
      next.resolved = true;
    }
    return next;
  });
}

/** Remove every still-visible placeholder token before a template is executed. */
export function removeUnresolvedPlaceholderRanges(line: string, placeholders: PlaceholderInfo[]): string {
  let result = line;
  const ordered = [...placeholders].sort((left, right) => right.position - left.position);
  for (const placeholder of ordered) {
    const value = result.slice(placeholder.position, placeholder.position + placeholder.length);
    if (!placeholder.resolved && isPlaceholderToken(value)) {
      result = result.slice(0, placeholder.position) + result.slice(placeholder.position + placeholder.length);
    }
  }
  return result;
}
