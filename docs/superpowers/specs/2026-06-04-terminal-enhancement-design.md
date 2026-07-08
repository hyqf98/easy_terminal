# Terminal Enhancement Design — xterm.js CJK Fix + Syntax Highlighting + Autocomplete

**Date:** 2026-06-04
**Status:** Approved
**Approach:** Fix + Enhance existing xterm.js (方案 A)

## Problem

The current terminal window (`src/views/terminal/TerminalWindow.ts`) has CJK (Chinese/Japanese/Korean) character rendering issues — garbled text, overlapping characters, and misaligned cursor positions. The root cause is that `@xterm/addon-unicode11` is listed in `package.json` but never loaded in the code.

Additionally, the user wants:
1. Command syntax highlighting (color tokens in the input line)
2. Fish-shell-style inline autosuggestions
3. Powerline/Nerd Font icon support

## Solution Overview

Keep xterm.js as the terminal engine. Fix CJK by loading the missing Unicode11 addon + WebGL renderer. Add command highlighting and enhanced autocomplete via xterm.js 5.x Decorations API.

## Part 1: CJK Fix

### Root Cause

`TerminalWindow.ts` only loads `FitAddon` and `WebLinksAddon`. Without `Unicode11Addon`, xterm.js cannot correctly calculate character widths for CJK double-width characters, emoji, and combining characters.

### Changes

1. **Load Unicode11Addon** in `initTerminal()`:
   ```typescript
   import { Unicode11Addon } from '@xterm/addon-unicode11';
   const unicode11Addon = new Unicode11Addon();
   term.loadAddon(unicode11Addon);
   term.unicode.activeBuffer.unicodeVersion = '11';
   ```

2. **Load WebglAddon** for GPU-accelerated rendering:
   ```typescript
   import { WebglAddon } from '@xterm/addon-webgl';
   const webglAddon = new WebglAddon();
   webglAddon.onContextLoss(() => { webglAddon.dispose(); });
   term.loadAddon(webglAddon);
   ```
   - Wrapped in try-catch; if WebGL fails, xterm falls back to its built-in DOM renderer automatically
   - No need for `@xterm/addon-canvas` — WebGL is the only choice, DOM is the automatic fallback

3. **Font update** — switch from `@fontsource/jetbrains-mono` to `@fontsource/jetbrains-mono-nerd-font`:
   - Enables Powerline symbols, folder icons, git status icons
   - Update `fontFamily` in Terminal config:
     ```typescript
     fontFamily: '"JetBrainsMono Nerd Font", "Cascadia Code", "Fira Code", Consolas, monospace'
     ```

### New Dependencies

```
@xterm/addon-webgl       (NEW)
@xterm/addon-unicode11   (EXISTS — just not used)
@fontsource/jetbrains-mono-nerd-font  (REPLACE @fontsource/jetbrains-mono)
```

**No** `@xterm/addon-canvas` needed.

## Part 2: Command Syntax Highlighting

### Approach

Use xterm.js 5.x `registerDecoration()` API to overlay colored highlights on the current input line. The existing `currentLine` tracking in `onData` provides the raw input text; `shellParse.ts` tokenizes it into typed segments.

### Token Types and Colors (Dark Theme)

| Token | Example | Color | CSS Variable |
|-------|---------|-------|--------------|
| command | `git`, `ls`, `docker` | `#7aa2f7` (blue) | `--term-token-command` |
| flag | `--force`, `-a` | `#bb9af7` (purple) | `--term-token-flag` |
| argument | `main.go`, `8080` | `#c0caf5` (light gray) | `--term-token-argument` |
| path | `./src/main.ts`, `/usr/bin` | `#9ece6a` (green) | `--term-token-path` |
| operator | `\|`, `&&`, `>` | `#ff9e64` (orange) | `--term-token-operator` |

### Implementation

1. **Extend `shellParse.ts`** — add a `tokenizeCommand(input: string)` function that returns an array of `{ type, start, end, text }` tokens
2. **In `TerminalWindow.ts`**, on each `currentLine` change:
   - Clear previous line decorations
   - Call `tokenizeCommand(currentLine)` to get tokens
   - For each token, register a decoration with the appropriate background color
3. **Decoration lifecycle** — decorations are cleared on Enter (command execution) or on next input change

### Key xterm.js API

```typescript
// Get current cursor position's line marker
const marker = term.registerMarker(0);

// Create a decoration for a token
const decoration = term.registerDecoration({
  marker,
  x: token.start,      // column offset
  width: token.end - token.start,
  height: 1,
  backgroundColor: tokenColor,
  layer: 'top',         // render above text
});
```

## Part 3: Enhanced Autocomplete

### Fish-style Inline Suggestion

Replace the current DOM-based `ghost-text-overlay` div with an xterm Decoration that renders the suggestion text directly within the terminal viewport. This feels more native and doesn't require a separate DOM element positioned outside the terminal.

Implementation:
1. In `updateGhostText()`, instead of setting `ghostText.value`, register a decoration at the cursor position
2. The decoration's element renders the suggestion text in a dim color (`opacity: 0.4`)
3. On Tab, the suggestion text is accepted and written to PTY

### Rich Suggestion Popup

Keep the existing Vue-based popup but enhance it:
- Command description preview
- Source icon (system/history/mapping/SSH)
- Keyboard shortcut hints (Tab to accept, arrows to navigate, Esc to dismiss)

No structural change — just UI polish to the existing `suggestVisible` popup.

## Part 4: Powerline Support

Already covered by the Nerd Font switch in Part 1. No additional code needed — xterm.js renders whatever characters the PTY outputs, and with Nerd Font loaded, Powerline glyphs and icons display correctly.

## Files Changed

| File | Change |
|------|--------|
| `package.json` | Add `@xterm/addon-webgl`, replace font source |
| `src/views/terminal/TerminalWindow.ts` | Load Unicode11 + WebGL addons, implement decoration-based syntax highlighting and inline suggestion |
| `src/views/terminal/TerminalWindow.css` | Add token color variables, adjust ghost-text styles |
| `src/views/terminal/TerminalWindow.vue` | Remove DOM ghost-text overlay (replaced by decoration) |
| `src/utils/shellParse.ts` | Add `tokenizeCommand()` function |
| `src/styles/themes/dark.css` | Add `--term-token-*` CSS variables |
| `src/styles/themes/light.css` | Add `--term-token-*` CSS variables |
| `src/styles/themes/warm.css` | Add `--term-token-*` CSS variables |

## Files NOT Changed

- `src-tauri/src/pty.rs` — PTY management unchanged
- `src/views/terminal/commandIntelligence.ts` — continues providing data
- `src/views/terminal/commandIntercept.ts` — unchanged
- `src/views/terminal/ptyService.ts` — unchanged
- Canvas, sidebar, other panels — unrelated

## Rendering Strategy

```
WebGL (preferred) → DOM (automatic fallback on WebGL failure)
```

Simple try-catch on WebglAddon load. No intermediate CanvasAddon.
