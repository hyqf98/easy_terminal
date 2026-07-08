import { defineComponent, ref, computed, onMounted, reactive } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { t } from '../../i18n';
import { showMessage } from '../../composables/useAppMessage';
import { showConfirm } from '../../composables/useAppDialog';
import CommandModal from '../../components/modals/CommandModal.vue';
import { tokenizeCommandHtml } from './tokenize';
import type {
  CommandDetail,
  CommandEntry,
  CommandLibrarySummary,
  CommandSummary,
  CommandSummaryPage,
} from '../../types';

const ALL_CATEGORY = '__all__';

export default defineComponent({
  name: 'CommandConfigPanel',
  components: { CommandModal },
  emits: ['commands-changed'],
  setup(_, { emit }) {
    const libraries = ref<CommandLibrarySummary[]>([]);
    const activeLibraryId = ref<string>(ALL_CATEGORY);
    const activePage = ref<CommandSummaryPage>({ items: [], total: 0, page: 1, pageSize: 200 });
    const keyword = ref('');

    // 命令弹框状态
    const commandModalOpen = ref(false);
    const editingCommand = ref<CommandEntry | null>(null);

    // 分类管理弹框状态（沿用旧 native dialog，保留 CRUD）
    const libraryDialogVisible = ref(false);
    const libraryEditMode = ref<'create' | 'edit'>('create');
    const libraryForm = reactive({
      id: '',
      label: '',
      platformsText: '',
      language: '',
      enabled: true,
    });

    let searchTimer: ReturnType<typeof setTimeout> | null = null;

    const titleLabel = computed(() => t('cmd.config.title'));
    const subtitleLabel = computed(() =>
      t('cmd.loaded', String(libraries.value.reduce((sum, lib) => sum + lib.commandCount, 0)))
    );
    const addCmdLabel = computed(() => t('cmd.addCmd'));
    const importLabel = computed(() => t('cmd.import'));
    const exportLabel = computed(() => t('cmd.export'));
    const addCategoryLabel = computed(() => t('cmd.addCategory'));
    const searchPlaceholder = computed(() => t('cmd.searchPlaceholder'));
    const emptyLabel = computed(() => t('cmd.emptySection'));
    const cancelLabel = computed(() => t('cmd.cancel'));
    const saveLabel = computed(() => t('cmd.save'));
    const editLabel = computed(() => t('cmd.edit'));
    const deleteLabel = computed(() => t('cmd.delete'));
    const disabledLabel = computed(() => t('mapping.disabled'));
    const enabledLabel = computed(() => t('mapping.enabled'));
    const categoryNameLabel = computed(() => t('cmd.categoryName'));
    const categoryIdLabel = computed(() => t('cmd.categoryId'));
    const platformsLabel = computed(() => t('cmd.platforms'));
    const languageFieldLabel = computed(() => t('cmd.languageField'));

    const categoryOptions = computed(() =>
      libraries.value
        .filter((lib) => lib.kind !== 'system')
        .map((lib) => lib.label || formatTitle(lib.id))
    );

    const totalCount = computed(() =>
      libraries.value.reduce((sum, lib) => sum + lib.commandCount, 0)
    );

    const activeLibrary = computed(() =>
      activeLibraryId.value === ALL_CATEGORY
        ? null
        : libraries.value.find((lib) => lib.id === activeLibraryId.value) || null
    );

    const canDeleteLibrary = computed(() => {
      const lib = activeLibrary.value;
      return !!lib && !['builtin', 'system'].includes(lib.sourceType);
    });

    function formatTitle(id: string): string {
      const titles: Record<string, string> = {
        darwin: 'macOS',
        'quick-commands': t('cmd.quickLegacy'),
      };
      return titles[id] || id.replace(/[-_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
    }

    function describeSource(lib: CommandLibrarySummary): string {
      if (lib.kind === 'system') return t('cmd.sourceSystem');
      if (lib.sourceType === 'builtin') return t('cmd.sourceBuiltin');
      return t('cmd.sourceUser');
    }

    function railIconSvg(lib: CommandLibrarySummary): string {
      if (lib.kind === 'system') {
        return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>';
      }
      return '<svg viewBox="0 0 24 24"><path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/></svg>';
    }

    function commandRowIcon(): string {
      return '<svg viewBox="0 0 24 24"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>';
    }

    function tokenize(command: string): string {
      return tokenizeCommandHtml(command);
    }

    async function reloadLibraries() {
      const libs = await invoke<CommandLibrarySummary[]>('list_command_libraries');
      libraries.value = libs;
      if (
        activeLibraryId.value !== ALL_CATEGORY &&
        !libs.some((lib) => lib.id === activeLibraryId.value)
      ) {
        activeLibraryId.value = ALL_CATEGORY;
      }
    }

    async function reloadActiveCommands(page = 1) {
      if (activeLibraryId.value === ALL_CATEGORY) {
        // 全部：聚合各库查询后按关键词客户端过滤
        const aggregated = await Promise.all(
          libraries.value.map((lib) =>
            invoke<CommandSummaryPage>('query_command_summaries', {
              params: { libraryId: lib.id, keyword: '', page: 1, pageSize: 200 },
            })
          )
        );
        const allItems = aggregated.flatMap((result) => result.items);
        const lower = keyword.value.trim().toLowerCase();
        const filtered = lower
          ? allItems.filter((item) =>
              [item.name, item.command, item.description, ...item.tags, item.name_cn]
                .join(' ')
                .toLowerCase()
                .includes(lower)
            )
          : allItems;
        activePage.value = { items: filtered, total: filtered.length, page: 1, pageSize: 200 };
        return;
      }
      activePage.value = await invoke<CommandSummaryPage>('query_command_summaries', {
        params: { libraryId: activeLibraryId.value, keyword: keyword.value, page, pageSize: 200 },
      });
    }

    async function selectLibrary(id: string) {
      activeLibraryId.value = id;
      keyword.value = '';
      await reloadActiveCommands();
    }

    function debouncedSearch() {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => reloadActiveCommands(), 180);
    }

    // ===== 命令 CRUD =====
    function openAddCommand() {
      editingCommand.value = null;
      commandModalOpen.value = true;
    }

    async function openCommandEditor(command: CommandSummary) {
      const detail = await invoke<CommandDetail | null>('get_command_detail', { id: command.id });
      if (!detail) return;
      const entry: CommandEntry = {
        id: detail.id,
        name: detail.name,
        command: detail.command,
        name_cn: detail.name_cn,
        description: detail.description,
        usage: detail.usage,
        category: detail.category,
        alias: detail.alias || [],
        tags: detail.tags || [],
        examples: detail.examples || [],
        hint: detail.hint || '',
        enabled: detail.enabled,
        libraryId: detail.libraryId,
      };
      editingCommand.value = entry;
      commandModalOpen.value = true;
    }

    async function onCommandSave(entry: CommandEntry) {
      const targetLibraryId =
        entry.libraryId ||
        (activeLibraryId.value !== ALL_CATEGORY ? activeLibraryId.value : libraries.value[0]?.id) ||
        '';
      if (!targetLibraryId) {
        showMessage(t('cmd.categoryRequired'), 'warning');
        return;
      }
      const payload = {
        id: entry.id ?? null,
        libraryId: targetLibraryId,
        commandKey: '',
        name: entry.name,
        command: entry.command,
        name_cn: entry.name_cn,
        description: entry.description,
        usage: entry.usage || entry.command,
        category: entry.category || formatTitle(targetLibraryId),
        alias: entry.alias,
        tags: entry.tags,
        examples: entry.examples,
        hint: entry.hint || '',
        language: '',
        triggers: [] as string[],
        keywords: [] as string[],
        weight: 0,
        enabled: entry.enabled ?? true,
      };
      try {
        if (payload.id) {
          await invoke('update_command', { payload });
        } else {
          await invoke('create_command', { payload });
        }
        commandModalOpen.value = false;
        await reloadActiveCommands(activePage.value.page);
        await reloadLibraries();
        emit('commands-changed');
      } catch (error) {
        showMessage(t('cmd.saveFailed', String(error)), 'error');
      }
    }

    async function deleteCommand(command: CommandSummary) {
      const confirmed = await showConfirm({
        content: t('cmd.delete') + '：' + command.name + '？',
        danger: true,
        positiveText: deleteLabel.value,
        negativeText: cancelLabel.value,
      });
      if (!confirmed) return;
      try {
        await invoke('delete_command', { libraryId: command.libraryId, commandId: command.id });
        await reloadActiveCommands(activePage.value.page);
        await reloadLibraries();
        emit('commands-changed');
      } catch (error) {
        showMessage(t('cmd.saveFailed', String(error)), 'error');
      }
    }

    // ===== 库 CRUD =====
    function openAddLibrary() {
      libraryForm.id = '';
      libraryForm.label = '';
      libraryForm.platformsText = '';
      libraryForm.language = '';
      libraryForm.enabled = true;
      libraryEditMode.value = 'create';
      libraryDialogVisible.value = true;
    }

    function editLibrary() {
      const lib = activeLibrary.value;
      if (!lib) return;
      libraryForm.id = lib.id;
      libraryForm.label = lib.label;
      libraryForm.platformsText = lib.platforms.join(', ');
      libraryForm.language = lib.language;
      libraryForm.enabled = lib.enabled;
      libraryEditMode.value = 'edit';
      libraryDialogVisible.value = true;
    }

    async function saveLibrary() {
      if (!libraryForm.id || !libraryForm.label) {
        showMessage(t('cmd.categoryRequired'), 'warning');
        return;
      }
      const payload = {
        id: libraryForm.id.trim(),
        label: libraryForm.label.trim(),
        kind: 'custom' as const,
        sourceType: 'user' as const,
        platforms: libraryForm.platformsText
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean),
        language: libraryForm.language.trim(),
        enabled: libraryForm.enabled,
      };
      try {
        if (libraryEditMode.value === 'create') {
          await invoke('create_command_library', { payload });
        } else {
          await invoke('update_command_library', { payload });
        }
        activeLibraryId.value = payload.id;
        libraryDialogVisible.value = false;
        await reloadLibraries();
        await reloadActiveCommands();
        emit('commands-changed');
      } catch (error) {
        showMessage(t('cmd.saveFailed', String(error)), 'error');
      }
    }

    async function deleteLibrary() {
      const lib = activeLibrary.value;
      if (!lib) return;
      const confirmed = await showConfirm({
        content: t('market.uninstallConfirm', lib.label),
        danger: true,
        positiveText: deleteLabel.value,
        negativeText: cancelLabel.value,
      });
      if (!confirmed) return;
      try {
        await invoke('delete_command_library', { libraryId: lib.id });
        activeLibraryId.value = ALL_CATEGORY;
        await reloadLibraries();
        await reloadActiveCommands();
        emit('commands-changed');
      } catch (error) {
        showMessage(t('cmd.saveFailed', String(error)), 'error');
      }
    }

    async function exportLibrary() {
      const lib = activeLibrary.value;
      if (!lib) {
        showMessage(t('cmd.export'), 'info');
        return;
      }
      const json = await invoke<string>('export_command_library', { libraryId: lib.id });
      const target = await save({
        defaultPath: `${lib.id}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!target) return;
      await invoke('write_text_file', { path: target, content: json });
      showMessage(t('cmd.export') + ' ✓', 'success');
    }

    async function importFile() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const text = await file.text();
          const lib = await invoke<CommandLibrarySummary>('import_command_library', { json: text });
          activeLibraryId.value = lib.id;
          keyword.value = '';
          await reloadLibraries();
          await reloadActiveCommands();
          emit('commands-changed');
          showMessage(t('cmd.import') + ' ✓', 'success');
        } catch (error) {
          showMessage(t('cmd.importFailed', String(error)), 'error');
        }
      });
      input.click();
    }

    onMounted(async () => {
      await reloadLibraries();
      await reloadActiveCommands();
    });

    return {
      libraries,
      activeLibraryId,
      activePage,
      keyword,
      libraryDialogVisible,
      libraryEditMode,
      libraryForm,
      commandModalOpen,
      editingCommand,
      activeLibrary,
      canDeleteLibrary,
      categoryOptions,
      totalCount,
      titleLabel,
      subtitleLabel,
      addCmdLabel,
      importLabel,
      exportLabel,
      addCategoryLabel,
      searchPlaceholder,
      emptyLabel,
      cancelLabel,
      saveLabel,
      editLabel,
      deleteLabel,
      disabledLabel,
      enabledLabel,
      categoryNameLabel,
      categoryIdLabel,
      platformsLabel,
      languageFieldLabel,
      describeSource,
      railIconSvg,
      commandRowIcon,
      tokenize,
      formatTitle,
      selectLibrary,
      debouncedSearch,
      openAddCommand,
      openCommandEditor,
      onCommandSave,
      deleteCommand,
      openAddLibrary,
      editLibrary,
      saveLibrary,
      deleteLibrary,
      exportLibrary,
      importFile,
      ALL_CATEGORY,
    };
  },
});
