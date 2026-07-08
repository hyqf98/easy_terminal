import { defineComponent, ref, computed, watch, onBeforeUnmount } from 'vue';
import AppModal from '../AppModal.vue';
import { formatShortcutFromEvent } from '../../views/shortcut/shortcutManager';

type RecordPlatform = 'mac' | 'win' | 'linux';

const MAC_TOKEN_MAP: Record<string, string> = {
  Cmd: '⌘',
  Meta: '⌘',
  Ctrl: '⌃',
  Alt: '⌥',
  Option: '⌥',
  Shift: '⇧',
  Enter: '⏎',
  Return: '⏎',
  Tab: '⇥',
  Escape: '⎋',
  Esc: '⎋',
  Space: '␣',
  Backspace: '⌫',
  Delete: '⌦',
  Left: '←',
  Right: '→',
  Up: '↑',
  Down: '↓',
  Home: '↖',
  End: '↘',
  PageUp: '⇞',
  PageDown: '⇟',
};

const WIN_TOKEN_MAP: Record<string, string> = {
  Cmd: 'Win',
  Meta: 'Win',
  Ctrl: 'Ctrl',
  Alt: 'Alt',
  Option: 'Alt',
  Shift: 'Shift',
  Enter: 'Enter',
  Return: 'Enter',
  Tab: 'Tab',
  Escape: 'Esc',
  Esc: 'Esc',
  Space: 'Space',
  Backspace: '⌫',
  Delete: 'Del',
  Left: '←',
  Right: '→',
  Up: '↑',
  Down: '↓',
  Home: 'Home',
  End: 'End',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
};

function mapToken(platform: RecordPlatform, token: string): string {
  const map = platform === 'mac' ? MAC_TOKEN_MAP : WIN_TOKEN_MAP;
  return map[token] ?? token;
}

function comboToTokens(combo: string, platform: RecordPlatform): string[] {
  return combo
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((token) => mapToken(platform, token));
}

function heldTokensFromEvent(event: KeyboardEvent, platform: RecordPlatform): string[] {
  const tokens: string[] = [];
  if (event.metaKey) tokens.push(mapToken(platform, 'Cmd'));
  if (event.ctrlKey) tokens.push(mapToken(platform, 'Ctrl'));
  if (event.altKey) tokens.push(mapToken(platform, 'Alt'));
  if (event.shiftKey) tokens.push(mapToken(platform, 'Shift'));
  return tokens;
}

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta']);

export default defineComponent({
  name: 'ShortcutRecordModal',
  components: { AppModal },
  props: {
    open: { type: Boolean, default: false },
    actionName: { type: String, default: '' },
    platform: { type: String as () => RecordPlatform, default: 'mac' },
  },
  emits: ['close', 'update:open', 'confirm'],
  setup(props, { emit }) {
    const confirmedCombo = ref('');
    const heldTokens = ref<string[]>([]);

    const icon = computed(
      () =>
        '<svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h0M10 10h0M14 10h0M18 10h0M6 14h12"/></svg>'
    );

    const displayTokens = computed(() =>
      confirmedCombo.value
        ? comboToTokens(confirmedCombo.value, props.platform)
        : heldTokens.value
    );

    const hasCombo = computed(() => confirmedCombo.value.length > 0);
    const hintLabel = computed(() =>
      confirmedCombo.value ? 'Enter 确认 · Esc 取消 · 继续按下可重新录制' : '按下快捷键组合'
    );

    function close() {
      emit('close');
      emit('update:open', false);
    }

    function clearCombo() {
      confirmedCombo.value = '';
      heldTokens.value = [];
    }

    function onConfirm() {
      if (!confirmedCombo.value) return;
      emit('confirm', confirmedCombo.value);
      emit('update:open', false);
    }

    function onKeydown(event: KeyboardEvent) {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === 'Escape') {
        if (hasCombo.value) {
          clearCombo();
        } else {
          close();
        }
        return;
      }
      if (event.key === 'Enter') {
        if (hasCombo.value) onConfirm();
        return;
      }

      if (MODIFIER_KEYS.has(event.key)) {
        heldTokens.value = heldTokensFromEvent(event, props.platform);
        confirmedCombo.value = '';
        return;
      }

      const combo = formatShortcutFromEvent(event);
      if (!combo) return;
      confirmedCombo.value = combo;
      heldTokens.value = [];
    }

    watch(
      () => props.open,
      (isOpen) => {
        if (isOpen) {
          clearCombo();
          window.addEventListener('keydown', onKeydown, true);
        } else {
          window.removeEventListener('keydown', onKeydown, true);
        }
      }
    );

    onBeforeUnmount(() => {
      window.removeEventListener('keydown', onKeydown, true);
    });

    return {
      icon,
      displayTokens,
      hasCombo,
      hintLabel,
      close,
      clearCombo,
      onConfirm,
    };
  },
});
