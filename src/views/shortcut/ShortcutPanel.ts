import { defineComponent, ref, computed, onMounted, onUnmounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { Icon } from '@vicons/utils';
import { Keyboard } from '@vicons/tabler';
import { t, onLangChange } from '../../i18n';
import { showMessage } from '../../composables/useAppMessage';
import type { ShortcutBinding } from '../../types';
import ShortcutRecordModal from '../../components/modals/ShortcutRecordModal.vue';

type ShortcutField = 'windows' | 'darwin' | 'linux';
type RecordPlatform = 'mac' | 'win' | 'linux';

const FIELD_ORDER: ShortcutField[] = ['darwin', 'windows', 'linux'];
const FIELD_LABELS: Record<ShortcutField, string> = {
  darwin: 'macOS',
  windows: 'Windows',
  linux: 'Linux',
};
const FIELD_PLATFORM: Record<ShortcutField, RecordPlatform> = {
  darwin: 'mac',
  windows: 'win',
  linux: 'linux',
};

const CATEGORY_ORDER = ['terminal', 'navigation', 'workspace'];

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

function mapToken(field: ShortcutField, token: string): string {
  const map = field === 'darwin' ? MAC_TOKEN_MAP : WIN_TOKEN_MAP;
  return map[token] ?? token;
}

function comboToTokens(combo: string, field: ShortcutField): string[] {
  if (!combo) return [];
  return combo
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((token) => mapToken(field, token));
}

/** 动作图标，按 id 关键词匹配，缺省回退到通用键盘图标 */
function actionIcon(binding: ShortcutBinding): string {
  const id = binding.id;
  if (id.startsWith('terminal.duplicate')) {
    return '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="12" height="12" rx="2"/><path d="M8 16v2a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2"/></svg>';
  }
  if (id.startsWith('terminal.paste')) {
    return '<svg viewBox="0 0 24 24"><path d="M16 3h5v5M21 3l-7 7M8 21H3v-5M3 21l7-7"/></svg>';
  }
  if (id.startsWith('terminal.copy')) {
    return '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="12" height="12" rx="2"/><path d="M8 16v2a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2"/></svg>';
  }
  if (id.startsWith('terminal.select')) {
    return '<svg viewBox="0 0 24 24"><path d="M3 3l7 18 2-7 7-2z"/></svg>';
  }
  if (id.startsWith('desktop.draw')) {
    return '<svg viewBox="0 0 24 24"><path d="M12 2 2 7l10 5 10-5z"/><path d="M2 17l10 5 10-5"/></svg>';
  }
  if (id.startsWith('sidebar.') || id.startsWith('workspace.')) {
    return '<svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 4v16M17 4v16"/></svg>';
  }
  return '<svg viewBox="0 0 24 24"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>';
}

/** 平台图标（对照 mockup 平台 tab 内的 SVG） */
const PLATFORM_ICONS: Record<ShortcutField, string> = {
  darwin:
    '<svg viewBox="0 0 24 24"><path d="M17.05 20.28c-.98.95-2.05.86-3.08.43-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.43C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>',
  windows:
    '<svg viewBox="0 0 24 24"><path d="M3 5l8-1v8H3zM12 4l9-1v10h-9zM3 12h8v8l-8-1zM12 12h9v9l-9-1z"/></svg>',
  linux:
    '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2c1.5 0 3 .5 4 1.5l-1 1c-.7-.7-1.8-1-3-1v-1.5zm-4 2c1-.5 2.5-1 4-1v1.5c-1.2 0-2.3.3-3 1l-1-1zm-3 4c.3-1.2 1-2.3 2-3l1 1c-.7.7-1 1.8-1 3h-2zm0 4c0 1.2.3 2.3 1 3l-1 1c-1-1-1.7-2-2-3.5l2-.5z"/></svg>',
};

function platformIconSvg(field: ShortcutField): string {
  return PLATFORM_ICONS[field];
}

export default defineComponent({
  name: 'ShortcutPanel',
  components: { ShortcutRecordModal, Icon, Keyboard },
  setup() {
    const draftBindings = ref<ShortcutBinding[]>([]);
    const recording = ref<{ bindingId: string; field: ShortcutField } | null>(null);
    const modalOpen = ref(false);
    const modalAction = ref('');
    const modalPlatform = ref<RecordPlatform>('mac');

    const langTick = ref(0);

    const titleLabel = computed(() => { void langTick.value; return t('shortcut.title'); });
    const subtitleLabel = computed(() => { void langTick.value; return t('shortcut.summary', platformLabel()); });
    const resetLabel = computed(() => { void langTick.value; return t('shortcut.reset'); });

    function platformLabel(): string {
      const platform = navigator.platform.toLowerCase();
      if (platform.includes('mac')) return 'macOS';
      if (platform.includes('linux')) return 'Linux';
      return 'Windows';
    }

    const grouped = computed(() => {
      const buckets = new Map<string, ShortcutBinding[]>();
      draftBindings.value.forEach((binding) => {
        const category = binding.category || 'workspace';
        const list = buckets.get(category) || [];
        list.push(binding);
        buckets.set(category, list);
      });
      return CATEGORY_ORDER.filter((category) => buckets.has(category)).map((category) => {
        const bindings = (buckets.get(category) || []).slice().sort((a, b) =>
          a.label.localeCompare(b.label, 'zh-CN')
        );
        return [category, bindings] as [string, ShortcutBinding[]];
      });
    });

    /** 同平台下相同组合视为冲突，返回冲突的 bindingId 集合 */
    const conflictMap = computed(() => {
      const conflicts = new Set<string>();
      FIELD_ORDER.forEach((field) => {
        const comboToIds = new Map<string, string[]>();
        draftBindings.value.forEach((binding) => {
          const combo = binding[field].trim();
          if (!combo) return;
          const list = comboToIds.get(combo) || [];
          list.push(binding.id);
          comboToIds.set(combo, list);
        });
        comboToIds.forEach((ids) => {
          if (ids.length > 1) ids.forEach((id) => conflicts.add(id));
        });
      });
      return conflicts;
    });

    function categoryLabel(category: string): string {
      if (category === 'terminal') return t('shortcut.categoryTerminal');
      if (category === 'navigation') return t('shortcut.categoryNavigation');
      return t('shortcut.categoryWorkspace');
    }

    function isCurrentPlatform(field: ShortcutField): boolean {
      const platform = navigator.platform.toLowerCase();
      if (field === 'darwin') return platform.includes('mac');
      if (field === 'linux') return platform.includes('linux');
      return !platform.includes('mac') && !platform.includes('linux');
    }

    /** 当前选中的平台 tab（默认聚焦本机平台） */
    const selectedPlatform = ref<ShortcutField>(
      FIELD_ORDER.find((field) => isCurrentPlatform(field)) || 'darwin'
    );

    function getFieldValue(binding: ShortcutBinding, field: ShortcutField): string {
      return binding[field] || '';
    }

    function getComboTokens(binding: ShortcutBinding, field: ShortcutField): string[] {
      return comboToTokens(binding[field], field);
    }

    function isConflict(binding: ShortcutBinding): boolean {
      return conflictMap.value.has(binding.id);
    }

    function openRecord(binding: ShortcutBinding, field: ShortcutField) {
      recording.value = { bindingId: binding.id, field };
      modalAction.value = binding.label;
      modalPlatform.value = FIELD_PLATFORM[field];
      modalOpen.value = true;
    }

    function onRecordClose() {
      modalOpen.value = false;
      recording.value = null;
    }

    function onRecordConfirm(combo: string) {
      const target = recording.value;
      if (!target) {
        modalOpen.value = false;
        return;
      }
      draftBindings.value = draftBindings.value.map((binding) =>
        binding.id === target.bindingId ? { ...binding, [target.field]: combo } : binding
      );
      modalOpen.value = false;
      recording.value = null;
      void persistBindings();
    }

    function clearField(binding: ShortcutBinding, field: ShortcutField) {
      draftBindings.value = draftBindings.value.map((item) =>
        item.id === binding.id ? { ...item, [field]: '' } : item
      );
      void persistBindings();
    }

    async function persistBindings() {
      try {
        await invoke('save_shortcuts', { entries: draftBindings.value.map((b) => ({ ...b })) });
        window.dispatchEvent(new CustomEvent('shortcut-bindings-change', {
          detail: draftBindings.value.map((binding) => ({ ...binding })),
        }));
        showMessage(t('cmd.save') + ' ✓', 'success');
      } catch (error) {
        showMessage(String(error), 'error');
      }
    }

    async function resetDefaults() {
      try {
        const defaults = await invoke<ShortcutBinding[]>('load_default_shortcuts');
        draftBindings.value = defaults;
        await invoke('save_shortcuts', { entries: defaults.map((b) => ({ ...b })) });
        window.dispatchEvent(new CustomEvent('shortcut-bindings-change', {
          detail: defaults.map((binding) => ({ ...binding })),
        }));
        showMessage(t('shortcut.reset') + ' ✓', 'success');
      } catch (error) {
        showMessage(String(error), 'error');
      }
    }

    onMounted(async () => {
      try {
        draftBindings.value = await invoke<ShortcutBinding[]>('load_shortcuts');
      } catch (error) {
        showMessage(String(error), 'error');
      }
    });

    const unsubLang = onLangChange(() => { langTick.value++; });

    onUnmounted(() => { unsubLang(); });

    return {
      shortcutFields: FIELD_ORDER,
      fieldLabels: FIELD_LABELS,
      titleLabel,
      subtitleLabel,
      resetLabel,
      modalOpen,
      modalAction,
      modalPlatform,
      recording,
      selectedPlatform,
      grouped,
      categoryLabel,
      isCurrentPlatform,
      getFieldValue,
      getComboTokens,
      isConflict,
      openRecord,
      onRecordClose,
      onRecordConfirm,
      clearField,
      resetDefaults,
      actionIcon,
      platformIconSvg,
    };
  },
});
