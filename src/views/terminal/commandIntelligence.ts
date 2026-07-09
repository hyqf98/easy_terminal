import { invoke } from '@tauri-apps/api/core';
import type {
  CommandDetail,
  CommandEntry,
  CommandHistoryEntry,
  CommandLibrarySummary,
  CommandMapping,
  CommandSummary,
  SSHProfile,
  SuggestionItem,
  SuggestionSourceType,
} from '../../types';
import { getLang, t } from '../../i18n';
import { buildSshStartupCommand, resolveSshKeyPath } from './commandIntercept';
import { parseCommandLine } from '../../utils/shellParse';
import { parsePlaceholders, hasPlaceholder } from '../../utils/placeholder';
import { Perf } from '../../utils/perf';

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
  private libraries: CommandLibrarySummary[] = [];
  private mappings: CommandMapping[] = [];
  private history: CommandHistoryEntry[] = [];
  private sshProfiles: SSHProfile[] = [];
  private detailCache = new Map<number, CommandDetail>();
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
    const [platform, libraries, mappings, history, sshProfiles] = await Promise.all([
      invoke<string>('get_platform'),
      invoke<CommandLibrarySummary[]>('list_command_libraries'),
      invoke<CommandMapping[]>('load_command_mappings'),
      invoke<CommandHistoryEntry[]>('load_command_history'),
      invoke<SSHProfile[]>('load_ssh_profiles'),
    ]);
    this.platform = platform;
    this.libraries = libraries;
    this.mappings = mappings;
    this.history = history.sort((left, right) => right.timestamp - left.timestamp);
    this.sshProfiles = sshProfiles;
    this.detailCache.clear();
    this.invalidateLocalCache();
    this.emitChange();
  }

  async reloadCommands() {
    this.libraries = await invoke<CommandLibrarySummary[]>('list_command_libraries');
    this.detailCache.clear();
    this.emitChange();
  }

  async reloadMappings() {
    this.mappings = await invoke<CommandMapping[]>('load_command_mappings');
    this.cachedMappingItems = null;
    this.emitChange();
  }

  async reloadHistory() {
    this.history = await invoke<CommandHistoryEntry[]>('load_command_history');
    this.history.sort((left, right) => right.timestamp - left.timestamp);
    this.cachedHistoryItems = null;
    this.emitChange();
  }

  getPlatform(): string {
    return this.platform;
  }

  getLibraries(): CommandLibrarySummary[] {
    return this.libraries.map((library) => ({
      ...library,
      platforms: [...library.platforms],
    }));
  }

  getMappings(): CommandMapping[] {
    return this.mappings.map((mapping) => ({
      ...mapping,
      tags: [...mapping.tags],
      platforms: [...(mapping.platforms || [])],
      examples: [...mapping.examples],
    }));
  }

  getHistory(): CommandHistoryEntry[] {
    return this.history.map((entry) => ({
      ...entry,
      variants: entry.variants.map((variant) => ({ ...variant })),
    }));
  }

  async saveMappings(entries: CommandMapping[]) {
    await invoke('save_command_mappings', { entries });
    this.mappings = entries;
    this.cachedMappingItems = null;
    this.emitChange();
  }

  async saveHistory(entries: CommandHistoryEntry[]) {
    await invoke('save_command_history', { entries });
    this.history = entries.sort((left, right) => right.timestamp - left.timestamp);
    this.cachedHistoryItems = null;
    this.emitChange();
  }

  async recordHistory(command: string, cwd: string) {
    const normalizedCommand = normalizeHistoryValue(command);
    const normalizedCwd = normalizeHistoryValue(cwd);
    if (!normalizedCommand) return;

    const entry: CommandHistoryEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      command: normalizedCommand,
      cwd: normalizedCwd,
      timestamp: Date.now(),
      count: 1,
      variants: [],
    };
    this.history = await invoke<CommandHistoryEntry[]>('record_command_history', { entry });
    this.history.sort((left, right) => right.timestamp - left.timestamp);
    this.cachedHistoryItems = null;
    this.emitChange();
  }

  async searchSuggestions(query: string): Promise<SuggestionItem[]> {
    Perf.mark('intelligence.searchSuggestions');
    const normalizedQuery = normalize(query);
    if (!normalizedQuery) return [];

    const [sshItems, commandItems] = await Promise.all([
      this.searchSshProfileCompletions(query, normalizedQuery),
      this.searchRemoteCommands(normalizedQuery),
    ]);
    const localItems = this.searchLocalItems(normalizedQuery);

    const ranked = [...commandItems, ...localItems]
      .sort((left, right) =>
        suggestionTypeRank(right.type) - suggestionTypeRank(left.type)
        || right.score - left.score
        || left.title.localeCompare(right.title, 'zh-CN'))
      .slice(0, 12);

    Perf.end('intelligence.searchSuggestions');
    return dedupeSuggestions([...sshItems, ...ranked]).slice(0, 12);
  }

  async hydrateSuggestionItem(item: SuggestionItem): Promise<SuggestionItem> {
    if (item.type !== 'command' || !item.commandId) {
      return item;
    }
    if ((item.examples.length > 0 && item.examples.length >= (item.exampleCount || 0))
      || (item.exampleCount || 0) === 0) {
      return item;
    }

    const detail = await this.getCommandDetail(item.commandId);
    if (!detail) return item;
    return {
      ...item,
      description: detail.description || item.description,
      usage: detail.usage || item.usage,
      hint: detail.hint || item.hint,
      aliases: [...detail.alias, ...detail.triggers],
      tags: [...detail.tags, ...detail.keywords],
      examples: [...detail.examples],
      exampleCount: detail.examples.length,
      firstExample: detail.examples[0] || item.firstExample,
      language: detail.language || item.language,
      libraryId: detail.libraryId,
    };
  }

  async getCommandDetail(id: number): Promise<CommandDetail | null> {
    if (this.detailCache.has(id)) {
      return this.detailCache.get(id)!;
    }
    const detail = await invoke<CommandDetail | null>('get_command_detail', { id });
    if (detail) {
      this.detailCache.set(id, detail);
    }
    return detail;
  }

  getGhostSuggestionForItem(input: string, item: SuggestionItem | null): GhostSuggestion | null {
    const trimmed = input.trimStart();
    if (!trimmed || !item) return null;

    const ghost = this.buildGhostText(item, trimmed);
    if (!ghost) return null;
    return {
      item,
      text: ghost,
    };
  }

  getGhostSuggestion(input: string): GhostSuggestion | null {
    const trimmed = input.trimStart();
    if (!trimmed) return null;
    const localItems = this.searchLocalItems(normalize(trimmed));
    const top = this.pickGhostCandidate(trimmed, localItems);
    return this.getGhostSuggestionForItem(trimmed, top);
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

  private async searchRemoteCommands(query: string): Promise<SuggestionItem[]> {
    Perf.mark('intelligence.searchRemoteCommands');
    const results = await invoke<CommandSummary[]>('search_command_summaries', {
      params: {
        keyword: query,
        limit: 16,
        enabledOnly: true,
      },
    });
    Perf.end('intelligence.searchRemoteCommands');
    return results.map((item, index) => commandSummaryToSuggestionItem(item, index));
  }

  private searchLocalItems(query: string): SuggestionItem[] {
    Perf.mark('intelligence.searchLocalItems');
    const items = [...this.mappingItems(), ...this.historyItems()];
    const result = items
      .map((item) => ({ item, score: this.scoreItem(item, query) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) =>
        suggestionTypeRank(right.item.type) - suggestionTypeRank(left.item.type)
        || right.score - left.score
        || left.item.title.localeCompare(right.item.title, 'zh-CN'))
      .map((entry) => ({ ...entry.item, score: entry.score }));
    Perf.end('intelligence.searchLocalItems');
    return result;
  }

  private findExactMapping(input: string): CommandMapping | null {
    const normalizedInput = normalize(input);
    if (!normalizedInput) return null;
    const preferredLang = getLang();
    for (const mapping of this.mappings) {
      if (!mapping.enabled) continue;
      // 任意触发短语命中即视为精确匹配
      const fields = [...mapping.triggers, ...localizedMappingFields(mapping, preferredLang)];
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
    if (!trimmed) return '';

    const replacement = resolveGhostReplacement(item);
    const normalizedInput = normalize(trimmed);
    const suffixGhost = buildSuffixGhost(trimmed, replacement);
    if (suffixGhost) return suffixGhost;
    if (item.type === 'completion' || item.type === 'history') return '';

    const firstToken = trimmed.split(/\s+/)[0] || '';
    const exactToken = this.matchesTokenExactly(item, firstToken);
    const prefixToken = this.matchesTokenByPrefix(item, firstToken);
    const hint = stripRepeatedCommandPrefix(resolveHintText(item), firstToken);

    if (exactToken && hint) {
      const typedSuffix = trimmed.slice(firstToken.length);
      const displayHint = ` ${hint}`;
      if (!typedSuffix) return displayHint;
      if (displayHint.startsWith(typedSuffix)) {
        return displayHint.slice(typedSuffix.length);
      }
      return '';
    }

    if (prefixToken && hint) {
      return ` ${hint}`;
    }

    if (containsNonAscii(trimmed) && replacement && (exactToken || prefixToken || this.matchesSemanticLookup(item, normalizedInput))) {
      return replacement;
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

  private matchesSemanticLookup(item: SuggestionItem, query: string): boolean {
    if (!query) return false;
    return [
      item.subtitle,
      item.description,
      item.category,
      item.language || '',
      ...item.aliases,
      ...item.tags,
      ...item.examples,
    ]
      .filter(Boolean)
      .some((field) => normalize(field).includes(query) || normalize(field).startsWith(query));
  }

  private scoreItem(item: SuggestionItem, query: string): number {
    const queryTokens = tokenize(query);
    const preferredLang = getLang();
    let score = 0;
    let matchedAllTokens = true;

    for (const token of queryTokens) {
      let bestTokenScore = 0;
      for (const field of this.collectFields(item)) {
        const normalizedField = normalize(field.value);
        if (!normalizedField) continue;
        const langBonus = preferredLanguageBonus(field.value, preferredLang);
        if (normalizedField === token) {
          bestTokenScore = Math.max(bestTokenScore, 210 + field.weight + langBonus);
        } else if (normalizedField.startsWith(token)) {
          bestTokenScore = Math.max(bestTokenScore, 160 + field.weight + token.length + langBonus);
        } else if (normalizedField.includes(token)) {
          bestTokenScore = Math.max(bestTokenScore, 120 + field.weight + Math.min(token.length, 8) + langBonus);
        } else if (token.length > 1 && tokenize(normalizedField).some((part) => part.startsWith(token))) {
          bestTokenScore = Math.max(bestTokenScore, 96 + field.weight + langBonus);
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
    score += sourcePriority(item.type);
    if (item.type === 'history') {
      score += Math.min(item.score, 30);
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

  private cachedMappingItems: SuggestionItem[] | null = null;
  private cachedHistoryItems: SuggestionItem[] | null = null;

  private invalidateLocalCache() {
    this.cachedMappingItems = null;
    this.cachedHistoryItems = null;
  }

  private mappingItems(): SuggestionItem[] {
    if (this.cachedMappingItems) return this.cachedMappingItems;
    this.cachedMappingItems = this.mappings
      .filter((mapping) => mapping.enabled)
      .map((mapping) => mappingToSuggestionItem(mapping));
    return this.cachedMappingItems;
  }

  private static historyDateFormatter = new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  private historyItems(): SuggestionItem[] {
    if (this.cachedHistoryItems) return this.cachedHistoryItems;
    const fmt = CommandIntelligence.historyDateFormatter;
    this.cachedHistoryItems = this.history.map((entry) => {
      const placeholders = hasPlaceholder(entry.command) ? parsePlaceholders(entry.command) : undefined;
      return {
        id: entry.id,
        type: 'history',
        title: entry.command,
        subtitle: entry.cwd || '-',
        description: `${fmt.format(new Date(entry.timestamp))} · ${entry.count}x · ${Math.max(entry.variants.length, 1)} ctx`,
        insertText: placeholders?.insertText || entry.command,
        executeText: placeholders?.insertText || entry.command,
        usage: entry.command,
        hint: '',
        examples: [],
        aliases: [],
        tags: entry.variants.map((variant) => variant.cwd).filter(Boolean),
        category: t('history.title'),
        sourceLabel: t('history.sourceLabel'),
        score: Math.min(entry.count * 3, 30),
        placeholders,
      };
    });
    return this.cachedHistoryItems;
  }

  private async searchSshProfileCompletions(rawQuery: string, normalizedQuery: string): Promise<SuggestionItem[]> {
    const input = rawQuery.trim();
    const args = parseCommandLine(input);
    const command = (args[0] || '').toLowerCase();
    if (command !== 'ssh') {
      return [];
    }

    const searchTerm = normalize(args.slice(1).join(' '));
    const items = await Promise.all(
      this.sshProfiles.map((profile, index) => sshProfileToSuggestionItem(profile, this.sshProfiles, index))
    );
    return items
      .map((item) => {
        const query = searchTerm || normalizedQuery;
        const score = searchTerm ? this.scoreItem(item, query) : item.score + 40;
        return { item, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.item.title.localeCompare(right.item.title, 'zh-CN'))
      .map((entry) => ({ ...entry.item, score: entry.score }));
  }
}

function commandSummaryToSuggestionItem(item: CommandSummary, index: number): SuggestionItem {
  const sourceLabel = item.libraryKind === 'system'
    ? t('cmd.sourceSystem')
    : item.sourceType === 'builtin'
      ? t('cmd.sourceBuiltin')
      : t('cmd.sourceUser');

  const usageOrCommand = item.usage || item.command || item.name;
  const placeholders = hasPlaceholder(usageOrCommand) ? parsePlaceholders(usageOrCommand) : undefined;

  return {
    id: `${item.libraryId}:${item.commandKey}:${item.id}`,
    commandId: item.id,
    type: 'command',
    title: item.name,
    subtitle: item.name_cn,
    description: item.description,
    insertText: placeholders?.insertText || item.command || item.name,
    executeText: placeholders?.insertText || item.command || item.name,
    usage: usageOrCommand,
    hint: item.hint || item.firstExample || usageOrCommand,
    examples: item.firstExample ? [item.firstExample] : [],
    aliases: [...item.alias, ...item.triggers],
    tags: [...item.tags, ...item.keywords],
    category: item.category || item.libraryLabel,
    sourceLabel,
    score: 140 - index * 3,
    language: item.language || item.libraryLabel,
    libraryId: item.libraryId,
    exampleCount: item.exampleCount,
    firstExample: item.firstExample || undefined,
    placeholders,
  };
}

function mappingToSuggestionItem(mapping: CommandMapping): SuggestionItem {
  const preferredLang = getLang();
  const sourceLabel = mapping.sourceType === 'builtin'
    ? t('mapping.sourceBuiltin')
    : t('mapping.sourceLabel');
  const localizedTrigger = pickLocalizedValue([...mapping.triggers, ...mapping.examples], preferredLang)
    || mapping.triggers[0]
    || '';
  const placeholders = hasPlaceholder(mapping.command) ? parsePlaceholders(mapping.command) : undefined;
  return {
    id: mapping.id,
    type: 'mapping',
    title: localizedTrigger,
    subtitle: mapping.platforms && mapping.platforms.length > 0 ? mapping.platforms.join(', ') : t('mapping.sourceLabel'),
    description: mapping.description,
    insertText: placeholders?.insertText || mapping.command,
    executeText: placeholders?.insertText || mapping.command,
    usage: mapping.command,
    hint: mapping.hint || mapping.command,
    examples: mapping.examples,
    aliases: [...mapping.triggers],
    tags: mapping.tags,
    category: t('mapping.title'),
    sourceLabel,
    score: 0,
    language: 'mapping',
    placeholders,
  };
}

function dedupeSuggestions(items: SuggestionItem[]): SuggestionItem[] {
  const seen = new Set<string>();
  const result: SuggestionItem[] = [];
  for (const item of items) {
    const key = item.commandId ? `command:${item.commandId}` : `${item.type}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
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
    id: entry.id,
    commandKey: entry.commandKey || '',
    name: (entry.name || command).trim(),
    alias: Array.isArray(entry.alias) ? entry.alias : [],
    name_cn: entry.name_cn || '',
    description: entry.description || '',
    usage: entry.usage || command,
    category: entry.category || '',
    command,
    tags: Array.isArray(entry.tags) ? entry.tags.filter(Boolean) : [],
    examples: Array.isArray(entry.examples) ? entry.examples.filter(Boolean) : [],
    hint: entry.hint || resolveEntryHint(entry),
    language: entry.language || '',
    triggers: Array.isArray(entry.triggers) ? entry.triggers.filter(Boolean) : [],
    keywords: Array.isArray(entry.keywords) ? entry.keywords.filter(Boolean) : [],
    weight: typeof entry.weight === 'number' ? entry.weight : 0,
    enabled: typeof entry.enabled === 'boolean' ? entry.enabled : true,
    exampleCount: typeof entry.exampleCount === 'number' ? entry.exampleCount : (entry.examples?.length || 0),
    firstExample: entry.firstExample || entry.examples?.[0] || '',
    libraryId: entry.libraryId || '',
  };
}

function resolveEntryHint(entry: Partial<CommandEntry>): string {
  if (entry.hint?.trim()) return entry.hint.trim();
  const key = normalize(entry.name || '');
  const builtin = DEFAULT_HINTS[getLang()][key];
  if (builtin) return builtin;
  if (entry.usage && normalize(entry.usage) !== key) return entry.usage.trim();
  if (entry.examples && entry.examples.length > 0) return entry.examples[0];
  return '';
}

function resolveHintText(item: SuggestionItem): string {
  if (item.hint?.trim()) return item.hint.trim();
  const builtin = DEFAULT_HINTS[getLang()][normalize(item.title)];
  if (builtin) return builtin;
  if (item.usage && normalize(item.usage) !== normalize(item.title)) return item.usage.trim();
  if (item.examples.length > 0) return item.examples[0];
  return '';
}

function sourcePriority(type: SuggestionSourceType): number {
  switch (type) {
    case 'history':
      return 240;
    case 'mapping':
      return 160;
    case 'completion':
      return 120;
    case 'command':
    default:
      return 0;
  }
}

function suggestionTypeRank(type: SuggestionSourceType): number {
  switch (type) {
    case 'history':
      return 300;
    case 'mapping':
      return 200;
    case 'completion':
      return 150;
    case 'command':
      return 100;
    default:
      return 0;
  }
}

async function sshProfileToSuggestionItem(profile: SSHProfile, profiles: SSHProfile[], index: number): Promise<SuggestionItem> {
  const target = profile.user ? `${profile.user}@${profile.host}` : profile.host;
  let resolvedKeyPath: string | undefined;
  if (profile.authType === 'key' && profile.privateKeyPath) {
    resolvedKeyPath = await resolveSshKeyPath(profile.privateKeyPath);
  }
  const startup = buildSshStartupCommand(profile, profiles, resolvedKeyPath);
  const authLabel = profile.authType === 'key' ? 'SSH Key' : 'Password';
  const description = [
    profile.group || 'SSH',
    `${target}:${profile.port}`,
    authLabel,
    profile.jumpProfileId ? 'Jump Host' : '',
  ].filter(Boolean).join(' · ');

  return {
    id: `ssh-profile:${profile.id}`,
    type: 'completion',
    title: profile.name || target,
    subtitle: `${target}:${profile.port}`,
    description,
    insertText: startup,
    executeText: startup,
    usage: startup,
    hint: startup,
    examples: [],
    aliases: [profile.host, target, profile.user, profile.group].filter(Boolean) as string[],
    tags: [profile.group, profile.host, profile.user, String(profile.port), 'ssh'].filter(Boolean) as string[],
    category: 'SSH',
    sourceLabel: t('sidebar.ssh'),
    score: 220 - index * 2,
    language: 'ssh',
  };
}

function buildSuffixGhost(input: string, candidate: string): string {
  const trimmedCandidate = candidate.trim();
  if (!trimmedCandidate) return '';
  const prefix = commonPrefixLength(input, trimmedCandidate);
  if (prefix !== input.length || prefix >= trimmedCandidate.length) {
    return '';
  }
  return trimmedCandidate.slice(prefix);
}

function stripRepeatedCommandPrefix(hint: string, token: string): string {
  const trimmedHint = hint.trim();
  const trimmedToken = token.trim();
  if (!trimmedHint || !trimmedToken) return trimmedHint;

  const normalizedHint = normalize(trimmedHint);
  const normalizedToken = normalize(trimmedToken);
  if (normalizedHint === normalizedToken) return '';
  if (!normalizedHint.startsWith(`${normalizedToken} `)) {
    return trimmedHint;
  }

  return trimmedHint.slice(trimmedToken.length).trimStart();
}

function normalizeHistoryValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function resolveGhostReplacement(item: SuggestionItem): string {
  switch (item.type) {
    case 'mapping':
      return item.executeText || item.usage || item.insertText;
    case 'completion':
    case 'history':
      return item.insertText || item.executeText || item.usage;
    case 'command':
    default:
      return item.usage || item.insertText || item.executeText;
  }
}

function containsNonAscii(value: string): boolean {
  return /[^\u0000-\u007f]/.test(value);
}

function localizedMappingFields(mapping: CommandMapping, lang: ReturnType<typeof getLang>): string[] {
  const examples = mapping.examples.filter((value) => matchesLanguagePreference(value, lang));
  const tags = mapping.tags.filter((value) => matchesLanguagePreference(value, lang));
  const fallbackExamples = mapping.examples.filter((value) => !examples.includes(value));
  const fallbackTags = mapping.tags.filter((value) => !tags.includes(value));
  // 多触发短语：全部纳入匹配候选
  return [...mapping.triggers, ...examples, ...tags, ...fallbackExamples, ...fallbackTags].filter(Boolean);
}

function preferredLanguageBonus(value: string, lang: ReturnType<typeof getLang>): number {
  if (!value) return 0;
  const hasCjk = containsCjk(value);
  if (lang === 'zh-CN') {
    return hasCjk ? 18 : -6;
  }
  return hasCjk ? -8 : 14;
}

function pickLocalizedValue(values: string[], lang: ReturnType<typeof getLang>): string {
  const trimmed = values.map((value) => value.trim()).filter(Boolean);
  return trimmed.find((value) => matchesLanguagePreference(value, lang))
    || trimmed[0]
    || '';
}

function matchesLanguagePreference(value: string, lang: ReturnType<typeof getLang>): boolean {
  const hasCjk = containsCjk(value);
  return lang === 'zh-CN' ? hasCjk : !hasCjk;
}

function containsCjk(value: string): boolean {
  return /[\p{Script=Han}]/u.test(value);
}

const DEFAULT_HINTS: Record<ReturnType<typeof getLang>, Record<string, string>> = {
  'zh-CN': {
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
  },
  'en-US': {
    rm: '-r recursive -f force -i confirm before delete',
    cp: '-r copy directories -f overwrite target -v verbose output',
    mv: '-f force overwrite -n no clobber -v verbose output',
    mkdir: '-p create parent directories -m set permissions',
    ssh: '-p custom port -i identity file -L local port forward',
    scp: '-P custom port -r recursive copy -i identity file',
    git: 'status inspect repo switch branches commit -m message',
    npm: 'run scripts install dependencies create new project',
    pnpm: 'install dependencies dev start dev server build project',
    python: '-m run module -V show version script.py run script',
    conda: 'activate env create env env list show environments',
    java: '-jar run jar -version show version',
    docker: 'ps list containers run start image exec open shell',
    codex: '--sandbox danger-full-access --full-auto --no-alt-screen',
    claude: '--dangerously-skip-permissions --tmux',
  },
};
