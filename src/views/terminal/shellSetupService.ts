import { invoke } from '@tauri-apps/api/core';

/** Shell 环境各组件安装状态 */
export interface ShellSetupStatus {
  syntaxHighlighting: boolean;
  autosuggestions: boolean;
  starship: boolean;
  starshipPath: string | null;
}

/** 安装结果 */
export interface ShellSetupResult {
  success: boolean;
  syntaxHighlighting: boolean;
  autosuggestions: boolean;
  starship: boolean;
  errors: string[];
}

export const shellSetupService = {
  /** 检测各组件是否已安装（不触发安装） */
  check: () => invoke<ShellSetupStatus>('check_shell_setup'),

  /** 执行完整安装（幂等） */
  setup: () => invoke<ShellSetupResult>('run_shell_setup'),
};
