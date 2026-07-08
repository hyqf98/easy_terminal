import type { SuggestionItem } from '../../../types';

export interface ICommandSourceStrategy {
  readonly sourceType: string;
  readonly label: string;
  search(keyword: string, limit?: number): Promise<SuggestionItem[]>;
}
