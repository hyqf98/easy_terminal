export type SuggestionSourceType = 'command' | 'mapping' | 'history' | 'completion';

export interface PlaceholderInfo {
  index: number;
  position: number;
  originalLength: number;
  label: string;
}

export interface ParsedPlaceholders {
  insertText: string;
  displayParts: Array<{ text: string; isPlaceholder: boolean; label: string }>;
  placeholders: PlaceholderInfo[];
  hasPlaceholders: boolean;
}

export interface SuggestionItem {
  id: string;
  type: SuggestionSourceType;
  commandId?: number;
  title: string;
  subtitle: string;
  description: string;
  insertText: string;
  executeText: string;
  usage: string;
  hint?: string;
  examples: string[];
  aliases: string[];
  tags: string[];
  category: string;
  sourceLabel: string;
  score: number;
  matchedField?: string;
  language?: string;
  libraryId?: string;
  exampleCount?: number;
  firstExample?: string;
  placeholders?: ParsedPlaceholders;
}

export interface CommandEntry {
  id?: number;
  commandKey?: string;
  name: string;
  alias: string[];
  name_cn: string;
  description: string;
  usage: string;
  category: string;
  command: string;
  tags: string[];
  examples: string[];
  hint?: string;
  language?: string;
  triggers?: string[];
  keywords?: string[];
  weight?: number;
  enabled?: boolean;
  exampleCount?: number;
  firstExample?: string;
  libraryId?: string;
}

export interface CommandConfig {
  schemaVersion?: number;
  id: string;
  kind: string;
  platforms: string[];
  commands: CommandEntry[];
  platform: string;
  label?: string;
  language?: string;
  sourceType?: string;
  enabled?: boolean;
}

export interface CommandLibrarySummary {
  id: string;
  label: string;
  kind: string;
  sourceType: string;
  platforms: string[];
  language: string;
  enabled: boolean;
  commandCount: number;
  current: boolean;
}

export interface CommandSummary {
  id: number;
  libraryId: string;
  commandKey: string;
  name: string;
  alias: string[];
  name_cn: string;
  description: string;
  usage: string;
  category: string;
  command: string;
  tags: string[];
  hint: string;
  language: string;
  triggers: string[];
  keywords: string[];
  weight: number;
  enabled: boolean;
  exampleCount: number;
  firstExample?: string | null;
  libraryKind: string;
  sourceType: string;
  libraryLabel: string;
}

export interface CommandDetail extends CommandSummary {
  examples: string[];
}

export interface CommandSummaryPage {
  items: CommandSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CommandLibraryPayload {
  id: string;
  label: string;
  kind: string;
  sourceType: string;
  platforms: string[];
  language: string;
  enabled: boolean;
}

export interface CommandPayload {
  id?: number | null;
  libraryId: string;
  commandKey?: string;
  name: string;
  alias: string[];
  name_cn: string;
  description: string;
  usage: string;
  category: string;
  command: string;
  tags: string[];
  examples: string[];
  hint: string;
  language: string;
  triggers: string[];
  keywords: string[];
  weight: number;
  enabled: boolean;
}

export interface CommandQueryParams {
  libraryId?: string;
  keyword?: string;
  kind?: string;
  category?: string;
  page?: number;
  pageSize?: number;
  enabledOnly?: boolean;
}

export interface CommandSearchParams {
  keyword: string;
  libraryIds?: string[];
  limit?: number;
  enabledOnly?: boolean;
}

export interface CommandHistoryEntry {
  id: string;
  command: string;
  cwd: string;
  timestamp: number;
  count: number;
  variants: CommandHistoryVariant[];
}

export interface CommandHistoryVariant {
  cwd: string;
  timestamp: number;
  count: number;
}

export interface CommandMapping {
  id: string;
  trigger: string;
  command: string;
  description: string;
  tags: string[];
  examples: string[];
  hint?: string;
  enabled: boolean;
  sourceType?: string;
  platforms?: string[];
}

export interface RemoteCommandLibrary {
  name: string;
  path: string;
  size: number;
  sha: string;
  downloadUrl: string;
  directory: 'system' | 'custom';
  isInstalled: boolean;
  commandCount: number;
  label: string;
  description: string;
  loaded: boolean;
}
