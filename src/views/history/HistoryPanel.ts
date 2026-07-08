import { defineComponent, ref, computed, onMounted } from 'vue';
import { t } from '../../i18n';
import { invoke } from '@tauri-apps/api/core';
import { showMessage } from '../../composables/useAppMessage';
import { showConfirm } from '../../composables/useAppDialog';
import type { CommandHistoryEntry } from '../../types';

type TimeRange = 'today' | 'week' | 'all';
type SortBy = 'time' | 'freq';

interface DayGroup {
  key: string;
  label: string;
  items: CommandHistoryEntry[];
  count: number;
}

/** HTML 转义，防止命令文本注入 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 将命令行切分为带语法高亮的 span 片段 */
function tokenizeCommand(command: string): string {
  const tokens = command.match(/(\s+|[^\s]+)/g) || [];
  let commandWordIndex = 0;
  return tokens
    .map((token) => {
      if (/^\s+$/.test(token)) return escapeHtml(token);
      let cls = '';
      if (/^--?[\w-]+/.test(token)) {
        cls = 'tok-flag';
      } else if (/^["'`]/.test(token) || /["'`]/.test(token)) {
        cls = 'tok-string';
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

/** 获取当天 0 点的时间戳 */
function startOfToday(): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.getTime();
}

/** 取日期 key YYYY-MM-DD */
function dateKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default defineComponent({
  name: 'HistoryPanel',
  emits: ['send-command'],
  setup(_, { emit }) {
    const items = ref<CommandHistoryEntry[]>([]);
    const keyword = ref('');
    const timeRange = ref<TimeRange>('all');
    const sortBy = ref<SortBy>('time');

    const titleLabel = computed(() => t('history.title'));
    const subtitleLabel = computed(() => t('history.summary', String(items.value.length)));
    const emptyLabel = computed(() => t('history.empty'));
    const exportLabel = computed(() => t('history.export'));
    const clearLabel = computed(() => t('history.clear'));
    const searchPlaceholder = computed(() => t('history.searchPlaceholder'));
    const sortTimeLabel = computed(() => t('history.sortTime'));
    const sortFreqLabel = computed(() => t('history.sortFreq'));
    const countLabel = (n: number) => t('history.count', String(n));

    const timeOptions = computed(() => [
      { value: 'today' as TimeRange, label: t('history.filterToday') },
      { value: 'week' as TimeRange, label: t('history.filterWeek') },
      { value: 'all' as TimeRange, label: t('history.filterAll') },
    ]);

    /** 经过搜索 + 时间范围过滤后的条目 */
    const filteredItems = computed(() => {
      const keywordValue = keyword.value.trim().toLowerCase();
      const todayStart = startOfToday();
      const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000;
      return items.value.filter((item) => {
        if (keywordValue && !item.command.toLowerCase().includes(keywordValue)) return false;
        if (timeRange.value === 'today' && item.timestamp < todayStart) return false;
        if (timeRange.value === 'week' && item.timestamp < weekStart) return false;
        return true;
      });
    });

    /** 排序后的条目 */
    const sortedItems = computed(() => {
      const next = [...filteredItems.value];
      if (sortBy.value === 'freq') {
        next.sort((left, right) => right.count - left.count || right.timestamp - left.timestamp);
      } else {
        next.sort((left, right) => right.timestamp - left.timestamp);
      }
      return next;
    });

    /** 按天分组（仅时间排序时分组；频率排序时归入单组） */
    const dayGroups = computed<DayGroup[]>(() => {
      if (sortBy.value === 'freq') {
        return [{ key: 'freq', label: t('history.sortFreq'), items: sortedItems.value, count: sortedItems.value.length }];
      }
      const todayStart = startOfToday();
      const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
      const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000;
      const groups = new Map<string, DayGroup>();
      for (const item of sortedItems.value) {
        let label: string;
        let key: string;
        if (item.timestamp >= todayStart) {
          key = 'today';
          label = t('history.dayToday');
        } else if (item.timestamp >= yesterdayStart) {
          key = 'yesterday';
          label = t('history.dayYesterday');
        } else if (item.timestamp >= weekStart) {
          key = 'week';
          label = t('history.dayThisWeek');
        } else {
          key = dateKey(item.timestamp);
          const date = new Date(item.timestamp);
          label = `${date.getMonth() + 1}月${date.getDate()}日`;
        }
        const existing = groups.get(key);
        if (existing) {
          existing.items.push(item);
          existing.count += 1;
        } else {
          groups.set(key, { key, label, items: [item], count: 1 });
        }
      }
      return Array.from(groups.values());
    });

    function formatClock(timestamp: number): string {
      const date = new Date(timestamp);
      return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }

    /** 来源终端标签：暂以 cwd 作为上下文，缺省回退为「本地」 */
    function terminalTag(item: CommandHistoryEntry): string {
      if (!item.cwd) return t('history.terminalLocal');
      const trimmed = item.cwd.trim();
      if (!trimmed) return t('history.terminalLocal');
      const segments = trimmed.split('/').filter(Boolean);
      return segments.length ? segments[segments.length - 1] : t('history.terminalLocal');
    }

    function renderCommand(command: string): string {
      return tokenizeCommand(command);
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
      const lines = sortedItems.value.map((item) => {
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
      showMessage(t('history.exportSuccess', String(sortedItems.value.length)), 'success');
    }

    onMounted(() => {
      void loadHistory();
    });

    return {
      t,
      keyword, timeRange, sortBy,
      titleLabel, subtitleLabel, emptyLabel, exportLabel, clearLabel,
      searchPlaceholder, sortTimeLabel, sortFreqLabel,
      timeOptions, dayGroups,
      countLabel, formatClock, terminalTag, renderCommand,
      sendCommand, clearHistory, exportHistory,
    };
  },
});
