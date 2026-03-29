import { invoke } from '@tauri-apps/api/core';
import type {
  CommandConfig,
  CommandEntry,
  CommandHistoryEntry,
  CommandMapping,
  SuggestionItem,
} from './types';
import { t } from './i18n';

type Listener = () => void;

interface CandidateText {
  value: string;
  weight: number;
}

export interface GhostSuggestion {
  item: SuggestionItem;
  text: string;
}

export interface ExecutionResolution {
  command: string;
  source: 'mapping' | 'direct';
  item?: SuggestionItem;
}

export class CommandIntelligence {
  private platform = '';
  private commandConfigs: CommandConfig[] = [];
  private mappings: CommandMapping[] = [];
  private history: CommandHistoryEntry[] = [];
  private listeners = new Set<Listener>();

  async init() {
    await this.reloadAll();
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emitChange() {
    this.listeners.forEach((listener) => listener());
  }

  async reloadAll() {
    const [platform, commandConfigs, mappings, history] = await Promise.all([
      invoke<string>('get_platform'),
      invoke<CommandConfig[]>('load_commands'),
      invoke<CommandMapping[]>('load_command_mappings'),
      invoke<CommandHistoryEntry[]>('load_command_history'),
    ]);
    this.platform = platform;
    this.commandConfigs = commandConfigs;
    this.mappings = mappings;
    this.history = history.sort((left, right) => right.timestamp - left.timestamp);
    this.emitChange();
  }

  async reloadCommands() {
    this.commandConfigs = await invoke<CommandConfig[]>('load_commands');
    this.emitChange();
  }

  async reloadMappings() {
    this.mappings = await invoke<CommandMapping[]>('load_command_mappings');
    this.emitChange();
  }

  async reloadHistory() {
    this.history = await invoke<CommandHistoryEntry[]>('load_command_history');
    this.history.sort((left, right) => right.timestamp - left.timestamp);
    this.emitChange();
  }

  getPlatform(): string {
    return this.platform;
  }

  getCommandConfigs(): CommandConfig[] {
    return this.commandConfigs.map((config) => ({
      ...config,
      commands: config.commands.map((command) => normalizeCommandEntry(command)),
    }));
  }

  getMappings(): CommandMapping[] {
    return this.mappings.map((mapping) => ({
      ...mapping,
      tags: [...mapping.tags],
      examples: [...mapping.examples],
    }));
  }

  getHistory(): CommandHistoryEntry[] {
    return this.history.map((entry) => ({ ...entry }));
  }

  async saveMappings(entries: CommandMapping[]) {
    await invoke('save_command_mappings', { entries });
    this.mappings = entries;
    this.emitChange();
  }

  async saveHistory(entries: CommandHistoryEntry[]) {
    await invoke('save_command_history', { entries });
    this.history = entries.sort((left, right) => right.timestamp - left.timestamp);
    this.emitChange();
  }

  async recordHistory(command: string, cwd: string) {
    const entry: CommandHistoryEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      command: command.trim(),
      cwd,
      timestamp: Date.now(),
      count: 1,
    };
    this.history = await invoke<CommandHistoryEntry[]>('record_command_history', { entry });
    this.history.sort((left, right) => right.timestamp - left.timestamp);
    this.emitChange();
  }

  getSuggestionItems(query: string): SuggestionItem[] {
    const normalizedQuery = normalize(query);
    if (!normalizedQuery) return [];

    const items = [
      ...this.commandItems(),
      ...this.mappingItems(),
      ...this.historyItems(),
    ];

    const scored = items
      .map((item) => ({ item, score: this.scoreItem(item, normalizedQuery) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.item.title.localeCompare(right.item.title, 'zh-CN'))
      .slice(0, 12)
      .map((entry) => ({ ...entry.item, score: entry.score }));

    return scored;
  }

  getGhostSuggestion(input: string): GhostSuggestion | null {
    const trimmed = input.trimStart();
    if (!trimmed) return null;

    const suggestions = this.getSuggestionItems(trimmed);
    const top = this.pickGhostCandidate(trimmed, suggestions);
    if (!top) return null;

    const ghost = this.buildGhostText(top, trimmed);
    if (!ghost) return null;
    return {
      item: top,
      text: ghost,
    };
  }

  resolveExecution(input: string): ExecutionResolution {
    const trimmed = input.trim();
    const mapping = this.findExactMapping(trimmed);
    if (mapping) {
      return {
        command: mapping.command,
        source: 'mapping',
        item: mappingToSuggestionItem(mapping),
      };
    }
    return {
      command: trimmed,
      source: 'direct',
    };
  }

  private findExactMapping(input: string): CommandMapping | null {
    const normalizedInput = normalize(input);
    if (!normalizedInput) return null;
    for (const mapping of this.mappings) {
      if (!mapping.enabled) continue;
      const fields = [mapping.trigger, ...mapping.tags];
      if (fields.some((field) => normalize(field) === normalizedInput)) {
        return mapping;
      }
    }
    return null;
  }

  private pickGhostCandidate(input: string, items: SuggestionItem[]): SuggestionItem | null {
    if (items.length === 0) return null;
    const firstToken = tokenize(input)[0] || '';
    if (!firstToken) return items[0];

    const exact = items.find((item) => this.matchesTokenExactly(item, firstToken));
    if (exact) return exact;

    const prefix = items.find((item) => this.matchesTokenByPrefix(item, firstToken));
    return prefix || items[0];
  }

  private buildGhostText(item: SuggestionItem, input: string): string {
    const trimmed = input.trimStart();
    const firstToken = trimmed.split(/\s+/)[0] || '';
    const exactToken = this.matchesTokenExactly(item, firstToken);
    const insertPrefix = commonPrefixLength(trimmed, item.insertText);
    const hint = resolveHintText(item);

    if (insertPrefix < item.insertText.length && insertPrefix === trimmed.length) {
      const remainder = item.insertText.slice(insertPrefix);
      const suffix = hint ? ` ${hint}` : '';
      return `${remainder}${suffix}`;
    }

    if (exactToken && hint) {
      const typedSuffix = trimmed.slice(firstToken.length);
      if (!typedSuffix) {
        return ` ${hint}`;
      }
      if (` ${hint}`.startsWith(typedSuffix)) {
        return ` ${hint}`.slice(typedSuffix.length);
      }
      return ` ${hint}`;
    }

    return '';
  }

  private matchesTokenExactly(item: SuggestionItem, token: string): boolean {
    const normalizedToken = normalize(token);
    if (!normalizedToken) return false;
    return this.itemTokenFields(item).some((field) => normalize(field) === normalizedToken);
  }

  private matchesTokenByPrefix(item: SuggestionItem, token: string): boolean {
    const normalizedToken = normalize(token);
    if (!normalizedToken) return false;
    return this.itemTokenFields(item).some((field) => normalize(field).startsWith(normalizedToken));
  }

  private itemTokenFields(item: SuggestionItem): string[] {
    return [
      item.title,
      item.subtitle,
      ...item.aliases,
      ...item.tags,
    ].filter(Boolean);
  }

  private scoreItem(item: SuggestionItem, query: string): number {
    const queryTokens = tokenize(query);
    let score = 0;
    let matchedAllTokens = true;

    for (const token of queryTokens) {
      let bestTokenScore = 0;
      for (const field of this.collectFields(item)) {
        const normalizedField = normalize(field.value);
        if (!normalizedField) continue;
        if (normalizedField === token) {
          bestTokenScore = Math.max(bestTokenScore, 210 + field.weight);
        } else if (normalizedField.startsWith(token)) {
          bestTokenScore = Math.max(bestTokenScore, 160 + field.weight + token.length);
        } else if (normalizedField.includes(token)) {
          bestTokenScore = Math.max(bestTokenScore, 120 + field.weight + Math.min(token.length, 8));
        } else if (token.length > 1 && tokenize(normalizedField).some((part) => part.startsWith(token))) {
          bestTokenScore = Math.max(bestTokenScore, 96 + field.weight);
        }
      }
      if (bestTokenScore === 0) {
        matchedAllTokens = false;
        break;
      }
      score += bestTokenScore;
    }

    if (!matchedAllTokens) return 0;

    const normalizedQuery = query.trim();
    if (normalize(item.title) === normalizedQuery) score += 48;
    if (normalize(item.insertText).startsWith(normalizedQuery)) score += 22;
    if (item.type === 'history') {
      score += Math.min(item.score, 30);
    }
    if (item.type === 'mapping') {
      score += 18;
    }

    return score;
  }

  private collectFields(item: SuggestionItem): CandidateText[] {
    return [
      { value: item.title, weight: 70 },
      { value: item.subtitle, weight: 56 },
      ...item.aliases.map((value) => ({ value, weight: 60 })),
      ...item.tags.map((value) => ({ value, weight: 58 })),
      { value: item.description, weight: 28 },
      { value: item.usage, weight: 26 },
      { value: item.insertText, weight: 24 },
      ...item.examples.map((value) => ({ value, weight: 16 })),
      { value: item.category, weight: 12 },
      { value: item.sourceLabel, weight: 8 },
    ];
  }

  private commandItems(): SuggestionItem[] {
    const items: SuggestionItem[] = [];
    for (const config of this.commandConfigs) {
      const category = config.id || config.platform;
      const sourceLabel = config.kind === 'system'
        ? t('cmd.sourceSystem')
        : t('cmd.sourceBuiltin');
      for (const entry of config.commands) {
        const normalized = normalizeCommandEntry(entry);
        items.push({
          id: `${category}:${normalized.name}`,
          type: 'command',
          title: normalized.name,
          subtitle: normalized.name_cn,
          description: normalized.description,
          insertText: normalized.command || normalized.name,
          executeText: normalized.command || normalized.name,
          usage: normalized.usage,
          hint: normalized.hint || resolveEntryHint(normalized),
          examples: normalized.examples,
          aliases: normalized.alias,
          tags: normalized.tags,
          category: normalized.category || category,
          sourceLabel,
          score: 0,
        });
      }
    }
    return items;
  }

  private mappingItems(): SuggestionItem[] {
    return this.mappings
      .filter((mapping) => mapping.enabled)
      .map((mapping) => mappingToSuggestionItem(mapping));
  }

  private historyItems(): SuggestionItem[] {
    return this.history.map((entry) => ({
      id: entry.id,
      type: 'history',
      title: entry.command,
      subtitle: entry.cwd,
      description: new Intl.DateTimeFormat(undefined, {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(entry.timestamp)),
      insertText: entry.command,
      executeText: entry.command,
      usage: entry.command,
      hint: '',
      examples: [],
      aliases: [],
      tags: [],
      category: t('history.title'),
      sourceLabel: t('history.sourceLabel'),
      score: Math.min(entry.count * 3, 30),
    }));
  }
}

function mappingToSuggestionItem(mapping: CommandMapping): SuggestionItem {
  return {
    id: mapping.id,
    type: 'mapping',
    title: mapping.trigger,
    subtitle: t('mapping.sourceLabel'),
    description: mapping.description,
    insertText: mapping.trigger,
    executeText: mapping.command,
    usage: mapping.command,
    hint: mapping.hint || mapping.command,
    examples: mapping.examples,
    aliases: [],
    tags: mapping.tags,
    category: t('mapping.title'),
    sourceLabel: t('mapping.sourceLabel'),
    score: 0,
  };
}

export function normalize(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, ' ');
}

function tokenize(value: string): string[] {
  return normalize(value).split(/[\s,，、;；/]+/).filter(Boolean);
}

function commonPrefixLength(left: string, right: string): number {
  const max = Math.min(left.length, right.length);
  let index = 0;
  while (index < max && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

export function normalizeCommandEntry(entry: Partial<CommandEntry>): CommandEntry {
  const command = (entry.command || entry.name || '').trim();
  return {
    name: (entry.name || command).trim(),
    alias: Array.isArray(entry.alias) ? entry.alias : [],
    name_cn: entry.name_cn || '',
    description: entry.description || '',
    usage: entry.usage || command,
    category: entry.category || '',
    command,
    tags: Array.isArray(entry.tags) ? entry.tags.filter(Boolean) : [],
    examples: Array.isArray(entry.examples) ? entry.examples.filter(Boolean) : [],
    hint: entry.hint || '',
  };
}

function resolveEntryHint(entry: CommandEntry): string {
  if (entry.hint.trim()) return entry.hint.trim();
  const key = normalize(entry.name);
  const builtin = DEFAULT_HINTS[key];
  if (builtin) return builtin;
  if (entry.usage && normalize(entry.usage) !== key) return entry.usage.trim();
  if (entry.examples.length > 0) return entry.examples[0];
  return '';
}

function resolveHintText(item: SuggestionItem): string {
  if (item.hint.trim()) return item.hint.trim();
  const builtin = DEFAULT_HINTS[normalize(item.title)];
  if (builtin) return builtin;
  if (item.usage && normalize(item.usage) !== normalize(item.title)) return item.usage.trim();
  if (item.examples.length > 0) return item.examples[0];
  return '';
}

const DEFAULT_HINTS: Record<string, string> = {
  rm: '-r 递归删除 -f 强制删除 -i 删除前确认',
  cp: '-r 复制目录 -f 覆盖目标 -v 显示复制过程',
  mv: '-f 强制覆盖 -n 不覆盖已有文件 -v 显示移动过程',
  mkdir: '-p 自动创建父目录 -m 设置权限',
  ssh: '-p 指定端口 -i 指定私钥 -L 本地端口转发',
  scp: '-P 指定端口 -r 复制目录 -i 指定私钥',
  git: 'status 查看状态 switch 切分支 commit -m 提交',
  npm: 'run 执行脚本 install 安装依赖 create 创建项目',
  pnpm: 'install 安装依赖 dev 启动开发 build 构建项目',
  python: '-m 执行模块 -V 查看版本 script.py 运行脚本',
  conda: 'activate 激活环境 create 创建环境 env list 查看环境',
  java: '-jar 运行 Jar -version 查看版本',
  docker: 'ps 查看容器 run 启动镜像 exec 进入容器',
  codex: '--sandbox danger-full-access --full-auto --no-alt-screen',
  claude: '--dangerously-skip-permissions --tmux',
};
