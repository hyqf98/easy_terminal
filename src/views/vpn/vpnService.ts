import { invoke } from '@tauri-apps/api/core';
import type { VpnProfile, VpnTunnelStatus, VpnTestResult } from '../../types';

// VPN 服务：封装与 Rust 后端的所有 Tauri IPC 调用。
// 命令参数采用 camelCase，由 Tauri 自动映射为后端的 snake_case
// （如 profileId → profile_id）。风格对齐 sshService.ts。
export const vpnService = {
  /** 加载所有 VPN 配置。 */
  loadVpnProfiles: () => invoke<VpnProfile[]>('load_vpn_profiles'),

  /**
   * 保存全部 VPN 配置。
   * @param entries - VPN 配置列表
   */
  saveVpnProfiles: (entries: VpnProfile[]) =>
    invoke<void>('save_vpn_profiles', { entries }),

  /**
   * 连接 VPN 隧道。
   * @param profile - VPN 配置
   * @returns 隧道 ID
   */
  vpnConnect: (profile: VpnProfile) =>
    invoke<string>('vpn_connect', { profile }),

  /**
   * 断开 VPN 隧道。
   * @param profileId - 配置 ID
   */
  vpnDisconnect: (profileId: string) =>
    invoke<void>('vpn_disconnect', { profileId }),

  /** 获取所有 VPN 隧道状态。 */
  vpnGetStatus: () => invoke<VpnTunnelStatus[]>('vpn_get_status'),

  /**
   * 测试 VPN 配置连接。
   * @param profile - VPN 配置
   * @returns 测试结果
   */
  vpnTestConnection: (profile: VpnProfile) =>
    invoke<VpnTestResult>('vpn_test_connection', { profile }),
};
