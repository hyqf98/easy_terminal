import { defineComponent, ref, computed } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { t } from '../../i18n';
import { showMessage } from '../../composables/useAppMessage';
import { showConfirm } from '../../composables/useAppDialog';
import MappingModal from '../../components/modals/MappingModal.vue';
import type { CommandMapping } from '../../types';

/** HTML 转义 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 命令高亮：复用全局 tok-* 样式 */
function tokenizeCommand(command: string): string {
  const tokens = command.match(/(\s+|[^\s]+)/g) || [];
  let commandWordIndex = 0;
  return tokens
    .map((token) => {
      if (/^\s+$/.test(token)) return escapeHtml(token);
      let cls = '';
      if (/^--?[\w-]+/.test(token)) {
        cls = 'tok-flag';
      } else if (/["'`]/.test(token)) {
        cls = 'tok-string';
      } else if (/[{]/.test(token) && /[}]/.test(token)) {
        cls = 'tok-path';
      } else if ((/[\/\\.]/.test(token) && /\w/.test(token)) || /^[~.]/.test(token)) {
        cls = 'tok-path';
      } else if (commandWordIndex < 2) {
        cls = 'tok-command';
        commandWordIndex += 1;
      }
      return cls ? `<span class="${cls}">${escapeHtml(token)}</span>` : escapeHtml(token);
    })
    .join('');
}

export default defineComponent({
  name: 'MappingPanel',
  components: { MappingModal },
  emits: ['mappings-changed'],
  setup(_, { emit }) {
    const mappings = ref<CommandMapping[]>([]);
    const keyword = ref('');
    const modalOpen = ref(false);
    const editingMapping = ref<CommandMapping | null>(null);

    const titleLabel = computed(() => t('mapping.title'));
    const subtitleLabel = computed(() => t('mapping.subtitle'));
    const newLabel = computed(() => t('mapping.new'));
    const emptyLabel = computed(() => t('mapping.empty'));
    const searchPlaceholder = computed(() => t('mapping.searchPlaceholder'));
    const introTitle = computed(() => t('mapping.introTitle'));
    const introDesc = computed(() => t('mapping.introDesc'));
    const builtinLabel = computed(() => t('mapping.sourceBuiltin'));

    const filteredMappings = computed(() => {
      const keywordValue = keyword.value.trim().toLowerCase();
      if (!keywordValue) return mappings.value;
      return mappings.value.filter((mapping) => {
        return (
          mapping.trigger.toLowerCase().includes(keywordValue) ||
          mapping.command.toLowerCase().includes(keywordValue) ||
          mapping.description.toLowerCase().includes(keywordValue) ||
          mapping.tags.some((tag) => tag.toLowerCase().includes(keywordValue))
        );
      });
    });

    async function reload() {
      try {
        mappings.value = await invoke<CommandMapping[]>('load_command_mappings');
      } catch {
        /* 忽略读取失败 */
      }
    }

    async function persist(next: CommandMapping[]) {
      try {
        await invoke('save_command_mappings', { entries: next });
        await reload();
        emit('mappings-changed');
      } catch (error) {
        showMessage(t('cmd.saveFailed', String(error)), 'error');
      }
    }

    function openAdd() {
      editingMapping.value = null;
      modalOpen.value = true;
    }

    function editMapping(mapping: CommandMapping) {
      editingMapping.value = mapping;
      modalOpen.value = true;
    }

    function closeModal() {
      modalOpen.value = false;
      editingMapping.value = null;
    }

    async function onSave(draft: CommandMapping) {
      const next = [...mappings.value];
      const index = next.findIndex((item) => item.id === draft.id);
      if (index >= 0) {
        next[index] = draft;
      } else {
        next.unshift(draft);
      }
      await persist(next);
      showMessage(t('mapping.saved'), 'success');
    }

    async function toggleMapping(mapping: CommandMapping) {
      const next = mappings.value.map((item) =>
        item.id === mapping.id ? { ...item, enabled: !item.enabled } : item
      );
      await persist(next);
    }

    async function deleteMapping(mapping: CommandMapping) {
      const confirmed = await showConfirm({
        title: t('mapping.confirmDeleteTitle'),
        content: t('mapping.confirmDelete'),
        danger: true,
      });
      if (!confirmed) return;
      const next = mappings.value.filter((item) => item.id !== mapping.id);
      await persist(next);
      showMessage(t('mapping.deleted'), 'success');
    }

    async function copyCommand(command: string) {
      try {
        await navigator.clipboard.writeText(command);
        showMessage(t('mapping.copied'), 'success');
      } catch {
        showMessage(t('mapping.copy'), 'warning');
      }
    }

    function renderCommand(command: string): string {
      return tokenizeCommand(command);
    }

    void reload();

    return {
      t,
      mappings, keyword, modalOpen, editingMapping,
      titleLabel, subtitleLabel, newLabel, emptyLabel, searchPlaceholder,
      introTitle, introDesc, builtinLabel,
      filteredMappings,
      openAdd, editMapping, closeModal, onSave, toggleMapping, deleteMapping, copyCommand,
      renderCommand,
    };
  },
});
