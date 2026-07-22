import { computed, defineComponent, onUnmounted, ref, watch, type PropType } from 'vue';
import { NVirtualList } from 'naive-ui';
import type { DiskMetric, PerformanceSnapshot, PortMetric, ProcessMetric, SSHProfile, TerminalLaunchOptions } from '../../types';
import { refreshPerformance, stopPerformancePortProcess, subscribePerformance } from './performanceService';
import { t } from '../../i18n';

export default defineComponent({
  name: 'PerformancePanel',
  components: { NVirtualList },
  props: { launchOptions: { type: Object as PropType<TerminalLaunchOptions>, required: true }, sshProfiles: { type: Array as PropType<SSHProfile[]>, default: () => [] }, refreshSeconds: { type: Number, default: 3 } },
  emits: ['panel-resize-start', 'close'],
  setup(props, { emit }) {
    const snapshot = ref<PerformanceSnapshot | null>(null); const error = ref<string | null>(null);
    const portQuery = ref('');
    const processQuery = ref('');
    const stoppingPid = ref<number | null>(null);
    const portActionError = ref<string | null>(null);
    let unsubscribe: (() => void) | null = null;
    const targetLabel = computed(() => props.launchOptions.mode === 'ssh' ? (props.launchOptions.profileName || 'SSH') : 'Local');
    const capturedAtLabel = computed(() => {
      if (!snapshot.value) return '';
      return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(snapshot.value.capturedAt);
    });
    const subscribe = () => { unsubscribe?.(); unsubscribe = subscribePerformance(props.launchOptions, props.sshProfiles, props.refreshSeconds, (next, failure) => { snapshot.value = next; error.value = failure; }); };
    watch(() => [props.launchOptions.mode, props.launchOptions.profileId, props.refreshSeconds, props.sshProfiles.length], subscribe, { immediate: true });
    onUnmounted(() => unsubscribe?.());
    const filteredPorts = computed(() => {
      const ports = snapshot.value?.ports || [];
      const query = portQuery.value.trim();
      return query ? ports.filter((port) => String(port.port).includes(query)) : ports;
    });
    const filteredProcesses = computed(() => {
      const processes = snapshot.value?.processes || [];
      const query = processQuery.value.trim();
      return query ? processes.filter((process) => String(process.pid).includes(query)) : processes;
    });
    const bytes = (value: number) => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GB` : `${(value / 1024 ** 2).toFixed(0)} MB`;
    const percent = (value: number) => `${Math.round(value)}%`;
    const gpuMemoryPercent = (used: number, total: number) => total > 0 ? used * 100 / total : 0;
    const diskLabel = (disk: DiskMetric) => disk.mountPoint === '/' ? '系统盘 · /' : `数据挂载 · ${disk.mountPoint}`;
    function refreshNow() { refreshPerformance(props.launchOptions, props.sshProfiles); }
    async function stopPid(pid: number, label: string, confirmationKey: string) {
      if (pid <= 0 || stoppingPid.value !== null) return;
      if (!window.confirm(t(confirmationKey, label, String(pid)))) return;
      portActionError.value = null;
      stoppingPid.value = pid;
      try {
        await stopPerformancePortProcess(props.launchOptions, props.sshProfiles, pid);
        refreshNow();
      } catch (stopError) {
        portActionError.value = `${t('perf.stopPortFailed')}：${String(stopError)}`;
      } finally {
        stoppingPid.value = null;
      }
    }
    function stopPort(port: PortMetric) {
      if (!port.pid) return;
      void stopPid(port.pid, `${port.protocol.toUpperCase()} ${port.port}`, 'perf.stopPortConfirm');
    }
    function stopProcess(process: ProcessMetric) {
      void stopPid(process.pid, process.name, 'perf.stopProcessConfirm');
    }
    return { snapshot, error, targetLabel, capturedAtLabel, portQuery, processQuery, filteredPorts, filteredProcesses, stoppingPid, portActionError, bytes, percent, gpuMemoryPercent, diskLabel, refreshNow, stopPort, stopProcess, emit, t };
  },
});
