/**
 * VPN 模块类型定义。
 *
 * 与后端 Tauri 命令（load_vpn_profiles / save_vpn_profiles / vpn_connect /
 * vpn_disconnect / vpn_get_status / vpn_test_connection）以及后端事件
 * （vpn-status / vpn-log）共享的 IPC 数据结构。
 */

/** VPN 配置文件的认证模式。 */
export type VpnAuthMode = 'cert' | 'password' | 'static-key';

/** VPN 隧道的连接状态。 */
export type VpnTunnelState = 'disconnected' | 'connecting' | 'connected' | 'error' | 'reconnecting';

/**
 * VPN 配置（对应一条 OpenVPN 隧道）。
 *
 * 通过 `load_vpn_profiles` / `save_vpn_profiles` 持久化，
 * 通过 `vpn_connect` / `vpn_disconnect` 控制连接。
 */
export interface VpnProfile {
  /** 配置唯一标识（通常为 UUID）。 */
  id: string;
  /** 配置显示名称，用于列表与标题展示。 */
  name: string;
  /** 所属分组名称，用于在侧栏按组归类。 */
  group: string;
  /** 原始 .ovpn 配置文本（OpenVPN 客户端配置文件内容）。 */
  ovpnConfig: string;
  /** 认证模式：证书 / 密码 / 静态密钥。 */
  authMode: VpnAuthMode;
  /** 用户名（password 认证模式下使用）。 */
  username: string;
  /** 密码（password 认证模式下使用）。 */
  password: string;
  /** 是否在应用启动时自动建立连接。 */
  autoConnect: boolean;
  /** 服务器主机地址（host 或 IP）。 */
  serverHost: string;
  /** 服务器端口号。 */
  serverPort: number;
}

/**
 * VPN 隧道实时状态。
 *
 * 由 `vpn_get_status` 批量返回，也通过 `vpn-status` 事件逐条推送。
 */
export interface VpnTunnelStatus {
  /** 对应的配置 ID。 */
  profileId: string;
  /** 当前连接状态。 */
  state: VpnTunnelState;
  /** 分配到的虚拟 IP（未连接时为空字符串）。 */
  ip: string;
  /** 已接收字节数。 */
  bytesIn: number;
  /** 已发送字节数。 */
  bytesOut: number;
  /** 连接建立时间（ISO 8601 字符串，未连接时为空）。 */
  connectedAt: string;
  /** 错误信息（state 为 error 时填充，其余为空）。 */
  errorMessage: string;
}

/**
 * VPN 连接测试结果。
 *
 * 由 `vpn_test_connection` 返回，用于在不正式连接的情况下验证配置可达性。
 */
export interface VpnTestResult {
  /** 测试是否成功。 */
  success: boolean;
  /** 结果描述信息（成功/失败原因）。 */
  message: string;
  /** 往返延迟（毫秒），测试成功时返回。 */
  latencyMs?: number;
}
