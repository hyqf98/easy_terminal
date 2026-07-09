import { defineComponent, ref, watch, type PropType } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import FileTree from '../filetree/FileTree.vue';
import type { TerminalLaunchOptions } from '../../types';
import type { SSHProfile } from '../../types/ssh';
import type { IFileOperationStrategy } from '../filetree/strategies/FileOperationStrategy';

function normalizeFsPath(path: string): string {
  const normalized = path
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/');
  if (normalized === '/') return normalized;
  return normalized.replace(/\/$/, '');
}

function joinFsPath(base: string, child: string): string {
  const normalizedBase = normalizeFsPath(base);
  const normalizedChild = normalizeFsPath(child);
  if (!normalizedChild) return normalizedBase;
  return `${normalizedBase}/${normalizedChild.replace(/^\/+/, '')}`;
}

/**
 * 终端文件面板：作为画布上独立元素渲染（拼接在终端左侧），
 * 复用 FileTree 组件，自动跟随绑定终端的 CWD。
 */
export default defineComponent({
  name: 'TerminalFilePanel',
  components: { FileTree },
  props: {
    terminalId: { type: String, required: true },
    cwd: { type: String, default: '' },
    launchOptions: { type: Object as PropType<TerminalLaunchOptions>, default: () => ({ mode: 'local' }) },
    sshProfiles: { type: Array as PropType<SSHProfile[]>, default: () => [] },
  },
  emits: ['open-preview', 'open-terminal', 'cd-to', 'panel-resize-start'],
  setup(props, { emit }) {
    const fileTreeRef = ref<InstanceType<typeof FileTree> | null>(null);
    const currentStrategy = ref<IFileOperationStrategy | null>(null);
    let strategyInitialized = false;
    // 缓存的本地家目录（首次 expandPath 时获取）
    let cachedHome = '';

    function onReady() {
      if (strategyInitialized) { syncCwd(); return; }
      strategyInitialized = true;
      const isSsh = props.launchOptions.mode === 'ssh';
      if (isSsh && props.launchOptions.profileId) {
        const profile = props.sshProfiles.find((p) => p.id === props.launchOptions.profileId);
        if (profile) {
          // @ts-expect-error exposed component method via expose()
          void fileTreeRef.value?.switchToRemote?.(profile, props.sshProfiles).then(() => syncCwd());
          return;
        }
      }
      syncCwd();
    }

    function onStrategyChange(strategy: IFileOperationStrategy) {
      currentStrategy.value = strategy;
    }

    function syncCwd() {
      if (!props.cwd) return;
      void expandPath(props.cwd).then((expanded) => {
        if (expanded) {
          // @ts-expect-error exposed component method via expose()
          fileTreeRef.value?.syncToTerminal?.({ cwd: expanded });
        }
      });
    }

    /**
     * 将 shell 标题中的路径展开为可被 read_dir 识别的绝对路径。
     * 使用 upath 统一处理跨平台路径分隔符（Windows \ → /）。
     * - ~/xxx / ~ → 本地家目录 + 子路径
     * - ~user/xxx → 交给 read_dir 处理（大多数 shell 不输出此格式）
     * - 相对路径（不含 / 或 \）→ 忽略，不导航
     * - 远程（SSH）路径原样返回
     */
    async function expandPath(raw: string): Promise<string> {
      if (!raw) return '';
      // SSH 终端的 cwd 来自远程 shell，直接交给远程策略处理
      if (props.launchOptions.mode === 'ssh') return raw;
      // 前端安全的轻量规范化：Windows 反斜杠转正斜杠、去多余分隔符。
      const normalizedPath = normalizeFsPath(raw);
      // 展开 ~ 前缀
      if (normalizedPath === '~' || normalizedPath.startsWith('~/')) {
        if (!cachedHome) {
          try {
            cachedHome = await invoke<string>('get_home_dir');
          } catch {
            return '';
          }
        }
        if (cachedHome) {
          return joinFsPath(cachedHome, normalizedPath.slice(1));
        }
      }
      // 不含路径分隔符的（如纯文件名、shell 特殊字符串），不导航
      if (!normalizedPath.includes('/') && !normalizedPath.includes('\\')) {
        return '';
      }
      return normalizedPath;
    }

    watch(() => props.cwd, () => syncCwd());

    function onOpenPreview(path: string) {
      emit('open-preview', { path, strategy: currentStrategy.value });
    }
    function onOpenTerminal(dirPath: string) { emit('open-terminal', dirPath); }
    function onCdTo(path: string) { emit('cd-to', { path, terminalId: props.terminalId }); }
    function onLocateCwd() { syncCwd(); }

    /** 左下角手柄：通知父组件触发绑定终端的 startResize('sw')，面板随之同步缩放 */
    function onResizeStart(e: MouseEvent) {
      emit('panel-resize-start', e);
    }

    return { fileTreeRef, onReady, onStrategyChange, onOpenPreview, onOpenTerminal, onCdTo, onLocateCwd, onResizeStart };
  },
});
