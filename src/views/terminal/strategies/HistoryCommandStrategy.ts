import type { ICommandSourceStrategy } from './CommandSourceStrategy';
import type { SuggestionItem, CommandHistoryEntry } from '../../../types';
import { invoke } from '@tauri-apps/api/core';

export class HistoryCommandStrategy implements ICommandSourceStrategy {
  readonly sourceType = 'history';
  readonly label = 'History';

  async search(keyword: string, limit = 10): Promise<SuggestionItem[]> {
    const history = await invoke<CommandHistoryEntry[]>('get_command_history');
    const filtered = keyword
      ? history.filter((h) => h.command.toLowerCase().includes(keyword.toLowerCase()))
      : history;
    return filtered.slice(0, limit).map((h) => ({
      id: `history-${h.id}`,
      type: 'history' as const,
      title: h.command,
      subtitle: '',
      description: `cwd: ${h.cwd}`,
      insertText: h.command,
      executeText: h.command,
      usage: '',
      hint: undefined,
      examples: [],
      aliases: [],
      tags: [],
      category: 'history',
      sourceLabel: 'History',
      score: h.count,
    }));
  }
}
