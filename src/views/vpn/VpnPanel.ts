import { defineComponent, ref, computed, onMounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { Icon } from '@vicons/utils';
import { ShieldLock } from '@vicons/tabler';
import { t } from '../../i18n';
import { showMessage } from '../../composables/useAppMessage';
import type { VpnProfile, VpnAuthMode, VpnTunnelState, VpnTestResult } from '../../types';
import { vpnService } from './vpnService';
import { useVpnEvents } from './useVpnEvents';
import VpnTunnelModal from '../../components/modals/VpnTunnelModal.vue';
import DeleteConfirmModal from '../../components/modals/DeleteConfirmModal.vue';

/** 未分组显示名（与列表中空 group 对应）。 */
const DEFAULT_GROUP = '未分组';

/** 分组结构（用于侧栏分组渲染）。 */
interface VpnFormGroup {
  name: string;
  profiles: VpnProfile[];
}

/**
 * VPN 面板：master-detail 布局，左侧配置列表 + 右侧详情 / 控制 / 日志。
 *
 * 风格对齐 SshPanel.ts：defineComponent + setup，使用 vpnService 封装 IPC，
 * useVpnEvents 订阅 vpn-status / vpn-log 事件。
 */
export default defineComponent({
  name: 'VpnPanel',
  components: { Icon, ShieldLock, VpnTunnelModal, DeleteConfirmModal },
  emits: ['profiles-change', 'selection-change'],
  setup(_, { emit }) {
    const profiles = ref<VpnProfile[]>([]);
    const selectedProfileId = ref('');
    const expandedGroups = ref<string[]>([]);
    const searchKeyword = ref('');
    const testing = ref(false);

    // 订阅 vpn-status / vpn-log 事件
    const { tunnelStatuses, logs, clearLogs } = useVpnEvents();

    // 新建 / 编辑隧道弹框状态
    const tunnelModalOpen = ref(false);
    const editingProfile = ref<VpnProfile | null>(null);

    // 删除确认弹框状态
    const deleteModalOpen = ref(false);
    const pendingDeleteProfile = ref<VpnProfile | null>(null);

    // ===== 文案（i18n） =====
    const titleLabel = computed(() => t('vpn.title'));
    const addLabel = computed(() => t('vpn.add'));
    const testLabel = computed(() => t('vpn.test'));
    const connectLabel = computed(() => t('vpn.connect'));
    const disconnectLabel = computed(() => t('vpn.disconnect'));
    const editLabel = computed(() => t('vpn.edit'));
    const deleteLabel = computed(() => t('vpn.delete'));
    const emptyLabel = computed(() => t('vpn.empty.title'));
    const emptyTitle = computed(() => t('vpn.empty.title'));
    const emptyDesc = computed(() => t('vpn.empty.desc'));
    const searchPlaceholder = computed(() => t('vpn.search'));
    const ungroupedLabel = DEFAULT_GROUP;
    const serverSectionLabel = computed(() => t('vpn.detail.server'));
    const serverLabel = computed(() => t('vpn.detail.server'));
    const assignedIpLabel = computed(() => t('vpn.detail.assigned_ip'));
    const trafficLabel = computed(() => t('vpn.detail.traffic'));
    const trafficInLabel = computed(() => t('vpn.detail.traffic.in'));
    const trafficOutLabel = computed(() => t('vpn.detail.traffic.out'));
    const logsLabel = computed(() => t('vpn.detail.logs'));
    const logsEmptyLabel = '暂无日志';

    // ===== 计算属性 =====

    /** 已有分组集合（供弹框分组下拉使用）。 */
    const availableGroups = computed(() => {
      const set = new Set<string>();
      for (const profile of profiles.value) {
        if (profile.group) set.add(profile.group);
      }
      return [...set].sort();
    });

    /** 按搜索关键字过滤后的分组列表。 */
    const filteredGrouped = computed<VpnFormGroup[]>(() => {
      const keyword = searchKeyword.value.trim().toLowerCase();
      const map = new Map<string, VpnProfile[]>();
      for (const profile of profiles.value) {
        if (keyword) {
          const haystack = `${profile.name} ${profile.group} ${profile.serverHost}`.toLowerCase();
          if (!haystack.includes(keyword)) continue;
        }
        const groupName = profile.group || DEFAULT_GROUP;
        let list = map.get(groupName);
        if (!list) {
          list = [];
          map.set(groupName, list);
        }
        list.push(profile);
      }
      const groups = [...map.entries()].map(([name, list]) => ({ name, profiles: list }));
      // 首次加载时默认展开所有分组
      if (expandedGroups.value.length === 0 && groups.length > 0) {
        expandedGroups.value = groups.map((group) => group.name);
      }
      return groups;
    });

    const selectedProfile = computed(() =>
      profiles.value.find((profile) => profile.id === selectedProfileId.value) || null
    );

    /** 当前选中隧道的实时状态。 */
    const currentTunnelStatus = computed(() =>
      selectedProfileId.value ? tunnelStatuses.value.get(selectedProfileId.value) || null : null
    );

    /** 是否展示流量统计（仅在 connected 时）。 */
    const showTraffic = computed(
      () => !!currentTunnelStatus.value && currentTunnelStatus.value.state === 'connected'
    );

    /** 当前隧道的日志列表。 */
    const currentLogs = computed(() =>
      selectedProfileId.value ? logs.value.get(selectedProfileId.value) || [] : []
    );

    /** 删除确认弹框富文本提示。 */
    const deleteMessage = computed(() => {
      const profile = pendingDeleteProfile.value;
      if (!profile) return '';
      return `即将删除 VPN 配置 <strong>${profile.name || profile.serverHost}</strong>（${profile.serverHost}:${profile.serverPort}）。<br>此操作不可撤销，正在进行的连接将被强制断开。`;
    });

    // ===== 状态映射辅助 =====

    /** 取隧道状态字符串（来自事件 payload，缺省视为 disconnected）。 */
    function resolveState(profileId: string): VpnTunnelState {
      const status = tunnelStatuses.value.get(profileId);
      return (status?.state as VpnTunnelState) || 'disconnected';
    }

    function getTunnelStateClass(profileId: string): string {
      return resolveState(profileId);
    }

    function getTunnelStateText(profileId: string): string {
      return stateText(resolveState(profileId));
    }

    function getStatusPulseClass(profileId: string): string {
      const state = resolveState(profileId);
      if (state === 'connected') return 'green';
      if (state === 'connecting' || state === 'reconnecting') return 'yellow';
      if (state === 'error') return 'red';
      return 'offline';
    }

    function getStatusTagClass(profileId: string): string {
      const state = resolveState(profileId);
      if (state === 'connected') return 'tag tag-green';
      if (state === 'connecting' || state === 'reconnecting') return 'tag tag-yellow';
      if (state === 'error') return 'tag tag-mauve';
      return 'tag tag-muted';
    }

    function getStatusText(profileId: string): string {
      return stateText(resolveState(profileId));
    }

    function stateText(state: VpnTunnelState): string {
      switch (state) {
        case 'connected':
          return t('vpn.status.connected');
        case 'connecting':
          return t('vpn.status.connecting');
        case 'reconnecting':
          return t('vpn.status.reconnecting');
        case 'error':
          return t('vpn.status.error');
        default:
          return t('vpn.status.disconnected');
      }
    }

    function isConnected(profileId: string): boolean {
      return resolveState(profileId) === 'connected';
    }

    /** 认证模式显示文案。 */
    function authModeText(mode: VpnAuthMode): string {
      if (mode === 'cert') return t('vpn.modal.auth.cert');
      if (mode === 'password') return t('vpn.modal.auth.password');
      return t('vpn.modal.auth.static_key');
    }

    // ===== 格式化 =====

    /** 字节数 → 可读字符串（KB / MB / GB）。 */
    function formatBytes(bytes: number): string {
      if (!bytes || bytes < 0) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let value = bytes;
      let index = 0;
      while (value >= 1024 && index < units.length - 1) {
        value /= 1024;
        index += 1;
      }
      return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[index]}`;
    }

    /** ISO 时间戳 → HH:MM:SS。 */
    function formatTime(iso: string): string {
      if (!iso) return '--:--:--';
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return '--:--:--';
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    }

    // ===== 分组折叠 =====

    function isGroupExpanded(name: string): boolean {
      return expandedGroups.value.includes(name);
    }

    function toggleGroup(name: string) {
      const index = expandedGroups.value.indexOf(name);
      if (index >= 0) {
        expandedGroups.value.splice(index, 1);
      } else {
        expandedGroups.value.push(name);
      }
    }

    // ===== 数据加载 / 持久化 =====

    async function reload() {
      try {
        profiles.value = await vpnService.loadVpnProfiles();
        emit('profiles-change', profiles.value);
        // 同步已有隧道状态（覆盖事件可能尚未推送的配置）
        try {
          const statuses = await vpnService.vpnGetStatus();
          for (const status of statuses) {
            // tunnelStatuses 存储 VpnStatusEvent 结构（vpn-status 事件 payload），
            // connectedAt / errorMessage 仅 vpn_get_status 返回，此处仅同步事件字段
            tunnelStatuses.value.set(status.profileId, {
              profileId: status.profileId,
              state: status.state,
              ip: status.ip,
              bytesIn: status.bytesIn,
              bytesOut: status.bytesOut,
            });
          }
          tunnelStatuses.value = new Map(tunnelStatuses.value);
        } catch {
          /* 状态查询失败不阻断配置加载 */
        }
      } catch {
        /* 忽略加载失败 */
      }
    }

    async function persistProfiles(next: VpnProfile[]) {
      await vpnService.saveVpnProfiles(next);
      await reload();
    }

    // ===== 交互 =====

    function selectProfile(profile: VpnProfile) {
      selectedProfileId.value = profile.id;
      emit('selection-change', profile, profiles.value);
    }

    async function connectProfile(profile: VpnProfile) {
      selectedProfileId.value = profile.id;
      emit('selection-change', profile, profiles.value);
      try {
        showMessage(t('vpn.msg.connecting', profile.name || profile.serverHost), 'info');
        await vpnService.vpnConnect(profile);
        showMessage(t('vpn.msg.connected'), 'success');
      } catch (error) {
        showMessage(t('vpn.msg.connect_failed', String(error)), 'error');
      }
    }

    async function disconnectProfile(profile: VpnProfile) {
      try {
        await vpnService.vpnDisconnect(profile.id);
        showMessage(t('vpn.msg.disconnected'), 'success');
      } catch (error) {
        showMessage(`断开失败: ${String(error)}`, 'error');
      }
    }

    function openAdd() {
      editingProfile.value = null;
      tunnelModalOpen.value = true;
    }

    function editProfile(profile: VpnProfile) {
      editingProfile.value = profile;
      tunnelModalOpen.value = true;
    }

    function closeTunnelModal() {
      tunnelModalOpen.value = false;
      editingProfile.value = null;
    }

    async function onTunnelSave(profile: VpnProfile) {
      const next = [...profiles.value];
      const existingIndex = next.findIndex((item) => item.id === profile.id);
      if (existingIndex >= 0) {
        next[existingIndex] = profile;
      } else {
        next.unshift(profile);
      }
      try {
        await persistProfiles(next);
        selectedProfileId.value = profile.id;
        tunnelModalOpen.value = false;
        editingProfile.value = null;
        showMessage(t('vpn.msg.save_success'), 'success');
      } catch (error) {
        showMessage(`保存失败: ${String(error)}`, 'error');
      }
    }

    async function onTunnelTest(profile: VpnProfile) {
      testing.value = true;
      try {
        const result: VpnTestResult = await vpnService.vpnTestConnection(profile);
        if (result.success) {
          const latency = typeof result.latencyMs === 'number' ? ` (${result.latencyMs}ms)` : '';
          showMessage(`${result.message}${latency}`, 'success');
        } else {
          showMessage(result.message || '测试失败', 'warning');
        }
      } catch (error) {
        showMessage(`测试失败: ${String(error)}`, 'error');
      } finally {
        testing.value = false;
      }
    }

    async function testSelected() {
      const profile = selectedProfile.value;
      if (!profile) return;
      await onTunnelTest(profile);
    }

    function confirmDelete(profile: VpnProfile) {
      pendingDeleteProfile.value = profile;
      deleteModalOpen.value = true;
    }

    async function onConfirmDelete() {
      const profile = pendingDeleteProfile.value;
      if (!profile) return;
      // 删除前先断开（避免残留连接）
      try {
        await vpnService.vpnDisconnect(profile.id);
      } catch {
        /* 忽略断开失败 */
      }
      const next = profiles.value.filter((item) => item.id !== profile.id);
      try {
        await persistProfiles(next);
        clearLogs(profile.id);
        if (selectedProfileId.value === profile.id) {
          selectedProfileId.value = '';
          emit('selection-change', null, profiles.value);
        }
        showMessage(t('vpn.msg.delete_success'), 'success');
      } catch (error) {
        showMessage(`删除失败: ${String(error)}`, 'error');
      } finally {
        deleteModalOpen.value = false;
        pendingDeleteProfile.value = null;
      }
    }

    function clearCurrentLogs() {
      if (selectedProfileId.value) {
        clearLogs(selectedProfileId.value);
      }
    }

    function setActiveProfile(profileId: string | null) {
      selectedProfileId.value = profileId || '';
    }

    onMounted(() => {
      void reload();
    });

    return {
      // 状态
      profiles,
      selectedProfileId,
      selectedProfile,
      searchKeyword,
      testing,
      tunnelModalOpen,
      editingProfile,
      deleteModalOpen,
      deleteMessage,
      availableGroups,
      filteredGrouped,
      currentTunnelStatus,
      showTraffic,
      currentLogs,
      // 文案
      titleLabel,
      addLabel,
      testLabel,
      connectLabel,
      disconnectLabel,
      editLabel,
      deleteLabel,
      emptyLabel,
      emptyTitle,
      emptyDesc,
      searchPlaceholder,
      ungroupedLabel,
      serverSectionLabel,
      serverLabel,
      assignedIpLabel,
      trafficLabel,
      trafficInLabel,
      trafficOutLabel,
      logsLabel,
      logsEmptyLabel,
      // 方法
      isGroupExpanded,
      toggleGroup,
      selectProfile,
      connectProfile,
      disconnectProfile,
      openAdd,
      editProfile,
      closeTunnelModal,
      onTunnelSave,
      onTunnelTest,
      testSelected,
      confirmDelete,
      onConfirmDelete,
      clearCurrentLogs,
      setActiveProfile,
      getTunnelStateClass,
      getTunnelStateText,
      getStatusPulseClass,
      getStatusTagClass,
      getStatusText,
      isConnected,
      authModeText,
      formatBytes,
      formatTime,
      reload,
    };
  },
});

// 显式引用 invoke 以保留类型契约（未来可能直接调用未封装的命令）
void invoke;
