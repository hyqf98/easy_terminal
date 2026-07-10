import { defineComponent, reactive, computed, watch, ref } from 'vue';
import AppModal from '../AppModal.vue';
import AppSelect from '../AppSelect.vue';
import type { SelectOption } from '../AppSelect';
import { showMessage } from '../../composables/useAppMessage';
import { t } from '../../i18n';
import type { SSHProfile } from '../../types';

export default defineComponent({
  name: 'SshHostModal',
  components: { AppModal, AppSelect },
  props: {
    open: { type: Boolean, default: false },
    /** 编辑时传入已有主机；新建时传 null */
    profile: { type: Object as () => SSHProfile | null, default: null },
    /** 可选分组列表 */
    groups: { type: Array as () => string[], default: () => [] },
    /** 可选跳板机候选列表（应已排除当前编辑主机） */
    jumpCandidates: { type: Array as () => SSHProfile[], default: () => [] },
  },
  emits: ['close', 'update:open', 'save', 'test'],
  setup(props, { emit }) {
    const subtitle = '支持密码 / 密钥认证 + 跳板机链路';
    const icon =
      '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

    const form = reactive<SSHProfile & { note: string }>({
      id: '',
      name: '',
      group: '',
      host: '',
      port: 22,
      user: '',
      authType: 'key',
      password: '',
      privateKeyPath: '~/.ssh/id_rsa',
      jumpProfileId: '',
      note: '',
    });

    const testing = ref(false);

    const namePlaceholder = 'prod-web-01';
    const keyPathPlaceholder = '~/.ssh/id_ed25519';
    const passwordPlaceholder = 'SSH 登录密码';
    const testLabel = computed(() => t('ssh.testConnection'));

    const modalTitle = computed(() => (props.profile ? '编辑 SSH 主机' : '新建 SSH 主机'));

    const groupOptions = computed(() => {
      const set = new Set<string>(props.groups);
      if (form.group) set.add(form.group);
      return [...set].sort();
    });

    // AppSelect 所需 options：固定“未分组”置顶 + 动态分组
    const groupSelectOptions = computed<SelectOption[]>(() => [
      { label: '未分组', value: '' },
      ...groupOptions.value.map((name) => ({ label: name, value: name })),
    ]);

    // 跳板机选项：固定“不使用跳板”置顶 + 候选主机
    const jumpSelectOptions = computed<SelectOption[]>(() => [
      { label: '不使用跳板', value: '' },
      ...props.jumpCandidates.map((candidate) => ({
        label: `${candidate.name} (${candidate.user}@${candidate.host})`,
        value: candidate.id,
      })),
    ]);

    function resetForm() {
      form.id = '';
      form.name = '';
      form.group = '';
      form.host = '';
      form.port = 22;
      form.user = '';
      form.authType = 'key';
      form.password = '';
      form.privateKeyPath = '~/.ssh/id_rsa';
      form.jumpProfileId = '';
      form.note = '';
    }

    /** 打开时根据 profile 初始化表单 */
    watch(
      () => props.open,
      (isOpen) => {
        if (!isOpen) return;
        if (props.profile) {
          Object.assign(form, props.profile);
          form.note = '';
        } else {
          resetForm();
        }
      },
      { immediate: true }
    );

    function close() {
      emit('close');
      emit('update:open', false);
    }

    function onUpdateOpen(value: boolean) {
      emit('update:open', value);
      if (!value) emit('close');
    }

    // AppSelect 值回调（模板中无法使用 as 类型断言，故在此做类型收窄）
    function onGroupChange(value: unknown) {
      form.group = String(value ?? '');
    }

    function onJumpProfileChange(value: unknown) {
      form.jumpProfileId = String(value ?? '');
    }

    function buildProfile(): SSHProfile {
      return {
        id: form.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: form.name.trim(),
        group: form.group.trim(),
        host: form.host.trim(),
        port: Number(form.port) || 22,
        user: form.user.trim(),
        authType: form.authType,
        password: form.password,
        privateKeyPath: form.privateKeyPath,
        jumpProfileId: form.jumpProfileId,
      };
    }

    function onSave() {
      if (!form.name.trim() || !form.host.trim() || !form.user.trim()) {
        showMessage(t('ssh.required'), 'warning');
        return;
      }
      emit('save', buildProfile());
    }

    function onTest() {
      if (!form.host.trim() || !form.user.trim()) {
        showMessage(t('ssh.required'), 'warning');
        return;
      }
      emit('test', buildProfile());
    }

    return {
      subtitle,
      icon,
      form,
      testing,
      namePlaceholder,
      keyPathPlaceholder,
      passwordPlaceholder,
      testLabel,
      modalTitle,
      groupOptions,
      groupSelectOptions,
      jumpSelectOptions,
      close,
      onUpdateOpen,
      onGroupChange,
      onJumpProfileChange,
      onSave,
      onTest,
    };
  },
});
