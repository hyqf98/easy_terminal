import type { ICommandSourceStrategy } from './CommandSourceStrategy';
import type { SuggestionItem } from '../../../types';
import { dbService } from '../../command/dbService';

export class SystemCommandStrategy implements ICommandSourceStrategy {
  readonly sourceType = 'command';
  readonly label = 'System';

  async search(keyword: string, limit = 20): Promise<SuggestionItem[]> {
    const page = await dbService.searchCommandSummaries({
      keyword,
      limit,
      enabledOnly: true,
    });
    return page.items.map((cmd) => ({
      id: `cmd-${cmd.libraryId}-${cmd.id}`,
      type: 'command' as const,
      commandId: cmd.id,
      title: cmd.name,
      subtitle: cmd.name_cn,
      description: cmd.description,
      insertText: cmd.command,
      executeText: cmd.command,
      usage: cmd.usage,
      hint: cmd.hint,
      examples: [],
      aliases: cmd.alias,
      tags: cmd.tags,
      category: cmd.category,
      sourceLabel: cmd.libraryLabel,
      score: cmd.weight,
      language: cmd.language,
      libraryId: cmd.libraryId,
      exampleCount: cmd.exampleCount,
      firstExample: cmd.firstExample ?? undefined,
    }));
  }
}
