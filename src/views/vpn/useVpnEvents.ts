import { ref, onMounted, onUnmounted } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/** VPN 日志级别。 */
export type VpnLogLevel = 'info' | 'warning' | 'error';

/** VPN 日志条目（vpn-log 事件 payload）。 */
export interface VpnLogEntry {
  /** 对应的配置 ID。 */
  profileId: string;
  /** 日志级别：info / warning / error。 */
  level: VpnLogLevel;
  /** 日志内容。 */
  message: string;
  /** 时间戳（ISO 8601 字符串）。 */
  timestamp: string;
}

/** VPN 隧道状态变更事件（vpn-status 事件 payload）。 */
export interface VpnStatusEvent {
  /** 对应的配置 ID。 */
  profileId: string;
  /** 当前连接状态：disconnected / connecting / connected / error / reconnecting。 */
  state: string;
  /** 分配到的虚拟 IP（未连接时为空字符串）。 */
  ip: string;
  /** 已接收字节数。 */
  bytesIn: number;
  /** 已发送字节数。 */
  bytesOut: number;
}

/** 单个隧道最大日志缓存条数，超出后丢弃最早的日志。 */
const MAX_LOGS = 500;

/**
 * VPN 事件监听 composable。
 *
 * 在组件挂载时订阅 `vpn-status` 与 `vpn-log` 事件，卸载时自动取消订阅，
 * 返回响应式的隧道状态与日志集合，供视图层直接渲染。
 *
 * @returns tunnelStatuses - 隧道状态映射（profileId → 状态）
 * @returns logs - 日志映射（profileId → 日志列表）
 * @returns clearLogs - 清除指定隧道的日志
 * @returns clearAllLogs - 清除所有隧道的日志
 */
export function useVpnEvents() {
  /** 隧道状态映射：profileId → 最新状态事件。 */
  const tunnelStatuses = ref<Map<string, VpnStatusEvent>>(new Map());
  /** 日志映射：profileId → 日志条目列表。 */
  const logs = ref<Map<string, VpnLogEntry[]>>(new Map());

  let unlistenStatus: UnlistenFn | null = null;
  let unlistenLog: UnlistenFn | null = null;

  onMounted(async () => {
    // 监听隧道状态变更
    unlistenStatus = await listen<VpnStatusEvent>('vpn-status', (event) => {
      const payload = event.payload;
      tunnelStatuses.value.set(payload.profileId, payload);
      // 重新赋值以触发响应式更新
      tunnelStatuses.value = new Map(tunnelStatuses.value);
    });

    // 监听日志推送
    unlistenLog = await listen<VpnLogEntry>('vpn-log', (event) => {
      const payload = event.payload;
      const profileLogs = logs.value.get(payload.profileId) || [];
      profileLogs.push(payload);
      // 限制最大条数，丢弃最早的日志
      if (profileLogs.length > MAX_LOGS) {
        profileLogs.splice(0, profileLogs.length - MAX_LOGS);
      }
      logs.value.set(payload.profileId, profileLogs);
      // 重新赋值以触发响应式更新
      logs.value = new Map(logs.value);
    });
  });

  onUnmounted(() => {
    unlistenStatus?.();
    unlistenLog?.();
  });

  /**
   * 清除指定隧道的日志。
   * @param profileId - 配置 ID
   */
  function clearLogs(profileId: string) {
    logs.value.delete(profileId);
    logs.value = new Map(logs.value);
  }

  /** 清除所有隧道的日志。 */
  function clearAllLogs() {
    logs.value.clear();
    logs.value = new Map(logs.value);
  }

  return {
    tunnelStatuses,
    logs,
    clearLogs,
    clearAllLogs,
  };
}
