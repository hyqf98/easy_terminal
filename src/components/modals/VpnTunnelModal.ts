import { defineComponent, reactive, computed, watch } from 'vue';
import AppModal from '../AppModal.vue';
import AppSelect from '../AppSelect.vue';
import type { SelectOption } from '../AppSelect';
import { showMessage } from '../../composables/useAppMessage';
import { t } from '../../i18n';
import type { VpnProfile, VpnAuthMode } from '../../types';

/** 生成配置 ID：优先 crypto.randomUUID，回退到时间戳 + 随机串（与项目既有风格一致）。 */
function generateProfileId(): string {
  return (
    crypto.randomUUID?.() ?? `vpn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
}

export default defineComponent({
  name: 'VpnTunnelModal',
  components: { AppModal, AppSelect },
  props: {
    open: { type: Boolean, default: false },
    /** 编辑时传入已有配置；新建时传 null */
    profile: { type: Object as () => VpnProfile | null, default: null },
    /** 可选分组列表 */
    groups: { type: Array as () => string[], default: () => [] },
  },
  emits: ['close', 'update:open', 'save'],
  setup(props, { emit }) {
    const subtitle = t('vpn.subtitle');
    // 盾牌图标（AppModal 通过 v-html 渲染 SVG 字符串）
    const icon =
      '<svg viewBox="0 0 24 24"><path d="M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-3z"/></svg>';

    const form = reactive<VpnProfile>({
      id: '',
      name: '',
      group: '',
      ovpnConfig: '',
      authMode: 'password',
      username: '',
      password: '',
      autoConnect: false,
      serverHost: '',
      serverPort: 1194,
    });

    const modalTitle = computed(() =>
      props.profile ? t('vpn.modal.edit_title') : t('vpn.modal.title')
    );

    const authModes: { value: VpnAuthMode; label: string }[] = [
      { value: 'password', label: t('vpn.modal.auth.password') },
      { value: 'cert', label: t('vpn.modal.auth.cert') },
      { value: 'static-key', label: t('vpn.modal.auth.static_key') },
    ];

    // AppSelect 所需 options：固定“未分组”置顶 + 动态分组
    const groupSelectOptions = computed<SelectOption[]>(() => {
      const set = new Set<string>(props.groups);
      if (form.group) set.add(form.group);
      return [
        { label: '未分组', value: '' },
        ...[...set].sort().map((name) => ({ label: name, value: name })),
      ];
    });

    function resetForm() {
      form.id = '';
      form.name = '';
      form.group = '';
      form.ovpnConfig = '';
      form.authMode = 'password';
      form.username = '';
      form.password = '';
      form.autoConnect = false;
      form.serverHost = '';
      form.serverPort = 1194;
    }

    /** 打开时根据 profile 初始化表单 */
    watch(
      () => props.open,
      (isOpen) => {
        if (!isOpen) return;
        if (props.profile) {
          Object.assign(form, props.profile);
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

    /** 导入 .ovpn 配置文件。项目未安装 @tauri-apps/plugin-fs，
     *  与 CommandConfigPanel.importFile 一致：用隐藏 <input type="file"> 读取文本。 */
    function importOvpnFile() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.ovpn,.conf,.txt';
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const content = await file.text();
          form.ovpnConfig = content;
          // 尝试从配置中提取服务器信息
          extractServerInfo(content);
          showMessage(t('vpn.modal.import') + ' ✓', 'success');
        } catch (e) {
          showMessage(t('vpn.modal.import') + '：' + String(e), 'error');
        }
      });
      input.click();
    }

    /** 从 .ovpn 配置文本中提取 `remote <host> <port>`，自动回填空白字段。 */
    function extractServerInfo(config: string) {
      const remoteMatch = config.match(/^remote\s+(\S+)\s+(\d+)/m);
      if (!remoteMatch) return;
      if (!form.serverHost.trim()) form.serverHost = remoteMatch[1];
      if (!form.serverPort || form.serverPort === 1194) {
        const port = parseInt(remoteMatch[2], 10);
        if (!Number.isNaN(port)) form.serverPort = port;
      }
    }

    function buildProfile(): VpnProfile {
      return {
        id: form.id || generateProfileId(),
        name: form.name.trim(),
        group: form.group.trim(),
        ovpnConfig: form.ovpnConfig,
        authMode: form.authMode,
        username: form.username.trim(),
        password: form.password,
        autoConnect: form.autoConnect,
        serverHost: form.serverHost.trim(),
        serverPort: Number(form.serverPort) || 1194,
      };
    }

    function onSave() {
      if (!form.name.trim()) {
        showMessage(t('vpn.msg.name_required'), 'warning');
        return;
      }
      if (!form.serverHost.trim()) {
        showMessage(t('vpn.msg.server_required'), 'warning');
        return;
      }
      emit('save', buildProfile());
    }

    return {
      subtitle,
      icon,
      form,
      modalTitle,
      authModes,
      groupSelectOptions,
      close,
      onUpdateOpen,
      onGroupChange,
      importOvpnFile,
      onSave,
      t,
    };
  },
});
