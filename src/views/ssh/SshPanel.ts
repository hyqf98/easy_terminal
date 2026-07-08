import { defineComponent, ref, computed, onMounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { t } from '../../i18n';
import { showMessage } from '../../composables/useAppMessage';
import type { SSHProfile } from '../../types';
import SshHostModal from '../../components/modals/SshHostModal.vue';
import DeleteConfirmModal from '../../components/modals/DeleteConfirmModal.vue';

interface SshFormGroup {
  name: string;
  profiles: SSHProfile[];
}

interface RecentCommand {
  id: string;
  command: string;
  time: string;
}

const DEFAULT_GROUP = '未分组';

export default defineComponent({
  name: 'SshPanel',
  components: { SshHostModal, DeleteConfirmModal },
  emits: ['connect', 'profiles-change', 'selection-change'],
  setup(_, { emit }) {
    const profiles = ref<SSHProfile[]>([]);
    const selectedProfileId = ref('');
    const expandedGroups = ref<string[]>([]);
    const searchKeyword = ref('');
    const testing = ref(false);

    // 新建/编辑主机弹框状态
    const hostModalOpen = ref(false);
    const editingProfile = ref<SSHProfile | null>(null);

    // 删除确认弹框状态
    const deleteModalOpen = ref(false);
    const pendingDeleteProfile = ref<SSHProfile | null>(null);

    const titleLabel = computed(() => t('ssh.title'));
    const subtitleLabel = '远程主机分组管理，密码 / 密钥认证 + 跳板机链路';
    const addLabel = computed(() => t('ssh.add'));
    const testLabel = computed(() => t('ssh.testConnection'));
    const emptyLabel = computed(() => t('ssh.empty'));
    const searchPlaceholder = '搜索主机 / 分组 / 用户';
    const stateLabel = '未探测';
    const recentEmptyLabel = '暂无最近命令记录';
    const detailEmptyTitle = computed(() => t('ssh.detailEmpty'));
    const detailEmptyDesc = '从左侧选择一台主机，或在右上角新建主机';

    const existingGroups = computed(() => {
      const set = new Set<string>();
      for (const profile of profiles.value) {
        if (profile.group) set.add(profile.group);
      }
      return [...set].sort();
    });

    const filteredGrouped = computed<SshFormGroup[]>(() => {
      const keyword = searchKeyword.value.trim().toLowerCase();
      const map = new Map<string, SSHProfile[]>();
      for (const profile of profiles.value) {
        if (keyword) {
          const haystack = `${profile.name} ${profile.group} ${profile.user} ${profile.host}`.toLowerCase();
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

    const jumpCandidates = computed(() =>
      selectedProfile.value
        ? profiles.value.filter((profile) => profile.id !== selectedProfileId.value)
        : profiles.value
    );

    const authTypeLabel = computed(() => {
      const profile = selectedProfile.value;
      if (!profile) return '';
      return profile.authType === 'key' ? '密钥' : '密码';
    });

    const statePulseClass = computed(() => 'offline');

    /** 跳板机链路：从根跳板到目标主机的名称序列 */
    const jumpChain = computed<string[]>(() => {
      const profile = selectedProfile.value;
      if (!profile || !profile.jumpProfileId) return [];
      const chain: string[] = [];
      const visited = new Set<string>();
      let cursor = profile;
      while (cursor.jumpProfileId && !visited.has(cursor.id)) {
        visited.add(cursor.id);
        const jump = profiles.value.find((item) => item.id === cursor.jumpProfileId);
        if (!jump) break;
        chain.unshift(jump.name || jump.host);
        cursor = jump;
      }
      chain.push(profile.name || profile.host);
      return chain;
    });

    const recentCommands = ref<RecentCommand[]>([]);

    const deleteMessage = computed(() => {
      const profile = pendingDeleteProfile.value;
      if (!profile) return '';
      const host = `${profile.user}@${profile.host}:${profile.port}`;
      return `即将删除主机 <strong>${profile.name || profile.host}</strong>（${host}）。<br>此操作不可撤销，已建立的 SSH 会话将被强制断开。`;
    });

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

    async function reload() {
      try {
        profiles.value = await invoke<SSHProfile[]>('load_ssh_profiles');
        emit('profiles-change', profiles.value);
      } catch {
        /* 忽略加载失败 */
      }
    }

    async function persistProfiles(next: SSHProfile[]) {
      await invoke('save_ssh_profiles', { entries: next });
      await reload();
    }

    function selectProfile(profile: SSHProfile) {
      selectedProfileId.value = profile.id;
      emit('selection-change', profile, profiles.value);
    }

    function connectProfile(profile: SSHProfile) {
      selectedProfileId.value = profile.id;
      emit('selection-change', profile, profiles.value);
      emit('connect', profile, profiles.value);
    }

    function openAdd() {
      editingProfile.value = null;
      hostModalOpen.value = true;
    }

    function editProfile(profile: SSHProfile) {
      editingProfile.value = profile;
      hostModalOpen.value = true;
    }

    function closeHostModal() {
      hostModalOpen.value = false;
      editingProfile.value = null;
    }

    async function onHostSave(profile: SSHProfile) {
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
        hostModalOpen.value = false;
        editingProfile.value = null;
        showMessage('主机已保存', 'success');
      } catch (error) {
        showMessage(`保存失败: ${String(error)}`, 'error');
      }
    }

    async function onHostTest(profile: SSHProfile) {
      testing.value = true;
      try {
        await invoke<string>('test_ssh_connection', {
          host: profile.host,
          port: profile.port,
          user: profile.user,
          authType: profile.authType,
          password: profile.password,
          privateKeyPath: profile.privateKeyPath,
          jumpProfileId: profile.jumpProfileId,
          profiles: profiles.value,
        });
        showMessage(t('ssh.testSuccess'), 'success');
      } catch (error) {
        showMessage(t('ssh.testFailed', String(error)), 'error');
      } finally {
        testing.value = false;
      }
    }

    async function testSelected() {
      const profile = selectedProfile.value;
      if (!profile) return;
      await onHostTest(profile);
    }

    function confirmDelete(profile: SSHProfile) {
      pendingDeleteProfile.value = profile;
      deleteModalOpen.value = true;
    }

    async function onConfirmDelete() {
      const profile = pendingDeleteProfile.value;
      if (!profile) return;
      const next = profiles.value.filter((item) => item.id !== profile.id);
      try {
        await persistProfiles(next);
        if (selectedProfileId.value === profile.id) {
          selectedProfileId.value = '';
          emit('selection-change', null, profiles.value);
        }
        showMessage('主机已删除', 'success');
      } catch (error) {
        showMessage(`删除失败: ${String(error)}`, 'error');
      } finally {
        deleteModalOpen.value = false;
        pendingDeleteProfile.value = null;
      }
    }

    function setActiveProfile(profileId: string | null) {
      selectedProfileId.value = profileId || '';
    }

    onMounted(() => {
      void reload();
    });

    return {
      profiles,
      selectedProfileId,
      selectedProfile,
      searchKeyword,
      testing,
      hostModalOpen,
      editingProfile,
      deleteModalOpen,
      deleteMessage,
      existingGroups,
      filteredGrouped,
      jumpCandidates,
      authTypeLabel,
      statePulseClass,
      jumpChain,
      recentCommands,
      titleLabel,
      subtitleLabel,
      addLabel,
      testLabel,
      emptyLabel,
      searchPlaceholder,
      stateLabel,
      recentEmptyLabel,
      detailEmptyTitle,
      detailEmptyDesc,
      isGroupExpanded,
      toggleGroup,
      selectProfile,
      connectProfile,
      openAdd,
      editProfile,
      closeHostModal,
      onHostSave,
      onHostTest,
      testSelected,
      confirmDelete,
      onConfirmDelete,
      setActiveProfile,
      reload,
    };
  },
});
