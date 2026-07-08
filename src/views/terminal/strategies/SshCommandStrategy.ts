import type { ICommandSourceStrategy } from './CommandSourceStrategy';
import type { SuggestionItem, SSHProfile } from '../../../types';
import { invoke } from '@tauri-apps/api/core';

export class SshCommandStrategy implements ICommandSourceStrategy {
  readonly sourceType = 'command';
  readonly label = 'SSH';

  async search(keyword: string, _limit = 5): Promise<SuggestionItem[]> {
    if (!keyword.toLowerCase().startsWith('ssh')) return [];
    const profiles = await invoke<SSHProfile[]>('get_ssh_profiles');
    return profiles.map((p) => ({
      id: `ssh-${p.id}`,
      type: 'command' as const,
      title: `ssh ${p.user}@${p.host}`,
      subtitle: p.name,
      description: `SSH to ${p.name} (${p.host}:${p.port})`,
      insertText: `ssh ${p.user}@${p.host} -p ${p.port}`,
      executeText: `ssh ${p.user}@${p.host} -p ${p.port}`,
      usage: `ssh ${p.user}@${p.host} -p ${p.port}`,
      hint: undefined,
      examples: [],
      aliases: [],
      tags: ['ssh'],
      category: 'ssh',
      sourceLabel: 'SSH',
      score: 80,
    }));
  }
}
