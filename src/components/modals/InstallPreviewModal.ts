import { defineComponent, computed } from 'vue';
import AppModal from '../AppModal.vue';
import { tokenizeCommandHtml } from '../../views/command/tokenize';
import type { CommandEntry } from '../../types';

/** 安装预览的库信息 */
export interface InstallPreviewLibrary {
  name: string;
  label: string;
  description: string;
  author?: string;
  version?: string;
  commands: CommandEntry[];
}

export default defineComponent({
  name: 'InstallPreviewModal',
  components: { AppModal },
  props: {
    open: { type: Boolean, default: false },
    library: { type: Object as () => InstallPreviewLibrary | null, default: null },
    /** 预览展示的命令条数上限 */
    previewLimit: { type: Number, default: 6 },
  },
  emits: ['close', 'update:open', 'install'],
  setup(props, { emit }) {
    // 下载图标
    const icon =
      '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

    const subTitle = computed(() => {
      const lib = props.library;
      if (!lib) return '';
      const parts: string[] = [];
      if (lib.author) parts.push(`by @${lib.author}`);
      if (lib.version) parts.push(`v${lib.version}`);
      parts.push(`${lib.commands.length} 条命令`);
      return parts.join(' · ');
    });

    const totalLabel = computed(() => `共 ${props.library?.commands.length ?? 0} 条命令`);
    const installLabel = computed(
      () => `安装 ${props.library?.commands.length ?? 0} 条命令`
    );
    const sectionLabel = computed(() => {
      const total = props.library?.commands.length ?? 0;
      const shown = Math.min(total, props.previewLimit);
      return `包含命令预览（前 ${shown} 条 / 共 ${total} 条）`;
    });

    const previewCommands = computed(() => {
      const list = props.library?.commands || [];
      return list.slice(0, props.previewLimit);
    });

    function tokenize(command: string): string {
      return tokenizeCommandHtml(command);
    }

    function close() {
      emit('close');
      emit('update:open', false);
    }

    function onUpdateOpen(value: boolean) {
      emit('update:open', value);
      if (!value) emit('close');
    }

    function onInstall() {
      emit('install', props.library);
    }

    return {
      icon,
      subTitle,
      totalLabel,
      installLabel,
      sectionLabel,
      previewCommands,
      tokenize,
      close,
      onUpdateOpen,
      onInstall,
    };
  },
});
