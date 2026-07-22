import { defineComponent, computed, ref, onMounted, onUnmounted, type Component, markRaw } from 'vue';
import { Icon } from '@vicons/utils';
import {
  Terminal2,
  Folder,
  Book,
  BuildingStore,
  History,
  Lock,
  Keyboard,
  Settings,
  ChevronUp,
  ChevronDown,
} from '@vicons/tabler';
import { t, onLangChange } from '../i18n';

interface DockItem {
  id: string;
  label: string;
}

// Dock 图标映射：统一由 Tabler 图标库提供，告别散落的内联 SVG 字符串
const DOCK_ICONS: Record<string, Component> = markRaw({
  canvas: Terminal2,
  files: Folder,
  commands: Book,
  market: BuildingStore,
  history: History,
  ssh: Lock,
  shortcuts: Keyboard,
  settings: Settings,
});

// files 保留在 Dock：但点击后切换到独立的空视图，不再复用画布左侧的 FileTree 浮层
// mappings 已合并到命令管理面板的子标签中，不再作为独立 Dock 项
const MAIN_IDS = ['canvas', 'files', 'commands', 'market', 'history'] as const;
const TAIL_IDS = ['ssh', 'shortcuts', 'settings'] as const;

const LABEL_KEYS: Record<string, string> = {
  canvas: 'sidebar.canvas',
  files: 'sidebar.files',
  commands: 'sidebar.commands',
  market: 'sidebar.market',
  history: 'sidebar.history',
  ssh: 'sidebar.ssh',
  shortcuts: 'sidebar.shortcuts',
  settings: 'sidebar.settings',
};

function buildItems(ids: readonly string[]): DockItem[] {
  return ids.map((id) => ({
    id,
    label: t(LABEL_KEYS[id]),
  }));
}

export default defineComponent({
  name: 'Dock',
  components: { Icon },
  props: {
    activeView: { type: String, default: 'canvas' },
  },
  emits: ['view-change'],
  setup() {
    const langTick = ref(0);
    const dockExpanded = ref(false);
    const dockShellRef = ref<HTMLElement | null>(null);
    const items = computed<DockItem[]>(() => {
      void langTick.value;
      return buildItems(MAIN_IDS);
    });
    const tailItems = computed<DockItem[]>(() => {
      void langTick.value;
      return buildItems(TAIL_IDS);
    });

    let unsub: (() => void) | null = null;
    let collapseTimer: ReturnType<typeof setTimeout> | null = null;
    let lastExpandedAt = 0;

    function cancelCollapse() {
      if (!collapseTimer) return;
      clearTimeout(collapseTimer);
      collapseTimer = null;
    }

    function expandDock() {
      cancelCollapse();
      if (!dockExpanded.value) lastExpandedAt = performance.now();
      dockExpanded.value = true;
    }

    function collapseDock() {
      cancelCollapse();
      dockExpanded.value = false;
    }

    function scheduleCollapse() {
      if (!dockExpanded.value || collapseTimer) return;
      collapseTimer = setTimeout(() => {
        collapseTimer = null;
        dockExpanded.value = false;
      }, 250);
    }

    function toggleDock() {
      // Pointer enter expands first; the same initial click must not immediately undo it.
      if (dockExpanded.value && performance.now() - lastExpandedAt > 220) collapseDock();
      else expandDock();
    }

    onMounted(() => {
      unsub = onLangChange(() => {
        langTick.value++;
      });
    });
    onUnmounted(() => {
      unsub?.();
      cancelCollapse();
    });

    // 将静态图标映射暴露给模板，避免把组件塞进响应式数据
    return {
      items,
      tailItems,
      iconMap: DOCK_ICONS,
      dockExpanded,
      dockShellRef,
      ChevronUp,
      ChevronDown,
      expandDock,
      scheduleCollapse,
      toggleDock,
    };
  },
});
