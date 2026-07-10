import type { SSHProfile } from '../../types';
import { parseCommandLine } from '../../utils/shellParse';
import { resolvePath } from '../../utils/path';
import { invoke } from '@tauri-apps/api/core';

const PREVIEW_COMMANDS = new Set(['cat', 'type', 'more', 'less', 'bat', 'vim', 'nvim', 'vi']);
const FILE_EDITOR_COMMANDS = new Set(['vim', 'nvim', 'vi']);

const sshKeyCache = new Map<string, string>();

export async function resolveSshKeyPath(privateKeyPath: string): Promise<string> {
    if (!privateKeyPath) return '';
    const cached = sshKeyCache.get(privateKeyPath);
    if (cached) return cached;
    try {
        const resolved = await invoke<string>('prepare_ssh_key', { privateKeyPath });
        sshKeyCache.set(privateKeyPath, resolved);
        return resolved;
    } catch {
        return privateKeyPath;
    }
}

export function buildSshStartupCommand(profile: SSHProfile, profiles: SSHProfile[], resolvedKeyPath?: string): string {
    const target = profile.user ? `${profile.user}@${profile.host}` : profile.host;
    const jumpChain = resolveJumpChain(profile, profiles);
    const jumpArg = jumpChain.length > 0 ? ` -J ${jumpChain.join(',')}` : '';
    const keyArg = profile.authType === 'key' && (resolvedKeyPath || profile.privateKeyPath) ? ` -i "${resolvedKeyPath || profile.privateKeyPath}"` : '';
    return `ssh${keyArg}${jumpArg} -o StrictHostKeyChecking=no -p ${profile.port} ${target}`;
}

export function resolvePreviewPath(commandLine: string, cwd: string): string | null {
  const args = parseCommandLine(commandLine);
  if (args.length < 2) return null;

  const command = args[0].toLowerCase();
  if (!PREVIEW_COMMANDS.has(command)) return null;

  const candidates = args.slice(1).filter((arg) => arg && !arg.startsWith('-') && !arg.startsWith('+'));
  const fileArg = command === 'vim' || command === 'nvim' || command === 'vi'
    ? candidates[candidates.length - 1]
    : candidates[0];

  if (!fileArg || isRemoteTarget(fileArg)) return null;
  return resolvePath(cwd, fileArg);
}

export function resolveSshPreviewPath(commandLine: string): string | null {
  const args = parseCommandLine(commandLine);
  if (args.length < 2) return null;

  const command = args[0].toLowerCase();
  if (!PREVIEW_COMMANDS.has(command)) return null;

  const candidates = args.slice(1).filter((arg) => arg && !arg.startsWith('-') && !arg.startsWith('+'));
  const fileArg = FILE_EDITOR_COMMANDS.has(command)
    ? candidates[candidates.length - 1]
    : candidates[0];

  if (!fileArg || isRemoteTarget(fileArg)) return null;
  return fileArg;
}

export function isFileEditorCommand(commandLine: string): boolean {
  const args = parseCommandLine(commandLine);
  if (args.length < 2) return false;
  return FILE_EDITOR_COMMANDS.has(args[0].toLowerCase());
}

export function buildSshPasswordSequence(profile: SSHProfile, profiles: SSHProfile[]): string[] {
  const lookup = new Map(profiles.map((item) => [item.id, item]));
  const queue: string[] = [];
  const visited = new Set<string>([profile.id]);

  let currentId = profile.jumpProfileId;
  const jumpProfiles: SSHProfile[] = [];
  while (currentId) {
    const current = lookup.get(currentId);
    if (!current || visited.has(currentId)) break;
    visited.add(currentId);
    jumpProfiles.unshift(current);
    currentId = current.jumpProfileId;
  }

  jumpProfiles.forEach((item) => {
    if (item.authType === 'password' && item.password) {
      queue.push(item.password);
    }
  });

  if (profile.authType === 'password' && profile.password) {
    queue.push(profile.password);
  }

  return queue;
}

function isRemoteTarget(value: string): boolean {
  return /^[\w.-]+@[\w.-]+:/.test(value);
}

function resolveJumpChain(profile: SSHProfile, profiles: SSHProfile[]): string[] {
  const lookup = new Map(profiles.map((item) => [item.id, item]));
  const chain: string[] = [];
  const visited = new Set<string>([profile.id]);

  let currentId = profile.jumpProfileId;
  while (currentId) {
    const current = lookup.get(currentId);
    if (!current || visited.has(currentId)) break;
    visited.add(currentId);
    chain.unshift(current.user ? `${current.user}@${current.host}:${current.port}` : `${current.host}:${current.port}`);
    currentId = current.jumpProfileId;
  }

  return chain;
}
