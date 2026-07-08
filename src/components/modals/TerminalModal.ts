import { defineComponent, ref, watch } from 'vue';
import AppModal from '../AppModal.vue';
import type { TerminalLaunchOptions } from '../../types';

const TERMINAL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>';

type ShellValue = 'default' | 'bash' | 'zsh';

interface ShellOption {
  value: ShellValue;
  label: string;
}

const SHELL_OPTIONS: ShellOption[] = [
  { value: 'default', label: '系统默认' },
  { value: 'bash', label: 'bash' },
  { value: 'zsh', label: 'zsh' },
];

export default defineComponent({
  name: 'TerminalModal',
  components: { AppModal },
  props: {
    open: { type: Boolean, default: false },
    title: { type: String, default: '新建终端' },
  },
  emits: ['close', 'update:open', 'create'],
  setup(props, { emit }) {
    const formName = ref('');
    const formCwd = ref('');
    const formShell = ref<ShellValue>('default');
    const formStartupCommand = ref('');

    const namePlaceholder = '未命名终端';
    const cwdPlaceholder = '~/work/easy_terminal';
    const commandPlaceholder = '例如：npm run dev';

    // 每次打开弹框时重置表单，避免上次输入残留
    watch(
      () => props.open,
      (isOpen) => {
        if (isOpen) {
          formName.value = '';
          formCwd.value = '';
          formShell.value = 'default';
          formStartupCommand.value = '';
        }
      }
    );

    function close() {
      emit('close');
      emit('update:open', false);
    }

    function onUpdateOpen(value: boolean) {
      emit('update:open', value);
      if (!value) {
        emit('close');
      }
    }

    function onCancel() {
      close();
    }

    function onCreate() {
      const launchOptions: TerminalLaunchOptions = {
        mode: 'local',
        profileName: formName.value.trim() || undefined,
        cwd: formCwd.value.trim() || undefined,
        shell: formShell.value === 'default' ? undefined : formShell.value,
        startupCommand: formStartupCommand.value.trim() || undefined,
      };
      emit('create', launchOptions);
      close();
    }

    return {
      icon: TERMINAL_ICON,
      formName,
      formCwd,
      formShell,
      formStartupCommand,
      shellOptions: SHELL_OPTIONS,
      namePlaceholder,
      cwdPlaceholder,
      commandPlaceholder,
      onCancel,
      onCreate,
      onUpdateOpen,
    };
  },
});
