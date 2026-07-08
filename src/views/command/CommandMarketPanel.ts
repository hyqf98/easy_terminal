import { defineComponent, ref, computed, onMounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { t } from '../../i18n';
import { showMessage } from '../../composables/useAppMessage';
import { showConfirm } from '../../composables/useAppDialog';
import InstallPreviewModal from '../../components/modals/InstallPreviewModal.vue';
import type { CommandEntry, CommandLibrarySummary, RemoteCommandLibrary } from '../../types';

/** 安装预览库信息（与 InstallPreviewModal 的 props.library 结构一致） */
interface InstallPreviewLibrary {
  name: string;
  label: string;
  description: string;
  author?: string;
  version?: string;
  commands: CommandEntry[];
}

const REPO_OWNER = 'hyqf98';
const REPO_NAME = 'easy_terminal';
const RAW_BASE = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/src-tauri/commands`;

const FILTER_CHIPS = ['全部', 'git', 'docker', 'kubernetes', 'python', 'rust', 'node', 'ssh', 'shell'];

function formatTitle(id: string): string {
  const titles: Record<string, string> = {
    darwin: 'macOS',
    linux: 'Linux',
    windows: 'Windows',
    ubuntu: 'Ubuntu',
    arch: 'Arch Linux',
  };
  return titles[id] || id.replace(/[-_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function isDevRuntime(): boolean {
  return /localhost|127\.0\.0\.1/.test(window.location.hostname);
}

/** 根据库名推断分类，用于卡片图标着色与筛选 */
function detectCategory(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('git')) return 'git';
  if (lower.includes('docker')) return 'docker';
  if (lower.includes('k8s') || lower.includes('kubernetes')) return 'kubernetes';
  if (lower.includes('python') || lower.includes('pip') || lower.includes('conda')) return 'python';
  if (lower.includes('rust') || lower.includes('cargo')) return 'rust';
  if (lower.includes('node') || lower.includes('npm') || lower.includes('yarn')) return 'node';
  if (lower.includes('ssh')) return 'ssh';
  if (lower.includes('shell') || lower.includes('bash') || lower.includes('zsh')) return 'shell';
  return 'other';
}

/** 卡片图标 SVG（按分类返回带渐变背景的 HTML 块） */
function categoryIconHtml(name: string): string {
  const category = detectCategory(name);
  const palette: Record<string, string> = {
    git: 'linear-gradient(135deg,#f1502f,#c17f59)',
    docker: 'linear-gradient(135deg,#2496ed,#5a8ec4)',
    kubernetes: 'linear-gradient(135deg,#326ce5,#5a7ab8)',
    python: 'linear-gradient(135deg,#3776ab,#5a9e8f)',
    rust: 'linear-gradient(135deg,#dea584,#c17f59)',
    node: 'linear-gradient(135deg,#68a063,#3c873a)',
    ssh: 'linear-gradient(135deg,#6e7681,#424a53)',
    shell: 'linear-gradient(135deg,#4eaa25,#2d7a1a)',
    other: 'linear-gradient(135deg,var(--accent),color-mix(in srgb,var(--accent) 60%,var(--mauve)))',
  };
  const background = palette[category] || palette.other;
  const path = '<svg viewBox="0 0 24 24"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>';
  return `<div class="market-card-icon" style="background:${background}">${path}</div>`;
}

export default defineComponent({
  name: 'CommandMarketPanel',
  components: { InstallPreviewModal },
  emits: ['commands-changed'],
  setup(_, { emit }) {
    const remoteLibraries = ref<RemoteCommandLibrary[]>([]);
    const localLibraries = ref<CommandLibrarySummary[]>([]);
    const activeFilter = ref('全部');
    const loading = ref(false);
    const errorMsg = ref('');
    const initialized = ref(false);

    // 安装预览弹框状态
    const installModalOpen = ref(false);
    const pendingLibrary = ref<InstallPreviewLibrary | null>(null);

    const titleLabel = computed(() => t('market.title'));
    const refreshLabel = computed(() => t('market.refresh'));
    const installLabel = computed(() => t('market.install'));
    const installedLabel = computed(() => t('market.installed'));
    const syncLabel = computed(() => t('market.sync'));
    const uninstallLabel = computed(() => t('market.uninstall'));
    const loadingLabel = computed(() => t('market.loading'));
    const noResultsLabel = computed(() => t('market.noResults'));

    const filterChips = FILTER_CHIPS;

    const filteredLibs = computed(() => {
      if (activeFilter.value === '全部') return remoteLibraries.value;
      return remoteLibraries.value.filter((lib) => detectCategory(lib.name) === activeFilter.value.toLowerCase()
        || lib.name.toLowerCase().includes(activeFilter.value.toLowerCase()));
    });

    const heroStats = computed(() => {
      const total = remoteLibraries.value.length;
      const installed = remoteLibraries.value.filter((lib) => lib.isInstalled).length;
      const commands = remoteLibraries.value.reduce((sum, lib) => sum + lib.commandCount, 0);
      return [
        { value: String(total), label: '命令库' },
        { value: String(installed), label: '已安装' },
        { value: String(commands), label: '命令总数' },
      ];
    });

    function categoryIcon(name: string): string {
      return categoryIconHtml(name);
    }

    function libraryMeta(lib: RemoteCommandLibrary): string {
      const parts: string[] = [];
      if (lib.directory === 'system') parts.push('系统');
      else parts.push('社区');
      if (lib.commandCount > 0) parts.push(`${lib.commandCount} 条`);
      return parts.join(' · ');
    }

    async function init() {
      if (initialized.value) return;
      initialized.value = true;
      await reloadLocalLibraries();
      await fetchRemoteList();
    }

    async function reloadLocalLibraries() {
      localLibraries.value = await invoke<CommandLibrarySummary[]>('list_command_libraries');
    }

    async function fetchRemoteList() {
      loading.value = true;
      errorMsg.value = '';
      try {
        if (isDevRuntime()) {
          await fetchLocalList();
        } else {
          await fetchGithubList();
        }
      } catch (error) {
        remoteLibraries.value = [];
        errorMsg.value = t('market.loadFailed') + (error instanceof Error ? ` (${error.message})` : '');
      } finally {
        loading.value = false;
      }
    }

    async function fetchLocalList() {
      const entries = await invoke<{ name: string; directory: string }[]>(
        'list_bundled_command_libraries'
      );
      const localIds = new Set(localLibraries.value.map((lib) => lib.id));
      const systemLibs: RemoteCommandLibrary[] = [];
      const customLibs: RemoteCommandLibrary[] = [];
      for (const entry of entries) {
        const lib: RemoteCommandLibrary = {
          name: entry.name,
          path: '',
          size: 0,
          sha: '',
          downloadUrl: '',
          directory: entry.directory as 'system' | 'custom',
          isInstalled: localIds.has(entry.name),
          commandCount: 0,
          label: formatTitle(entry.name),
          description: '',
          loaded: false,
        };
        if (entry.directory === 'system') systemLibs.push(lib);
        else customLibs.push(lib);
      }
      systemLibs.sort((left, right) => left.label.localeCompare(right.label));
      customLibs.sort((left, right) => left.label.localeCompare(right.label));
      remoteLibraries.value = [...systemLibs, ...customLibs];
    }

    async function fetchGithubList() {
      const base = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/src-tauri/commands`;
      const [customRes, systemRes] = await Promise.all([fetch(`${base}/custom`), fetch(`${base}/system`)]);
      const localIds = new Set(localLibraries.value.map((lib) => lib.id));
      const libs: RemoteCommandLibrary[] = [];
      for (const res of [systemRes, customRes]) {
        if (!res.ok) continue;
        const entries = await res.json();
        const dir = res === systemRes ? 'system' : 'custom';
        for (const entry of entries) {
          if (entry.type !== 'file' || !entry.name.endsWith('.json')) continue;
          const name = entry.name.replace(/\.json$/, '');
          libs.push({
            name,
            path: entry.path,
            size: entry.size,
            sha: entry.sha,
            downloadUrl: entry.download_url || `${RAW_BASE}/${dir}/${entry.name}`,
            directory: dir as 'system' | 'custom',
            isInstalled: localIds.has(name),
            commandCount: 0,
            label: formatTitle(name),
            description: '',
            loaded: false,
          });
        }
      }
      libs.sort((left, right) => left.label.localeCompare(right.label));
      remoteLibraries.value = libs;
    }

    async function fetchLibraryJson(lib: RemoteCommandLibrary): Promise<string> {
      if (isDevRuntime()) return await invoke<string>('read_bundled_command_file', { name: lib.name });
      const res = await fetch(`${RAW_BASE}/${lib.directory}/${lib.name}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    }

    /** 打开安装预览弹框：先拉取库 JSON 解析 commands */
    async function openInstallPreview(lib: RemoteCommandLibrary) {
      try {
        const json = await fetchLibraryJson(lib);
        const parsed: { commands?: CommandEntry[] } = JSON.parse(json);
        const commands = parsed.commands || [];
        lib.commandCount = commands.length;
        lib.loaded = true;
        pendingLibrary.value = {
          name: lib.name,
          label: lib.label,
          description: lib.description || '',
          author: lib.directory === 'system' ? 'easy-terminal' : 'community',
          version: '',
          commands,
        };
        installModalOpen.value = true;
      } catch (error) {
        showMessage(t('market.loadFailed') + (error instanceof Error ? ` (${error.message})` : ''), 'error');
      }
    }

    async function onInstall(library: InstallPreviewLibrary | null) {
      if (!library) return;
      try {
        const lib = remoteLibraries.value.find((item) => item.name === library.name);
        if (!lib) return;
        const json = await fetchLibraryJson(lib);
        await invoke('import_command_library', { json });
        await reloadLocalLibraries();
        lib.isInstalled = true;
        installModalOpen.value = false;
        emit('commands-changed');
        showMessage(t('market.installSuccess', lib.label), 'success');
      } catch (error) {
        showMessage(t('cmd.importFailed', String(error)), 'error');
      }
    }

    async function syncLib(lib: RemoteCommandLibrary) {
      try {
        await invoke('delete_command_library', { libraryId: lib.name });
        const json = await fetchLibraryJson(lib);
        await invoke('import_command_library', { json });
        await reloadLocalLibraries();
        lib.isInstalled = true;
        emit('commands-changed');
        showMessage(t('market.syncSuccess', lib.label), 'success');
      } catch (error) {
        showMessage(t('cmd.importFailed', String(error)), 'error');
      }
    }

    async function uninstallLib(lib: RemoteCommandLibrary) {
      const confirmed = await showConfirm({
        content: t('market.uninstallConfirm', lib.label),
        danger: true,
        positiveText: uninstallLabel.value,
      });
      if (!confirmed) return;
      try {
        await invoke('delete_command_library', { libraryId: lib.name });
        await reloadLocalLibraries();
        lib.isInstalled = false;
        emit('commands-changed');
      } catch (error) {
        showMessage(t('cmd.importFailed', String(error)), 'error');
      }
    }

    async function refresh() {
      await reloadLocalLibraries();
      await fetchRemoteList();
    }

    onMounted(() => void init());

    return {
      remoteLibraries,
      activeFilter,
      loading,
      errorMsg,
      installModalOpen,
      pendingLibrary,
      titleLabel,
      refreshLabel,
      installLabel,
      installedLabel,
      syncLabel,
      uninstallLabel,
      loadingLabel,
      noResultsLabel,
      filterChips,
      filteredLibs,
      heroStats,
      categoryIcon,
      libraryMeta,
      openInstallPreview,
      onInstall,
      syncLib,
      uninstallLib,
      refresh,
      init,
    };
  },
});
