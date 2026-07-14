export type SuggestPlacement = 'above' | 'below';

export interface SuggestPlacementInput {
  cursorRect: Pick<DOMRect, 'left' | 'top' | 'bottom'>;
  terminalRect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>;
  popupWidth: number;
  desiredListHeight: number;
  chromeHeight: number;
  gap: number;
  edgePadding: number;
}

export interface SuggestPlacementResult {
  placement: SuggestPlacement;
  left: number;
  top: number;
  width: number;
  listHeight: number;
}

/** Pure popup placement constrained to the owning terminal's visible rectangle. */
export function calculateSuggestPlacement(input: SuggestPlacementInput): SuggestPlacementResult {
  const { cursorRect, terminalRect, chromeHeight, gap, edgePadding } = input;
  const terminalLeft = terminalRect.left + edgePadding;
  const terminalRight = terminalRect.right - edgePadding;
  const terminalTop = terminalRect.top + edgePadding;
  const terminalBottom = terminalRect.bottom - edgePadding;
  const width = Math.max(0, Math.min(input.popupWidth, terminalRight - terminalLeft));
  const left = Math.min(
    Math.max(cursorRect.left, terminalLeft),
    Math.max(terminalLeft, terminalRight - width),
  );

  const below = Math.max(0, terminalBottom - cursorRect.bottom - gap);
  const above = Math.max(0, cursorRect.top - terminalTop - gap);
  const desiredTotalHeight = input.desiredListHeight + chromeHeight;
  const placement: SuggestPlacement = below >= desiredTotalHeight || below >= above ? 'below' : 'above';
  const available = placement === 'below' ? below : above;
  const listHeight = Math.max(0, Math.min(input.desiredListHeight, available - chromeHeight));
  const totalHeight = chromeHeight + listHeight;
  const top = placement === 'below'
    ? cursorRect.bottom + gap
    : cursorRect.top - gap - totalHeight;

  return { placement, left, top, width, listHeight };
}
