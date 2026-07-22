import { computed, defineComponent, onBeforeUnmount, onMounted, ref, watch, type PropType } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import type { SSHProfile } from '../../types';
import type { FileEntry } from './strategies/FileOperationStrategy';
import { fsService } from './fsService';
import { sshService } from '../ssh/sshService';
import { parentOf } from '../../utils/path';
import AppSelect from '../../components/AppSelect.vue';
import type { SelectOption } from '../../components/AppSelect';

interface TransferProgress {
  direction: 'upload' | 'download';
  status: 'starting' | 'progress' | 'success' | 'error';
  fileName: string;
  detail: string;
  transferredBytes: number;
  totalBytes: number;
  progressPercent: number;
}

/** A compact two-pane SFTP chooser used from a connected terminal's file tree. */
export default defineComponent({
  name: 'FileTransferModal',
  components: { AppSelect },
  props: {
    profile: { type: Object as PropType<SSHProfile>, required: true },
    profiles: { type: Array as PropType<SSHProfile[]>, required: true },
    remotePath: { type: String, required: true },
    initialMode: { type: String as PropType<'upload' | 'download'>, default: 'upload' },
  },
  emits: ['close', 'complete'],
  setup(props, { emit }) {
    const remotePath = ref(props.remotePath);
    const localPath = ref('');
    const remoteEntries = ref<FileEntry[]>([]);
    const localEntries = ref<FileEntry[]>([]);
    const selectedRemote = ref<string[]>([]);
    const selectedLocal = ref<string[]>([]);
    const busy = ref(false);
    const direction = ref<'upload' | 'download'>(props.initialMode);
    const conflictPolicy = ref<'overwrite' | 'skip' | 'rename'>('overwrite');
    const conflictOptions: SelectOption[] = [
      { label: '覆盖', value: 'overwrite' },
      { label: '跳过', value: 'skip' },
      { label: '保留两者', value: 'rename' },
    ];
    const progress = ref<TransferProgress | null>(null);
    const error = ref('');
    let unlisten: UnlistenFn | null = null;

    const primaryDisabled = computed(() => busy.value
      || (direction.value === 'upload' ? selectedLocal.value.length === 0 : selectedRemote.value.length === 0));
    const primaryLabel = computed(() => direction.value === 'upload'
      ? `上传 ${selectedLocal.value.length || ''} 项到远端`
      : `下载 ${selectedRemote.value.length || ''} 项到本机`);
    const targetPath = computed(() => direction.value === 'upload' ? remotePath.value : localPath.value);
    const directionHint = computed(() => direction.value === 'upload'
      ? '从右侧本机选择内容，上传到左侧远程目录'
      : '从左侧远程选择内容，下载到右侧本机目录');

    async function loadRemote(path = remotePath.value) {
      remotePath.value = path;
      selectedRemote.value = [];
      remoteEntries.value = await sshService.readRemoteDir(props.profile, path, props.profiles) as FileEntry[];
    }

    async function loadLocal(path = localPath.value) {
      localPath.value = path;
      selectedLocal.value = [];
      localEntries.value = await fsService.readDir(path) as FileEntry[];
    }

    function toggle(selected: { value: string[] }, path: string, event: MouseEvent) {
      if (!event.metaKey && !event.ctrlKey) {
        selected.value = [path];
        return;
      }
      selected.value = selected.value.includes(path)
        ? selected.value.filter((item) => item !== path)
        : [...selected.value, path];
    }

    function goRemote(entry: FileEntry, event: MouseEvent) {
      toggle(selectedRemote, entry.path, event);
      if (entry.is_dir && event.detail === 2) void loadRemote(entry.path);
    }

    function goLocal(entry: FileEntry, event: MouseEvent) {
      toggle(selectedLocal, entry.path, event);
      if (entry.is_dir && event.detail === 2) void loadLocal(entry.path);
    }

    async function transfer() {
      if (primaryDisabled.value) return;
      busy.value = true;
      error.value = '';
      progress.value = null;
      try {
        if (direction.value === 'upload') {
          await sshService.uploadLocalEntries(props.profile, selectedLocal.value, remotePath.value, props.profiles, conflictPolicy.value);
          await loadRemote(remotePath.value);
        } else {
          await sshService.downloadRemoteEntries(props.profile, selectedRemote.value, localPath.value, props.profiles, conflictPolicy.value);
          await loadLocal(localPath.value);
        }
        emit('complete');
      } catch (reason) {
        error.value = String(reason);
      } finally {
        busy.value = false;
      }
    }

    onMounted(async () => {
      try {
        localPath.value = await invoke<string>('get_home_dir');
        await Promise.all([loadRemote(remotePath.value), loadLocal(localPath.value)]);
      } catch (reason) {
        error.value = String(reason);
      }
      unlisten = await listen<TransferProgress>('file-transfer-progress', (event) => {
        progress.value = event.payload;
      });
    });
    onBeforeUnmount(() => { unlisten?.(); });
    watch(() => props.remotePath, (path) => { if (path) void loadRemote(path); });

    return {
      busy, conflictOptions, conflictPolicy, direction, error, goLocal, goRemote, loadLocal, loadRemote,
      localEntries, localPath, parentOf, primaryDisabled, primaryLabel,
      progress, remoteEntries, remotePath, selectedLocal, selectedRemote, targetPath, transfer,
      directionHint,
    };
  },
});
