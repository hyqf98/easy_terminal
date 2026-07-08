import { defineComponent, computed, ref, onMounted, onUnmounted } from 'vue';
import { t, onLangChange } from '../i18n';

interface DockItem {
  id: string;
  icon: string;
  label: string;
}

const DOCK_ICONS: Record<string, string> = {
  canvas: `<svg viewBox="0 0 24 24"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
  files: `<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`,
  commands: `<svg viewBox="0 0 24 24"><path d="M4 4h6v16H4z"/><path d="M10 4h4v16h-4z"/><path d="M14 4l6 1-3 15-6-1z"/></svg>`,
  market: `<svg viewBox="0 0 24 24"><path d="M3 9l1.5-5h15L21 9"/><path d="M3 9v11h18V9"/><path d="M3 9h18"/><path d="M9 14h6"/></svg>`,
  history: `<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>`,
  mappings: `<svg viewBox="0 0 24 24"><path d="M7 8l-4 4 4 4"/><path d="M17 8l4 4-4 4"/><path d="M14 4l-4 16"/></svg>`,
  ssh: `<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1.2"/></svg>`,
  shortcuts: `<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h0M11 10h0M15 10h0M7 14h10"/></svg>`,
  settings: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`,
};

const MAIN_IDS = ['canvas', 'files', 'commands', 'market', 'history', 'mappings'] as const;
const TAIL_IDS = ['ssh', 'shortcuts', 'settings'] as const;

const LABEL_KEYS: Record<string, string> = {
  canvas: 'sidebar.canvas',
  files: 'sidebar.files',
  commands: 'sidebar.commands',
  market: 'sidebar.market',
  history: 'sidebar.history',
  mappings: 'sidebar.mappings',
  ssh: 'sidebar.ssh',
  shortcuts: 'sidebar.shortcuts',
  settings: 'sidebar.settings',
};

function buildItems(ids: readonly string[]): DockItem[] {
  return ids.map((id) => ({
    id,
    icon: DOCK_ICONS[id],
    label: t(LABEL_KEYS[id]),
  }));
}

export default defineComponent({
  name: 'Dock',
  props: {
    activeView: { type: String, default: 'canvas' },
  },
  emits: ['view-change'],
  setup() {
    const langTick = ref(0);
    const items = computed<DockItem[]>(() => {
      void langTick.value;
      return buildItems(MAIN_IDS);
    });
    const tailItems = computed<DockItem[]>(() => {
      void langTick.value;
      return buildItems(TAIL_IDS);
    });

    let unsub: (() => void) | null = null;
    onMounted(() => {
      unsub = onLangChange(() => {
        langTick.value++;
      });
    });
    onUnmounted(() => {
      unsub?.();
    });

    return { items, tailItems };
  },
});
