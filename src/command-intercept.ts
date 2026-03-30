import type { SSHProfile } from './types';
import { parseCommandLine } from './shell-parse';

const PREVIEW_COMMANDS = new Set(['cat', 'type', 'more', 'less', 'bat', 'vim', 'nvim', 'vi']);

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

export function buildSshStartupCommand(profile: SSHProfile, profiles: SSHProfile[]): string {
  const target = profile.user ? `${profile.user}@${profile.host}` : profile.host;
  const jumpChain = resolveJumpChain(profile, profiles);
  const jumpArg = jumpChain.length > 0 ? ` -J ${jumpChain.join(',')}` : '';
  const keyArg = profile.authType === 'key' && profile.privateKeyPath ? ` -i ${profile.privateKeyPath}` : '';
  return `ssh${keyArg}${jumpArg} -p ${profile.port} ${target}`;
}

function resolvePath(cwd: string, input: string): string {
  if (isAbsolutePath(input)) return normalizeSlashes(input);
  const base = normalizeSlashes(cwd || '');
  if (!base) return normalizeSlashes(input);
  const separator = /[A-Za-z]:\//.test(base) ? '/' : '/';
  return normalizeSlashes(`${base.replace(/[\\/]+$/, '')}${separator}${input}`);
}

function isAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('/') || value.startsWith('\\\\');
}

function isRemoteTarget(value: string): boolean {
  return /^[\w.-]+@[\w.-]+:/.test(value);
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/');
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
