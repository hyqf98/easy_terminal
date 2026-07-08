import type { ICommandSourceStrategy } from './CommandSourceStrategy';
import type { SuggestionItem, CommandMapping } from '../../../types';
import { invoke } from '@tauri-apps/api/core';

export class MappingCommandStrategy implements ICommandSourceStrategy {
  readonly sourceType = 'mapping';
  readonly label = 'Mapping';

  async search(keyword: string, limit = 10): Promise<SuggestionItem[]> {
    const mappings = await invoke<CommandMapping[]>('get_command_mappings');
    const active = mappings.filter((m) => m.enabled);
    const filtered = keyword
      ? active.filter((m) =>
          m.trigger.toLowerCase().includes(keyword.toLowerCase()) ||
          m.command.toLowerCase().includes(keyword.toLowerCase()) ||
          m.description.toLowerCase().includes(keyword.toLowerCase())
        )
      : active;
    return filtered.slice(0, limit).map((m) => ({
      id: `mapping-${m.id}`,
      type: 'mapping' as const,
      title: m.trigger,
      subtitle: '',
      description: m.description,
      insertText: m.command,
      executeText: m.command,
      usage: '',
      hint: m.hint,
      examples: m.examples,
      aliases: [],
      tags: m.tags,
      category: 'mapping',
      sourceLabel: 'Mapping',
      score: 50,
    }));
  }
}
