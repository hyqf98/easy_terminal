import { defineComponent, ref, computed, onMounted } from 'vue';
import { Icon } from '@vicons/utils';
import { History } from '@vicons/tabler';
import { t } from '../../i18n';
import { invoke } from '@tauri-apps/api/core';
import { showMessage } from '../../composables/useAppMessage';
import { showConfirm } from '../../composables/useAppDialog';
import { tokenizeCommandHtml } from '../command/tokenize';
import type { CommandHistoryEntry } from '../../types';

interface RailItem {
  key: string;
  label: string;
  count: number;
}

/** 历史分组：全部 / 本地终端 / SSH 终端 */
type HistoryGroup = 'all' | 'local' | 'ssh';

export default defineComponent({
  name: 'HistoryPanel',
  components: { Icon, History },
  emits: ['send-command'],
  setup(_, { emit }) {
    const items = ref<CommandHistoryEntry[]>([]);
    const keyword = ref('');
    const activeGroup = ref<HistoryGroup>('all');

    const titleLabel = computed(() => t('history.title'));
    const subtitleLabel = computed(() => t('history.summary', String(items.value.length)));
    const emptyLabel = computed(() => t('history.empty'));
    const exportLabel = computed(() => t('history.export'));
    const clearLabel = computed(() => t('history.clear'));
    const countLabel = (n: number) => t('history.count', String(n));

    /** 判断一条历史记录是否属于 SSH 终端 */
    function isSshEntry(item: CommandHistoryEntry): boolean {
      return item.mode === 'ssh';
    }

    /** 左侧分组导航：全部 / 本地终端 / SSH 终端，附带各分组命令数 */
    const railGroupOptions = computed<RailItem[]>(() => {
      const localCount = items.value.filter((item) => !isSshEntry(item)).length;
      const sshCount = items.value.filter((item) => isSshEntry(item)).length;
      return [
        { key: 'all', label: t('history.filterAll'), count: items.value.length },
        { key: 'local', label: t('history.groupLocal'), count: localCount },
        { key: 'ssh', label: t('history.groupSsh'), count: sshCount },
      ];
    });

    /** 经过分组过滤后的条目 */
    const groupedItems = computed(() => {
      if (activeGroup.value === 'all') return items.value;
      if (activeGroup.value === 'ssh') return items.value.filter(isSshEntry);
      return items.value.filter((item) => !isSshEntry(item));
    });

    /** 最终展示条目：叠加搜索关键词过滤，并按时间倒序排列 */
    const visibleItems = computed(() => {
      const keywordValue = keyword.value.trim().toLowerCase();
      const next = keywordValue
        ? groupedItems.value.filter((item) => item.command.toLowerCase().includes(keywordValue))
        : groupedItems.value;
      return [...next].sort((left, right) => right.timestamp - left.timestamp);
    });

    /** 来源终端标签：SSH 显示配置名，本地显示 cwd 末级目录，缺省回退为「本地」 */
    function terminalTag(item: CommandHistoryEntry): string {
      if (isSshEntry(item)) {
        return item.profileName || t('history.groupSsh');
      }
      if (!item.cwd) return t('history.terminalLocal');
      const segments = item.cwd.trim().split('/').filter(Boolean);
      return segments.length ? segments[segments.length - 1] : t('history.terminalLocal');
    }

    function renderCommand(command: string): string {
      return tokenizeCommandHtml(command);
    }

    async function loadHistory() {
      try {
        const loaded = await invoke<CommandHistoryEntry[]>('load_command_history');
        items.value = loaded.sort((left, right) => right.timestamp - left.timestamp);
      } catch {
        /* 忽略读取失败 */
      }
    }

    async function saveHistory(next: CommandHistoryEntry[]) {
      try {
        await invoke('save_command_history', { entries: next });
        items.value = next;
      } catch {
        /* 忽略保存失败 */
      }
    }

    function sendCommand(command: string) {
      emit('send-command', command);
    }

    /** 切换分组过滤：全部 / 本地 / SSH */
    function selectGroup(key: string) {
      activeGroup.value = key as HistoryGroup;
    }

    /** 复制单条历史命令到系统剪贴板 */
    async function copyCommand(command: string) {
      try {
        await navigator.clipboard.writeText(command);
        showMessage(t('history.copied'), 'success');
      } catch {
        showMessage(t('history.copy'), 'warning');
      }
    }

    async function clearHistory() {
      const confirmed = await showConfirm({
        title: t('history.confirmClearTitle'),
        content: t('history.confirmClear'),
        danger: true,
      });
      if (!confirmed) return;
      await saveHistory([]);
      showMessage(t('history.cleared'), 'success');
    }

    /** 导出历史为文本文件，通过浏览器下载 */
    function exportHistory() {
      const lines = visibleItems.value.map((item) => {
        const time = new Date(item.timestamp).toLocaleString();
        return `[${time}] (${item.count}x) ${item.command}`;
      });
      const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `history-${Date.now()}.txt`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      showMessage(t('history.exportSuccess', String(visibleItems.value.length)), 'success');
    }

    onMounted(() => {
      void loadHistory();
    });

    return {
      t,
      keyword, activeGroup,
      titleLabel, subtitleLabel, emptyLabel, exportLabel, clearLabel,
      railGroupOptions, visibleItems,
      countLabel, terminalTag, renderCommand,
      sendCommand, clearHistory, exportHistory,
      selectGroup, copyCommand,
    };
  },
});
