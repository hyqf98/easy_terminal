/** Return the previous Unicode code-point boundary in a UTF-16 string. */
export function previousTextBoundary(text: string, index: number): number {
  const safeIndex = Math.max(0, Math.min(text.length, index));
  if (safeIndex === 0) return 0;
  const previous = text.charCodeAt(safeIndex - 1);
  if (previous >= 0xdc00 && previous <= 0xdfff && safeIndex >= 2) {
    const lead = text.charCodeAt(safeIndex - 2);
    if (lead >= 0xd800 && lead <= 0xdbff) return safeIndex - 2;
  }
  return safeIndex - 1;
}

/** Return the next Unicode code-point boundary in a UTF-16 string. */
export function nextTextBoundary(text: string, index: number): number {
  const safeIndex = Math.max(0, Math.min(text.length, index));
  if (safeIndex >= text.length) return text.length;
  const lead = text.charCodeAt(safeIndex);
  if (lead >= 0xd800 && lead <= 0xdbff && safeIndex + 1 < text.length) {
    const trail = text.charCodeAt(safeIndex + 1);
    if (trail >= 0xdc00 && trail <= 0xdfff) return safeIndex + 2;
  }
  return safeIndex + 1;
}

/** Number of terminal cursor steps between two UTF-16 offsets. */
export function textCursorDistance(text: string, start: number, end: number): number {
  const from = Math.max(0, Math.min(text.length, Math.min(start, end)));
  const to = Math.max(from, Math.min(text.length, Math.max(start, end)));
  return Array.from(text.slice(from, to)).length;
}

function isWideCodePoint(codePoint: number): boolean {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f
    || codePoint === 0x2329
    || codePoint === 0x232a
    || (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f)
    || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
    || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
    || (codePoint >= 0xff00 && codePoint <= 0xff60)
    || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    || (codePoint >= 0x1f300 && codePoint <= 0x1faff)
    || (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

export function textCellWidth(text: string): number {
  let width = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint === 0 || codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) continue;
    if (/\p{Mark}/u.test(character)) continue;
    width += isWideCodePoint(codePoint) ? 2 : 1;
  }
  return width;
}

/** Map a terminal cell offset to the nearest UTF-16 text boundary. */
export function textIndexAtCell(text: string, targetCell: number): number {
  if (targetCell <= 0) return 0;
  let index = 0;
  let cells = 0;
  for (const character of text) {
    const charWidth = textCellWidth(character);
    const nextIndex = index + character.length;
    if (targetCell < cells + charWidth) {
      return targetCell - cells < charWidth / 2 ? index : nextIndex;
    }
    cells += charWidth;
    index = nextIndex;
  }
  return text.length;
}
