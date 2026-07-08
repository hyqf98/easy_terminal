import { invoke } from '@tauri-apps/api/core';

export const ptyService = {
  create: (sessionId: string, cols: number, rows: number, cwd?: string, shell?: string) =>
    invoke('create_pty', { sessionId, cols, rows, cwd, shell }),

  write: (sessionId: string, data: string) =>
    invoke('write_pty', { sessionId, data }),

  resize: (sessionId: string, cols: number, rows: number) =>
    invoke('resize_pty', { sessionId, cols, rows }),

  kill: (sessionId: string) =>
    invoke('kill_pty', { sessionId }),
};
