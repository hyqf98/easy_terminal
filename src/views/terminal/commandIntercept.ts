import type { SSHProfile } from '../../types';
import type { RuntimePlatform, TerminalFilePreviewRequest } from '../../types';
import { invoke } from '@tauri-apps/api/core';

const UNIX_PREVIEW_COMMANDS = new Set(['cat', 'more', 'less', 'bat', 'vim', 'nvim', 'vi']);
const WINDOWS_PREVIEW_COMMANDS = new Set([...UNIX_PREVIEW_COMMANDS, 'type', 'get-content', 'gc']);
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

export function parseFilePreviewCommand(
  commandLine: string,
  cwd: string,
  platform: RuntimePlatform,
  mode: 'local' | 'ssh',
  profileId?: string,
  terminalId = '',
): TerminalFilePreviewRequest | null {
  const args = parseLiteralCommand(commandLine, platform);
  if (!args || (args.length !== 2 && !(args.length === 3 && args[1] === '--'))) return null;

  const rawCommand = args[0];
  const command = platform === 'windows' ? rawCommand.toLowerCase() : rawCommand;
  const supported = platform === 'windows' ? WINDOWS_PREVIEW_COMMANDS : UNIX_PREVIEW_COMMANDS;
  if (!supported.has(command)) return null;

  const fileArg = args[args.length - 1];
  if (!fileArg || isUnsafeLiteralPath(fileArg) || isRemoteTarget(fileArg)) return null;
  const path = resolveLiteralPath(fileArg, cwd, platform, mode);
  if (!path) return null;

  return {
    terminalId,
    commandLine: commandLine.trim(),
    path,
    mode,
    profileId,
    readOnly: FILE_EDITOR_COMMANDS.has(command),
  };
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

/** Parse only plain words and quoted strings. Operators and incomplete quotes are rejected. */
function parseLiteralCommand(input: string, platform: RuntimePlatform): string[] | null {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | '' = '';
  let escaped = false;
  let tokenStarted = false;

  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (escaped) {
      current += char;
      escaped = false;
      tokenStarted = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = '';
      else if (char === '\\' && quote === '"') escaped = true;
      else current += char;
      tokenStarted = true;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      tokenStarted = true;
      continue;
    }
    if (char === '\\') {
      if (platform === 'windows') {
        current += char;
        tokenStarted = true;
        continue;
      }
      // A backslash is a Windows path separator when followed by another path segment;
      // otherwise it escapes the next shell character.
      if (/^[A-Za-z]:/.test(current) || current.includes('\\')) current += char;
      else escaped = true;
      tokenStarted = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (tokenStarted) {
        args.push(current);
        current = '';
        tokenStarted = false;
      }
      continue;
    }
    if ('|&;<>\r\n'.includes(char)) return null;
    current += char;
    tokenStarted = true;
  }
  if (quote || escaped) return null;
  if (tokenStarted) args.push(current);
  return args;
}

function isUnsafeLiteralPath(path: string): boolean {
  return path === '-' || path.startsWith('+') || path.includes('\0')
    || /[*?\[\]{}]/.test(path)
    || /[$`]|%[^%]+%/.test(path)
    || /^~[^/\\]/.test(path);
}

function resolveLiteralPath(
  input: string,
  cwd: string,
  platform: RuntimePlatform,
  mode: 'local' | 'ssh',
): string | null {
  if (mode === 'ssh') {
    if (input === '~' || input.startsWith('~/')) return null;
    if (input.startsWith('/')) return normalizePosix(input);
    if (!cwd || cwd === '~' || cwd.startsWith('~/') || !cwd.startsWith('/')) return null;
    return normalizePosix(`${cwd}/${input}`);
  }

  if (input === '~' || input.startsWith('~/')) return input;
  if (platform === 'windows') {
    const normalizedInput = input.replace(/\\/g, '/');
    if (/^[A-Za-z]:[^/]/.test(normalizedInput)) return null;
    if (/^[A-Za-z]:\//.test(normalizedInput) || normalizedInput.startsWith('//')) {
      return normalizeWindows(normalizedInput);
    }
    if (!cwd) return null;
    if (normalizedInput.startsWith('/')) {
      const drive = cwd.replace(/\\/g, '/').match(/^[A-Za-z]:/)?.[0];
      return drive ? normalizeWindows(`${drive}${normalizedInput}`) : null;
    }
    return normalizeWindows(`${cwd.replace(/\\/g, '/')}/${normalizedInput}`);
  }
  if (input.startsWith('/')) return normalizePosix(input);
  if (!cwd || !cwd.startsWith('/')) return null;
  return normalizePosix(`${cwd}/${input}`);
}

function normalizePosix(path: string): string {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `/${parts.join('/')}`;
}

function normalizeWindows(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const prefix = normalized.startsWith('//') ? '//' : (normalized.match(/^[A-Za-z]:/)?.[0] || '');
  const rest = prefix ? normalized.slice(prefix.length) : normalized;
  const parts: string[] = [];
  for (const part of rest.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return prefix === '//' ? `//${parts.join('/')}` : `${prefix}/${parts.join('/')}`;
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
