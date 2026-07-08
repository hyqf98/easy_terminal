import type { ICommandSourceStrategy } from './CommandSourceStrategy';
import type { SuggestionItem } from '../../../types';
import { SystemCommandStrategy } from './SystemCommandStrategy';
import { HistoryCommandStrategy } from './HistoryCommandStrategy';
import { MappingCommandStrategy } from './MappingCommandStrategy';
import { SshCommandStrategy } from './SshCommandStrategy';

export { SystemCommandStrategy } from './SystemCommandStrategy';
export { HistoryCommandStrategy } from './HistoryCommandStrategy';
export { MappingCommandStrategy } from './MappingCommandStrategy';
export { SshCommandStrategy } from './SshCommandStrategy';
export type { ICommandSourceStrategy } from './CommandSourceStrategy';

const strategies: ICommandSourceStrategy[] = [
  new SystemCommandStrategy(),
  new HistoryCommandStrategy(),
  new MappingCommandStrategy(),
  new SshCommandStrategy(),
];

export async function searchAllSources(keyword: string, limit = 30): Promise<SuggestionItem[]> {
  const results = await Promise.all(
    strategies.map((s) => s.search(keyword, Math.ceil(limit / strategies.length)))
  );
  return results
    .flat()
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function getCommandStrategies(): ICommandSourceStrategy[] {
  return [...strategies];
}
