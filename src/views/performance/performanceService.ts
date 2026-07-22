import { invoke } from '@tauri-apps/api/core';
import type { PerformanceSnapshot, SSHProfile, TerminalLaunchOptions } from '../../types';

type Listener = (snapshot: PerformanceSnapshot | null, error: string | null) => void;
interface Target { key: string; profile?: SSHProfile }
interface Entry {
  target: Target;
  listeners: Set<Listener>;
  snapshot: PerformanceSnapshot | null;
  error: string | null;
  pending: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  interval: number;
  generation: number;
}
const entries = new Map<string, Entry>();

function targetFor(options: TerminalLaunchOptions, profiles: SSHProfile[]): Target {
  if (options.mode === 'ssh' && options.profileId) {
    const profile = profiles.find((item) => item.id === options.profileId);
    if (profile) return { key: `ssh:${profile.id}`, profile };
  }
  return { key: 'local' };
}

function effectiveInterval(target: Target, seconds: number): number {
  // Remote collection opens channels and runs multiple system commands. Keep
  // it intentionally slower even if a local panel is configured for 3s.
  return Math.max(target.profile ? 10 : 1, seconds) * 1000;
}

function clearTimer(entry: Entry): void {
  if (!entry.timer) return;
  clearTimeout(entry.timer);
  entry.timer = null;
}

function schedule(entry: Entry, delay = entry.interval): void {
  clearTimer(entry);
  if (!entries.has(entry.target.key) || entry.listeners.size === 0 || document.hidden) return;
  entry.timer = setTimeout(() => {
    entry.timer = null;
    void refresh(entry);
  }, delay);
}

async function refresh(entry: Entry): Promise<void> {
  if (entry.pending || !entries.has(entry.target.key) || document.hidden) return;
  entry.pending = true;
  const generation = entry.generation;
  try {
    const next = entry.target.profile
      ? await invoke<PerformanceSnapshot>('get_remote_performance_snapshot', { profile: entry.target.profile, profiles: [] })
      : await invoke<PerformanceSnapshot>('get_local_performance_snapshot');
    // A closed/rebound panel must never retain a late IPC response.
    if (!entries.has(entry.target.key) || entry.generation !== generation) return;
    entry.snapshot = next;
    entry.error = null;
  } catch (error) {
    if (!entries.has(entry.target.key) || entry.generation !== generation) return;
    entry.error = String(error);
  } finally {
    if (!entries.has(entry.target.key) || entry.generation !== generation) return;
    entry.pending = false;
    entry.listeners.forEach((listener) => listener(entry.snapshot, entry.error));
    schedule(entry);
  }
}

function resumeVisibleEntries(): void {
  if (document.hidden) return;
  entries.forEach((entry) => schedule(entry, 0));
}

document.addEventListener('visibilitychange', resumeVisibleEntries);

export function subscribePerformance(
  options: TerminalLaunchOptions,
  profiles: SSHProfile[],
  intervalSeconds: number,
  listener: Listener,
): () => void {
  const target = targetFor(options, profiles);
  let entry = entries.get(target.key);
  if (!entry) {
    entry = {
      target,
      listeners: new Set(),
      snapshot: null,
      error: null,
      pending: false,
      timer: null,
      interval: effectiveInterval(target, intervalSeconds),
      generation: 0,
    };
    entries.set(target.key, entry);
  }
  entry.listeners.add(listener);
  listener(entry.snapshot, entry.error);
  const interval = effectiveInterval(target, intervalSeconds);
  if (entry.interval !== interval) entry.interval = interval;
  schedule(entry, 0);
  return () => {
    const current = entries.get(target.key);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size === 0) {
      current.generation += 1;
      clearTimer(current);
      entries.delete(target.key);
    }
  };
}

/** Request an immediate refresh without tearing down the shared subscription. */
export function refreshPerformance(options: TerminalLaunchOptions, profiles: SSHProfile[]): void {
  const target = targetFor(options, profiles);
  const entry = entries.get(target.key);
  if (entry) schedule(entry, 0);
}

/** Stop a listener discovered in the same local or SSH target as this panel. */
export async function stopPerformancePortProcess(
  options: TerminalLaunchOptions,
  profiles: SSHProfile[],
  pid: number,
): Promise<void> {
  const target = targetFor(options, profiles);
  if (target.profile) {
    await invoke('stop_remote_port_process', { profile: target.profile, profiles: [], pid });
    return;
  }
  await invoke('stop_local_port_process', { pid });
}
