import { defineComponent, ref, reactive, computed, onMounted, onBeforeUnmount, shallowRef, nextTick, watch } from 'vue';
import { Icon } from '@vicons/utils';
import { Refresh, Target } from '@vicons/tabler';
import { invoke } from '@tauri-apps/api/core';
import { t } from '../../i18n';
import type { SSHProfile } from '../../types';
import { createLocalFileStrategy, createRemoteFileStrategy } from './strategies';
import type { IFileOperationStrategy, FileEntry, RemoteDirectoryCursor, RemoteDirectoryPage } from './strategies/FileOperationStrategy';
import { showMessage } from '../../composables/useAppMessage';
import { showConfirm } from '../../composables/useAppDialog';
import { expandTilde, joinPath, parentOf, baseName } from '../../utils/path';
import FileModal from '../../components/modals/FileModal.vue';
import AppSelect from '../../components/AppSelect.vue';
import type { SelectOption } from '../../components/AppSelect';
import type { FileModalCreatePayload } from '../../components/modals/FileModal';
import FileTransferModal from './FileTransferModal.vue';
import { sshService } from '../ssh/sshService';

/** 收藏夹条目：支持自定义显示名称和图标 */
interface FavoriteItem {
  /** 数据库记录 id（数据库持久化后回填） */
  id?: number;
  path: string;
  name: string;
  /** 自定义图标标识（内置图标集的 key），默认 'folder' */
  icon?: string;
  /** 图标颜色（来自内置图标集，持久化存储） */
  color?: string;
}

/** 数据库 terminal_favorites 表的记录类型（驼峰命名） */
interface TerminalFavoriteRecord {
  id: number;
  sshProfileId: string;
  path: string;
  name: string;
  icon: string;
  color: string;
  sortOrder: number;
}

interface TreeNode {
  entry: FileEntry;
  children: TreeNode[];
  loaded: boolean;
  expanded: boolean;
  nextCursor: RemoteDirectoryCursor | null;
}

interface FlattenedNode {
  node: TreeNode;
  depth: number;
  loadMore?: boolean;
}

interface ContextMenuState {
  x: number;
  y: number;
  node: TreeNode;
}

const FAVORITES_KEY = 'easy_terminal_favorites';
const MAX_FAVORITES = 20;

export default defineComponent({
  name: 'FileTree',
  components: { FileModal, FileTransferModal, Icon, Refresh, Target, AppSelect },
  emits: ['open-terminal', 'open-current-terminal', 'open-preview', 'locate-cwd', 'ready', 'strategy-change'],
  setup(_, { emit, expose }) {
    const tree = reactive<{ roots: TreeNode[] }>({ roots: [] });
    const filterText = ref('');
    const sortKey = ref<'name' | 'modified' | 'size'>('name');
    const sortDir = ref<'asc' | 'desc'>('asc');
    const currentPath = ref('');
    const selectedPath = ref('');
    const favorites = ref<FavoriteItem[]>([]);
    // 当前 SSH profile id（空字符串表示本地终端共享收藏夹）
    let currentSshProfileId = '';
    // localStorage 迁移标记，避免重复执行
    let localFavoritesMigrated = false;
    // 收藏夹网格：默认显示 2 行（每行 3 个 = 6 个），展开时每次 +2 行
    const FAV_DEFAULT_ROWS = 2;
    const FAV_COLS = 3;
    const favExpandedRows = ref(FAV_DEFAULT_ROWS);
    /** 当前可见的收藏夹列表（按展开行数截断） */
    const visibleFavorites = computed(() => {
      const max = favExpandedRows.value * FAV_COLS;
      return favorites.value.slice(0, max);
    });
    function expandFavorites() {
      favExpandedRows.value += 2;
    }
    function collapseFavorites() {
      favExpandedRows.value = FAV_DEFAULT_ROWS;
    }
    const treeListRef = ref<HTMLDivElement | null>(null);
    const showCustomTreeScrollbar = ref(false);
    const treeScrollbarTop = ref(0);
    const treeScrollbarHeight = ref(24);
    // 收藏夹区块始终可见（标题栏星标开关已移除）
    const showFavorites = ref(true);
    const fileModalOpen = ref(false);
    const fileModalParent = ref('');
    const fileModalMode = ref<'file' | 'folder'>('file');
    const renamingPath = ref('');
    const renamingValue = ref('');
    const contextMenu = ref<ContextMenuState | null>(null);
    const sshProfiles = ref<SSHProfile[]>([]);
    const currentRemoteProfile = ref<SSHProfile | null>(null);
    const transferOpen = ref(false);
    const transferMode = ref<'upload' | 'download'>('upload');
    const transferRemotePath = ref('');
    const externalDropActive = ref(false);

    // 文件策略：默认本地，支持运行时切换为远程（SSH）策略；使用 shallowRef 避免对策略实例做深度响应式代理
    const strategy = shallowRef<IFileOperationStrategy>(createLocalFileStrategy());

    // ===== 国际化标签 =====
    const filterPlaceholder = computed(() => t('file.filterPlaceholder'));
    const filterScopeLabel = computed(() => t('file.filterScope'));
    const clearSearchLabel = computed(() => t('file.clearSearch'));
    const favoritesLabel = computed(() => t('file.favorites'));
    const favoritesEmptyLabel = computed(() => t('file.favoritesEmpty'));
    const emptyLabel = computed(() => t('file.noResults'));
    const sortNameLabel = computed(() => t('file.sortName'));
    const sortModifiedLabel = computed(() => t('file.sortModified'));
    const sortSizeLabel = computed(() => t('file.sortSize'));
    // AppSelect 所需的排序选项：每个字段一个选项（方向用独立按钮切换，避免重复）
    const sortOptions = computed<SelectOption[]>(() => [
      { label: sortNameLabel.value, value: 'name' },
      { label: sortModifiedLabel.value, value: 'modified' },
      { label: sortSizeLabel.value, value: 'size' },
    ]);

    // 排序选择当前值（仅字段，方向由独立按钮控制）
    const sortValue = computed(() => sortKey.value);
    const newFileLabel = computed(() => t('file.newFile'));
    const newFolderLabel = computed(() => t('file.newFolder'));
    const renameLabel = computed(() => t('file.rename'));
    const deleteLabel = computed(() => t('file.delete'));
    const addFavoriteLabel = computed(() => t('file.addToFavorites'));
    const removeFavoriteLabel = computed(() => t('file.removeFromFavorites'));
    const openInTerminalLabel = computed(() => t('file.openInTerminal'));
    const copyPathLabel = computed(() => t('file.copyPath'));
    const refreshLabel = computed(() => t('file.refresh'));

    // ===== 工具函数 =====
    /** 根据 entry.icon 返回文件类型 CSS 类，用于丰富图标颜色 */
    function iconClass(entry: FileEntry): string {
      if (entry.is_dir) return 'folder';
      const map: Record<string, string> = {
        typescript: 'ext-ts', javascript: 'ext-js', rust: 'ext-rs',
        python: 'ext-py', css: 'ext-css', html: 'ext-html',
        json: 'ext-json', markdown: 'ext-md', config: 'ext-config',
        image: 'ext-img', executable: 'ext-exe', archive: 'ext-zip',
      };
      return map[entry.icon] || 'file';
    }

    function toTreeNode(entry: FileEntry): TreeNode {
      return { entry, children: [], loaded: false, expanded: false, nextCursor: null };
    }

    const rootLoadMoreNode = toTreeNode({ name: '加载更多', path: '__root_load_more__', is_dir: false, size: 0, modified: 0, icon: 'more' });
    let rootNextCursor: RemoteDirectoryCursor | null = null;
    // Search results are deliberately separate from the tree. This keeps a
    // current-directory name search from collapsing or mutating expanded nodes.
    const currentPathSearchRoots = ref<TreeNode[] | null>(null);
    let currentPathSearchNextCursor: RemoteDirectoryCursor | null = null;
    let fileNameSearchTimer: number | null = null;
    let treeRequestVersion = 0;
    let disposed = false;

    function startTreeRequest(): number {
      treeRequestVersion += 1;
      return treeRequestVersion;
    }

    function isCurrentTreeRequest(version: number): boolean {
      return !disposed && version === treeRequestVersion;
    }

    async function readDirectory(
      path: string,
      cursor: RemoteDirectoryCursor | null,
      version: number,
      nameFilter = '',
    ): Promise<RemoteDirectoryPage | null> {
      // Do not detach a strategy method: RemoteFileStrategy relies on `this`
      // for its SSH profile and profile collection.
      const activeStrategy = strategy.value;
      const page = activeStrategy.readDirPage
        ? await activeStrategy.readDirPage(path, cursor, nameFilter)
        : { entries: await activeStrategy.readDir(path), nextCursor: null };
      if (!isCurrentTreeRequest(version)) return null;
      if (activeStrategy.readDirPage || !nameFilter) return page;
      const normalizedFilter = nameFilter.toLocaleLowerCase();
      return {
        ...page,
        entries: page.entries.filter((entry) => entry.name.toLocaleLowerCase().includes(normalizedFilter)),
      };
    }

    /** Return the normalized current-directory file-name query. */
    function currentFileNameQuery(): string {
      return filterText.value.trim();
    }

    /** Clear only the current-directory search state without navigating away. */
    function clearFileNameSearch() {
      filterText.value = '';
      currentPathSearchRoots.value = null;
      currentPathSearchNextCursor = null;
      if (fileNameSearchTimer !== null) {
        window.clearTimeout(fileNameSearchTimer);
        fileNameSearchTimer = null;
      }
      scheduleTreeScrollbarUpdate();
    }

    /** Discard a search when changing directory or switching file strategy. */
    function resetFileNameSearch() {
      clearFileNameSearch();
    }

    /**
     * Search direct children of the current path by name.
     * Remote strategies receive the query over SFTP so results are not limited
     * to the entries that happened to be rendered before searching.
     */
    async function searchCurrentPathFileNames(query = currentFileNameQuery()) {
      if (!query || !currentPath.value) {
        currentPathSearchRoots.value = null;
        currentPathSearchNextCursor = null;
        scheduleTreeScrollbarUpdate();
        return;
      }
      const version = startTreeRequest();
      try {
        const page = await readDirectory(currentPath.value, null, version, query);
        if (!page || query !== currentFileNameQuery()) return;
        currentPathSearchRoots.value = page.entries.map(toTreeNode);
        currentPathSearchNextCursor = page.nextCursor;
        sortNodes(currentPathSearchRoots.value);
        scheduleTreeScrollbarUpdate();
      } catch (err) {
        if (query === currentFileNameQuery()) {
          showMessage(`搜索文件失败: ${err}`, 'error');
        }
      }
    }

    function sortNodes(nodes: TreeNode[]) {
      nodes.sort((left, right) => {
        if (left.entry.is_dir !== right.entry.is_dir) return left.entry.is_dir ? -1 : 1;
        let cmp = 0;
        if (sortKey.value === 'name') cmp = left.entry.name.localeCompare(right.entry.name);
        else if (sortKey.value === 'modified') cmp = left.entry.modified - right.entry.modified;
        else if (sortKey.value === 'size') cmp = left.entry.size - right.entry.size;
        return sortDir.value === 'asc' ? cmp : -cmp;
      });
    }

    // AppSelect 值回调：解析 "字段-方向" 合成 key
    /** 排序字段变化（方向由独立按钮 toggleSortDir 切换） */
    function onSortKeyChange(value: unknown) {
      const field = String(value || '');
      if (field) sortKey.value = field as 'name' | 'modified' | 'size';
    }
    /** 切换升降序方向 */
    function toggleSortDir() {
      sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
    }

    function flatten(nodes: TreeNode[], depth = 0, acc: FlattenedNode[] = []): FlattenedNode[] {
      for (const node of nodes) {
        acc.push({ node, depth });
        if (node.expanded && node.children.length) {
          flatten(node.children, depth + 1, acc);
        }
        if (node.expanded && node.nextCursor) acc.push({ node, depth: depth + 1, loadMore: true });
      }
      return acc;
    }

    const visibleNodes = computed<FlattenedNode[]>(() => {
      const query = currentFileNameQuery();
      if (query) {
        const matchedRoots = currentPathSearchRoots.value ?? [];
        const matched: FlattenedNode[] = matchedRoots.map((node) => ({ node, depth: 0 }));
        if (currentPathSearchNextCursor) matched.push({ node: rootLoadMoreNode, depth: 0, loadMore: true });
        return matched;
      }
      const flattened = flatten(tree.roots);
      if (rootNextCursor) flattened.push({ node: rootLoadMoreNode, depth: 0, loadMore: true });
      return flattened;
    });

    function findNode(nodes: TreeNode[], path: string): TreeNode | null {
      for (const node of nodes) {
        if (node.entry.path === path) return node;
        if (node.children.length) {
          const found = findNode(node.children, path);
          if (found) return found;
        }
      }
      return null;
    }

    function formatSize(bytes: number): string {
      if (bytes < 1024) return `${bytes}B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
      if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
    }

    // joinPath / parentOf / baseName 已抽取到 utils/path.ts

    // ===== 收藏夹 =====

    /** 迁移 localStorage 旧收藏夹到数据库（仅本地 ssh_profile_id='' 且首次执行） */
    async function migrateLocalFavoritesIfNeeded() {
      if (localFavoritesMigrated) return;
      localFavoritesMigrated = true;
      const saved = localStorage.getItem(FAVORITES_KEY);
      if (!saved) return;
      try {
        const parsed = JSON.parse(saved) as FavoriteItem[];
        if (!Array.isArray(parsed) || parsed.length === 0) {
          localStorage.removeItem(FAVORITES_KEY);
          return;
        }
        // 若数据库已有本地收藏夹记录，直接清理 localStorage，不重复导入
        const existing = await invoke<TerminalFavoriteRecord[]>('list_terminal_favorites', {
          sshProfileId: '',
        });
        if (existing.length > 0) {
          localStorage.removeItem(FAVORITES_KEY);
          return;
        }
        for (const item of parsed) {
          await invoke('add_terminal_favorite', {
            sshProfileId: '',
            path: item.path,
            name: item.name || '',
            icon: item.icon || 'folder',
            color: item.color || '#e0a030',
          });
        }
        localStorage.removeItem(FAVORITES_KEY);
      } catch {
        // 迁移失败时保留 localStorage，下次启动可重试
        localFavoritesMigrated = false;
      }
    }

    async function loadFavorites() {
      await migrateLocalFavoritesIfNeeded();
      try {
        const records = await invoke<TerminalFavoriteRecord[]>('list_terminal_favorites', {
          sshProfileId: currentSshProfileId,
        });
        favorites.value = records.map((r) => ({
          id: r.id,
          path: r.path,
          name: r.name,
          icon: r.icon,
          color: r.color,
        }));
      } catch {
        favorites.value = [];
      }
    }

    function isFavorite(path: string): boolean {
      return favorites.value.some((item) => item.path === path);
    }

    async function toggleFavorite(node: TreeNode) {
      if (!node.entry.is_dir) return;
      if (isFavorite(node.entry.path)) {
        await removeFavorite(node.entry.path);
      } else {
        if (favorites.value.length >= MAX_FAVORITES) {
          showMessage(t('file.favoritesFull'), 'warning');
          return;
        }
        try {
          await invoke('add_terminal_favorite', {
            sshProfileId: currentSshProfileId,
            path: node.entry.path,
            name: node.entry.name,
            icon: 'folder',
            color: '#e0a030',
          });
          await loadFavorites();
        } catch (err) {
          showMessage(`添加收藏失败: ${err}`, 'error');
        }
      }
      contextMenu.value = null;
    }

    async function removeFavorite(path: string) {
      try {
        await invoke('remove_terminal_favorite', {
          sshProfileId: currentSshProfileId,
          path,
        });
        await loadFavorites();
      } catch (err) {
        showMessage(`移除收藏失败: ${err}`, 'error');
      }
    }

    // ===== 收藏夹编辑：自定义名称 + 图标 =====

    /** 内置图标集：供收藏夹选择，每个图标带专属颜色 */
    const FAVORITE_ICONS: { key: string; label: string; svg: string; color: string }[] = [
      { key: 'folder', label: '文件夹', color: '#e0a030', svg: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>' },
      { key: 'star', label: '星标', color: '#f0c040', svg: '<path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/>' },
      { key: 'code', label: '代码', color: '#569cd6', svg: '<polyline points="4 17 10 11 4 5"/><polyline points="14 17 20 11 14 5"/>' },
      { key: 'git', label: 'Git', color: '#e8564a', svg: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="12" r="3"/><path d="M6 9v6M9 6h6a3 3 0 0 1 3 3M9 18h6a3 3 0 0 0 3-3"/>' },
      { key: 'server', label: '服务器', color: '#4ec9b0', svg: '<rect x="3" y="4" width="18" height="6" rx="1"/><rect x="3" y="14" width="18" height="6" rx="1"/><circle cx="7" cy="7" r="0.8"/><circle cx="7" cy="17" r="0.8"/>' },
      { key: 'home', label: '主页', color: '#c17f59', svg: '<path d="M3 12l9-9 9 9"/><path d="M5 10v10h14V10"/>' },
      { key: 'book', label: '文档', color: '#8ab4f8', svg: '<path d="M4 4h6v16H4z"/><path d="M10 4h4v16h-4z"/><path d="M14 4l6 1-3 15-6-1z"/>' },
      { key: 'docker', label: '容器', color: '#2496ed', svg: '<rect x="3" y="9" width="4" height="4"/><rect x="8" y="9" width="4" height="4"/><rect x="13" y="9" width="4" height="4"/><rect x="8" y="4" width="4" height="4"/><path d="M2 14h18a4 4 0 0 0 0-8"/>' },
      { key: 'heart', label: '收藏', color: '#e85d75', svg: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>' },
      { key: 'terminal', label: '终端', color: '#3bb273', svg: '<rect x="3" y="4" width="18" height="16" rx="2"/><polyline points="7 9 10 12 7 15"/><line x1="13" y1="15" x2="17" y2="15"/>' },
      { key: 'database', label: '数据库', color: '#a371f7', svg: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v6c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 11v6c0 1.7 4 3 9 3s9-1.3 9-3v-6"/>' },
      { key: 'cloud', label: '云', color: '#5ec8e8', svg: '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>' },
      { key: 'globe', label: '网络', color: '#6bb577', svg: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>' },
      { key: 'package', label: '包', color: '#ce9178', svg: '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 12l9-5"/><path d="M12 12v10"/><path d="M12 12L3 7"/>' },
      { key: 'settings', label: '配置', color: '#9aa0a6', svg: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 0 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>' },
    ];

    /** 收藏夹编辑弹框状态 */
    const favEditOpen = ref(false);
    const favEditPath = ref('');
    const favEditName = ref('');
    const favEditIcon = ref('folder');

    /** 打开收藏夹编辑弹框 */
    function openFavEditor(fav: FavoriteItem) {
      favEditPath.value = fav.path;
      favEditName.value = fav.name;
      favEditIcon.value = fav.icon || 'folder';
      favEditOpen.value = true;
      contextMenu.value = null;
    }

    /** 保存收藏夹编辑 */
    async function saveFavEdit() {
      const target = favorites.value.find((f) => f.path === favEditPath.value);
      if (target && target.id != null) {
        try {
          await invoke('update_terminal_favorite', {
            id: target.id,
            name: favEditName.value.trim() || target.name,
            icon: favEditIcon.value,
            color: favIconColor(favEditIcon.value),
          });
          await loadFavorites();
        } catch (err) {
          showMessage(`更新收藏失败: ${err}`, 'error');
        }
      }
      favEditOpen.value = false;
    }

    /** 获取收藏夹图标的 SVG path */
    function favIconSvg(iconKey: string | undefined): string {
      const found = FAVORITE_ICONS.find((i) => i.key === iconKey);
      return found ? found.svg : FAVORITE_ICONS[0].svg;
    }

    /** 获取收藏夹图标的颜色 */
    function favIconColor(iconKey: string | undefined): string {
      const found = FAVORITE_ICONS.find((i) => i.key === iconKey);
      return found ? found.color : FAVORITE_ICONS[0].color;
    }

    /** 收藏夹右键菜单 */
    const favContextMenu = ref<{ x: number; y: number; fav: FavoriteItem } | null>(null);
    function onFavContext(e: MouseEvent, fav: FavoriteItem) {
      e.preventDefault();
      e.stopPropagation();
      favContextMenu.value = { x: e.clientX, y: e.clientY, fav };
    }

    /** 复制收藏夹路径到剪贴板 */
    function copyFavPath(fav: FavoriteItem) {
      void navigator.clipboard.writeText(fav.path).then(() => {
        showMessage(t('file.pathCopied'), 'success');
      }).catch(() => {
        showMessage(t('file.copyFailed'), 'error');
      });
    }

    function updateTreeScrollbar() {
      const list = treeListRef.value;
      if (!list) return;
      const scrollable = list.scrollHeight > list.clientHeight + 1;
      showCustomTreeScrollbar.value = scrollable;
      if (!scrollable) {
        treeScrollbarTop.value = 0;
        return;
      }

      const trackPadding = 6;
      const trackHeight = Math.max(0, list.clientHeight - trackPadding * 2);
      const thumbHeight = Math.max(24, Math.round((list.clientHeight / list.scrollHeight) * trackHeight));
      const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
      const maxScroll = Math.max(1, list.scrollHeight - list.clientHeight);
      treeScrollbarHeight.value = thumbHeight;
      treeScrollbarTop.value = trackPadding + Math.round((list.scrollTop / maxScroll) * maxThumbTop);
    }

    function scrollTreeToThumbClientY(clientY: number) {
      const list = treeListRef.value;
      if (!list) return;
      const trackPadding = 6;
      const trackHeight = Math.max(0, list.clientHeight - trackPadding * 2);
      const maxThumbTop = Math.max(0, trackHeight - treeScrollbarHeight.value);
      if (maxThumbTop <= 0) return;
      const rect = list.getBoundingClientRect();
      const relative = Math.max(0, Math.min(maxThumbTop, clientY - rect.top - trackPadding - treeScrollbarHeight.value / 2));
      const maxScroll = Math.max(0, list.scrollHeight - list.clientHeight);
      list.scrollTop = (relative / maxThumbTop) * maxScroll;
      updateTreeScrollbar();
    }

    function onTreeScrollbarTrackMouseDown(event: MouseEvent) {
      scrollTreeToThumbClientY(event.clientY);
    }

    let treeScrollbarDragStartY = 0;
    let treeScrollbarDragStartScrollTop = 0;
    let treeListResizeObserver: ResizeObserver | null = null;

    function onTreeScrollbarDragMove(event: MouseEvent) {
      const list = treeListRef.value;
      if (!list) return;
      const trackPadding = 6;
      const trackHeight = Math.max(0, list.clientHeight - trackPadding * 2);
      const maxThumbTop = Math.max(1, trackHeight - treeScrollbarHeight.value);
      const maxScroll = Math.max(0, list.scrollHeight - list.clientHeight);
      const delta = event.clientY - treeScrollbarDragStartY;
      list.scrollTop = treeScrollbarDragStartScrollTop + (delta / maxThumbTop) * maxScroll;
      updateTreeScrollbar();
    }

    function onTreeScrollbarDragEnd() {
      document.body.classList.remove('tree-scrollbar-dragging');
      window.removeEventListener('mousemove', onTreeScrollbarDragMove);
      window.removeEventListener('mouseup', onTreeScrollbarDragEnd);
    }

    function onTreeScrollbarThumbMouseDown(event: MouseEvent) {
      const list = treeListRef.value;
      if (!list) return;
      treeScrollbarDragStartY = event.clientY;
      treeScrollbarDragStartScrollTop = list.scrollTop;
      document.body.classList.add('tree-scrollbar-dragging');
      window.addEventListener('mousemove', onTreeScrollbarDragMove);
      window.addEventListener('mouseup', onTreeScrollbarDragEnd);
    }

    function scheduleTreeScrollbarUpdate() {
      void nextTick(updateTreeScrollbar);
    }

    // ===== 目录加载 =====
    async function loadChildren(node: TreeNode, version = startTreeRequest()) {
      const page = await readDirectory(node.entry.path, null, version);
      if (!page) return;
      node.children = page.entries.map(toTreeNode);
      node.loaded = true;
      node.expanded = true;
      node.nextCursor = page.nextCursor;
      sortNodes(node.children);
    }

    async function loadMore(node: TreeNode) {
      const version = startTreeRequest();
      const nameFilter = node === rootLoadMoreNode ? currentFileNameQuery() : '';
      const cursor = node === rootLoadMoreNode
        ? (nameFilter ? currentPathSearchNextCursor : rootNextCursor)
        : node.nextCursor;
      if (!cursor) return;
      const path = node === rootLoadMoreNode ? currentPath.value : node.entry.path;
      const page = await readDirectory(path, cursor, version, nameFilter);
      if (!page) return;
      if (node === rootLoadMoreNode) {
        if (nameFilter && currentPathSearchRoots.value) {
          currentPathSearchRoots.value.push(...page.entries.map(toTreeNode));
          currentPathSearchNextCursor = page.nextCursor;
          sortNodes(currentPathSearchRoots.value);
        } else {
          tree.roots.push(...page.entries.map(toTreeNode));
          rootNextCursor = page.nextCursor;
          sortNodes(tree.roots);
        }
      } else {
        node.children.push(...page.entries.map(toTreeNode));
        node.nextCursor = page.nextCursor;
        sortNodes(node.children);
      }
      scheduleTreeScrollbarUpdate();
    }

    // 初始化文件树：Windows 多盘符环境下以每个盘符作为根节点，其余平台沿用家目录
    async function init() {
      resetFileNameSearch();
      const version = startTreeRequest();
      try {
        // 探测当前系统平台，仅在 Windows 且策略支持 listDrives 时启用多盘符
        const platform = await invoke<string>('get_os_platform');
        if (platform === 'windows' && strategy.value.listDrives) {
          const drives = await strategy.value.listDrives();
          if (!isCurrentTreeRequest(version)) return;
          if (drives.length > 1) {
            currentPath.value = drives[0];
            tree.roots = drives.map((drive) => toTreeNode({
              name: drive,
              path: drive,
              is_dir: true,
              size: 0,
              modified: 0,
              icon: 'drive',
            }));
            sortNodes(tree.roots);
            await loadFavorites();
            return;
          }
        }
        // 非 Windows 或单盘符：回落到家目录
        const home = await strategy.value.getHomePath();
        if (!isCurrentTreeRequest(version)) return;
        currentPath.value = home;
        const page = await readDirectory(home, null, version);
        if (!page) return;
        tree.roots = page.entries.map(toTreeNode);
        rootNextCursor = page.nextCursor;
        sortNodes(tree.roots);
        await loadFavorites();
        scheduleTreeScrollbarUpdate();
      } catch (err) {
        showMessage(`初始化文件树失败: ${err}`, 'error');
      }
      // 通知父组件文件树已就绪，可进行策略同步
      emit('ready');
      // 通知父组件当前使用的策略（初始为本地），使 PreviewPanel 能预览本地文件
      emit('strategy-change', strategy.value);
    }

    function collectExpanded(nodes: TreeNode[], acc: string[] = []): string[] {
      for (const node of nodes) {
        if (node.expanded) acc.push(node.entry.path);
        if (node.children.length) collectExpanded(node.children, acc);
      }
      return acc;
    }

    // 刷新当前目录树，并保留此前已展开的目录节点状态
    async function refreshTree() {
      const activeSearchQuery = currentFileNameQuery();
      const version = startTreeRequest();
      try {
        const expandedPaths = collectExpanded(tree.roots);
        const page = await readDirectory(currentPath.value, null, version);
        if (!page) return;
        tree.roots = page.entries.map(toTreeNode);
        rootNextCursor = page.nextCursor;
        sortNodes(tree.roots);
        for (const path of expandedPaths) {
          if (!isCurrentTreeRequest(version)) return;
          const node = findNode(tree.roots, path);
          if (node && node.entry.is_dir && !node.loaded) {
            await loadChildren(node, version);
          }
        }
        scheduleTreeScrollbarUpdate();
        if (activeSearchQuery) void searchCurrentPathFileNames(activeSearchQuery);
      } catch (err) {
        showMessage(`刷新失败: ${err}`, 'error');
      }
    }

    async function navigateTo(path: string) {
      resetFileNameSearch();
      const version = startTreeRequest();
      try {
        currentPath.value = path;
        const page = await readDirectory(path, null, version);
        if (!page) return;
        tree.roots = page.entries.map(toTreeNode);
        rootNextCursor = page.nextCursor;
        sortNodes(tree.roots);
        selectedPath.value = '';
        scheduleTreeScrollbarUpdate();
      } catch (err) {
        showMessage(`打开目录失败: ${err}`, 'error');
      }
    }

    // ===== 节点交互 =====
    async function toggleNode(node: TreeNode) {
      if (!node.entry.is_dir) return;
      if (!node.loaded) {
        try {
          await loadChildren(node);
          scheduleTreeScrollbarUpdate();
        } catch (err) {
          showMessage(`加载目录失败: ${err}`, 'error');
        }
      } else {
        if (node.expanded && strategy.value.readDirPage) {
          // Remote children are intentionally released on collapse so deep
          // browsing cannot retain an unbounded tree in the renderer.
          node.children = [];
          node.loaded = false;
          node.nextCursor = null;
          node.expanded = false;
        } else {
          node.expanded = !node.expanded;
        }
        scheduleTreeScrollbarUpdate();
      }
    }

    async function onNodeClick(node: TreeNode) {
      selectedPath.value = node.entry.path;
      if (node.entry.is_dir) {
        if (currentFileNameQuery()) {
          clearFileNameSearch();
          await navigateTo(node.entry.path);
          return;
        }
        await toggleNode(node);
      }
    }

    function onNodeDblClick(node: TreeNode) {
      if (!node.entry.is_dir) emit('open-preview', node.entry.path);
    }

    function onNodeContext(event: MouseEvent, node: TreeNode) {
      event.preventDefault();
      event.stopPropagation();
      selectedPath.value = node.entry.path;
      contextMenu.value = { x: event.clientX, y: event.clientY, node };
    }

    function isRemoteTree(): boolean {
      return currentRemoteProfile.value !== null;
    }

    function openTransfer(mode: 'upload' | 'download', node?: TreeNode) {
      if (!currentRemoteProfile.value) return;
      transferMode.value = mode;
      transferRemotePath.value = node
        ? (node.entry.is_dir ? node.entry.path : parentOf(node.entry.path))
        : currentPath.value;
      transferOpen.value = true;
      contextMenu.value = null;
    }

    /** Desktop-file drops are accepted only while a remote SSH tree is active. */
    function onExternalDragOver(event: DragEvent) {
      if (!isRemoteTree() || !event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      externalDropActive.value = true;
      event.dataTransfer.dropEffect = 'copy';
    }

    function onExternalDragLeave(event: DragEvent) {
      const related = event.relatedTarget;
      if (related instanceof Node && event.currentTarget instanceof Node && event.currentTarget.contains(related)) return;
      externalDropActive.value = false;
    }

    async function onExternalDrop(event: DragEvent, target?: TreeNode) {
      externalDropActive.value = false;
      if (!isRemoteTree() || !event.dataTransfer?.files.length || !currentRemoteProfile.value) return;
      event.preventDefault();
      const paths = Array.from(event.dataTransfer.files)
        .map((file) => (file as File & { path?: string }).path || '')
        .filter(Boolean);
      if (!paths.length) {
        showMessage('无法读取拖放文件路径，请使用“上传到此目录”。', 'warning');
        return;
      }
      const remoteDir = target ? (target.entry.is_dir ? target.entry.path : parentOf(target.entry.path)) : currentPath.value;
      try {
        await sshService.uploadLocalEntries(currentRemoteProfile.value, paths, remoteDir, sshProfiles.value);
        showMessage(`已上传 ${paths.length} 项`, 'success');
        await refreshTree();
      } catch (err) {
        showMessage(`上传失败: ${err}`, 'error');
      }
    }

    // ===== 新建 =====
    // 打开新建弹框：mode 区分文件 / 文件夹，父目录取当前选中目录或 currentPath
    function openCreateModal(mode: 'file' | 'folder') {
      const node = selectedPath.value ? findNode(tree.roots, selectedPath.value) : null;
      const parent = node && node.entry.is_dir ? node.entry.path : currentPath.value;
      fileModalParent.value = parent;
      fileModalMode.value = mode;
      fileModalOpen.value = true;
      contextMenu.value = null;
    }

    // 新建文件/文件夹模态框确认回调：落盘后刷新目录树
    async function onFileModalCreate(payload: FileModalCreatePayload) {
      const parent = fileModalParent.value || currentPath.value;
      const fullPath = joinPath(parent, payload.name);
      try {
        await strategy.value.createEntry(fullPath, payload.type === 'folder');
        if (payload.type === 'file' && payload.content) {
          await strategy.value.writeFile(fullPath, payload.content);
        }
        showMessage(payload.type === 'file' ? '文件已创建' : '文件夹已创建', 'success');
        await refreshTree();
      } catch (err) {
        showMessage(t('file.createFailed', String(err)), 'error');
      }
    }

    // ===== 复制路径（跨平台，写入剪贴板） =====
    async function copyNodePath(node: TreeNode) {
      contextMenu.value = null;
      try {
        await navigator.clipboard.writeText(node.entry.path);
        showMessage(t('file.pathCopied'), 'success');
      } catch {
        showMessage(t('file.copyFailed'), 'error');
      }
    }

    // ===== 重命名 =====
    function startRename(node: TreeNode) {
      renamingPath.value = node.entry.path;
      renamingValue.value = node.entry.name;
      contextMenu.value = null;
    }

    // 提交重命名：校验新名称、二次确认后调用策略重命名并刷新
    async function commitRename(node: TreeNode) {
      const newName = renamingValue.value.trim();
      renamingPath.value = '';
      if (!newName || newName === node.entry.name) return;
      const newPath = joinPath(parentOf(node.entry.path), newName);
      const confirmed = await showConfirm({
        content: `将 "${node.entry.name}" 重命名为 "${newName}" ?`,
        positiveText: t('file.rename'),
      });
      if (!confirmed) return;
      try {
        await strategy.value.renameEntry(node.entry.path, newPath);
        showMessage('已重命名', 'success');
        await refreshTree();
      } catch (err) {
        showMessage(t('file.renameFailed', String(err)), 'error');
      }
    }

    function cancelRename() {
      renamingPath.value = '';
      renamingValue.value = '';
    }

    // ===== 删除 =====
    async function deleteNode(node: TreeNode) {
      contextMenu.value = null;
      const confirmed = await showConfirm({
        content: t('file.confirmDelete', node.entry.name),
        danger: true,
        positiveText: t('file.delete'),
      });
      if (!confirmed) return;
      try {
        await strategy.value.deleteEntries([node.entry.path]);
        showMessage('已删除', 'success');
        if (selectedPath.value === node.entry.path) selectedPath.value = '';
        await refreshTree();
      } catch (err) {
        showMessage(t('file.deleteFailed', String(err)), 'error');
      }
    }

    // ===== 新开终端 =====
    function openTerminalHere(node: TreeNode) {
      if (node.entry.is_dir) emit('open-terminal', node.entry.path);
      contextMenu.value = null;
    }

    /** Reuse the terminal paired with this file panel instead of creating one. */
    function openInCurrentTerminal(node: TreeNode) {
      const dirPath = node.entry.is_dir ? node.entry.path : parentOf(node.entry.path);
      if (dirPath) emit('open-current-terminal', dirPath);
      contextMenu.value = null;
    }

    // ===== 拖拽移动（本地策略可用） =====
    function onDragStart(event: DragEvent, node: TreeNode) {
      if (event.dataTransfer) {
        event.dataTransfer.setData('text/plain', node.entry.path);
        event.dataTransfer.effectAllowed = 'move';
      }
    }

    function onDragOver(event: DragEvent, node: TreeNode) {
      if (!node.entry.is_dir) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = event.dataTransfer.types.includes('Files') ? 'copy' : 'move';
    }

    async function onDrop(event: DragEvent, node: TreeNode) {
      event.preventDefault();
      if (event.dataTransfer?.types.includes('Files')) {
        await onExternalDrop(event, node);
        return;
      }
      const sourcePath = event.dataTransfer?.getData('text/plain');
      if (!sourcePath || sourcePath === node.entry.path || !node.entry.is_dir) return;
      try {
        const newPath = joinPath(node.entry.path, baseName(sourcePath));
        await strategy.value.renameEntry(sourcePath, newPath);
        showMessage('已移动', 'success');
        await refreshTree();
      } catch (err) {
        showMessage(`移动失败: ${err}`, 'error');
      }
    }

    // ===== 全局事件 =====
    function onGlobalClick() {
      contextMenu.value = null;
    }

    function onKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (renamingPath.value) {
          cancelRename();
          return;
        }
        if (contextMenu.value) {
          contextMenu.value = null;
          return;
        }
      }
    }

    onMounted(() => {
      void init();
      document.addEventListener('click', onGlobalClick);
      document.addEventListener('keydown', onKeydown, true);
      window.addEventListener('resize', updateTreeScrollbar);
      void nextTick(() => {
        if (!treeListRef.value) return;
        treeListResizeObserver = new ResizeObserver(updateTreeScrollbar);
        treeListResizeObserver.observe(treeListRef.value);
        updateTreeScrollbar();
      });
    });

    onBeforeUnmount(() => {
      disposed = true;
      startTreeRequest();
      if (fileNameSearchTimer !== null) window.clearTimeout(fileNameSearchTimer);
      document.removeEventListener('click', onGlobalClick);
      document.removeEventListener('keydown', onKeydown, true);
      window.removeEventListener('resize', updateTreeScrollbar);
      treeListResizeObserver?.disconnect();
      treeListResizeObserver = null;
      onTreeScrollbarDragEnd();
    });

    watch(visibleNodes, scheduleTreeScrollbarUpdate, { flush: 'post' });
    watch(filterText, () => {
      if (fileNameSearchTimer !== null) window.clearTimeout(fileNameSearchTimer);
      const query = currentFileNameQuery();
      if (!query) {
        currentPathSearchRoots.value = null;
        currentPathSearchNextCursor = null;
        scheduleTreeScrollbarUpdate();
        return;
      }
      fileNameSearchTimer = window.setTimeout(() => {
        fileNameSearchTimer = null;
        void searchCurrentPathFileNames(query);
      }, 160);
    });

    // ===== 列宽缩放（localStorage 持久化） =====
    const PANEL_WIDTH_KEY = 'easy_terminal_filetree_width';
    const PANEL_MIN = 180;
    const PANEL_MAX = 480;
    const panelWidth = ref<number>(loadPanelWidth());
    const resizing = ref(false);
    let resizeStartX = 0;
    let resizeStartW = 0;

    function loadPanelWidth(): number {
      const raw = localStorage.getItem(PANEL_WIDTH_KEY);
      const n = raw ? parseInt(raw, 10) : NaN;
      if (Number.isFinite(n) && n >= PANEL_MIN && n <= PANEL_MAX) return n;
      return 240;
    }
    function persistPanelWidth(w: number) {
      try { localStorage.setItem(PANEL_WIDTH_KEY, String(w)); } catch { /* ignore */ }
    }
    function onResizerMouseMove(event: MouseEvent) {
      const dx = event.clientX - resizeStartX;
      const next = Math.max(PANEL_MIN, Math.min(PANEL_MAX, resizeStartW + dx));
      panelWidth.value = next;
    }
    function onResizerMouseUp() {
      resizing.value = false;
      document.body.classList.remove('files-resizing');
      persistPanelWidth(panelWidth.value);
      window.removeEventListener('mousemove', onResizerMouseMove);
      window.removeEventListener('mouseup', onResizerMouseUp);
    }
    function onResizerMouseDown(event: MouseEvent) {
      resizing.value = true;
      resizeStartX = event.clientX;
      resizeStartW = panelWidth.value;
      document.body.classList.add('files-resizing');
      window.addEventListener('mousemove', onResizerMouseMove);
      window.addEventListener('mouseup', onResizerMouseUp);
    }

    // ===== 对外暴露 =====
    function setSshProfiles(profiles: SSHProfile[]) {
      sshProfiles.value = profiles;
    }

    /** 切换为远程文件策略：连接 SSH 服务器获取家目录并重新加载文件树 */
    async function switchToRemote(profile: SSHProfile, profiles: SSHProfile[]) {
      try {
        const home = await invoke<string>('get_remote_home', { profile, profiles });
        const remoteStrategy = createRemoteFileStrategy(profile.id, home, profile, profiles);
        strategy.value = remoteStrategy;
        currentRemoteProfile.value = profile;
        // 绑定 SSH profile id，使收藏夹按远程主机隔离
        currentSshProfileId = profile.id;
        // 通知父组件当前策略已变更为远程，使 PreviewPanel 能预览远程文件
        emit('strategy-change', remoteStrategy);
        await init();
      } catch (err) {
        // SSH 连接失败时保持本地策略，提示用户
        showMessage(`连接远程服务器失败: ${err}`, 'error');
      }
    }

    /** 切换回本地文件策略：重新初始化为本地家目录 */
    async function switchToLocal() {
      const localStrategy = createLocalFileStrategy();
      strategy.value = localStrategy;
      currentRemoteProfile.value = null;
      // 本地终端共享一套收藏夹（ssh_profile_id 为空）
      currentSshProfileId = '';
      // 通知父组件策略已变更为本地
      emit('strategy-change', localStrategy);
      await init();
    }

    /** Resolve `~` against the active remote account, never against this computer. */
    async function resolveTerminalPath(cwd: string): Promise<string> {
      if (!currentRemoteProfile.value) return expandTilde(cwd);
      const remoteHome = await strategy.value.getHomePath();
      const value = cwd.trim();
      if (value === '~') return remoteHome;
      if (value.startsWith('~/')) return joinPath(remoteHome, value.slice(2));
      return value;
    }

    // 定位到指定工作目录（用于「定位当前终端目录」按钮）
    async function locateToCwd(cwd: string) {
      if (!cwd) return;
      const expanded = await resolveTerminalPath(cwd);
      void navigateTo(expanded);
    }

    async function syncToTerminal(context: { cwd: string }) {
      if (!context.cwd || context.cwd === currentPath.value) return;
      const expanded = await resolveTerminalPath(context.cwd);
      if (expanded !== currentPath.value) {
        void navigateTo(expanded);
      }
    }

    expose({ setSshProfiles, syncToTerminal, locateToCwd, switchToRemote, switchToLocal });

    return {
      // 状态
      filterText, sortKey, sortDir, selectedPath,
      favorites, showFavorites, treeListRef,
      showCustomTreeScrollbar, treeScrollbarTop, treeScrollbarHeight,
      fileModalOpen, fileModalParent, fileModalMode,
      renamingPath, renamingValue, contextMenu, currentRemoteProfile,
      externalDropActive, transferOpen, transferMode, transferRemotePath, sshProfiles,
      // 计算属性
      filterPlaceholder, filterScopeLabel, clearSearchLabel, favoritesLabel, favoritesEmptyLabel, emptyLabel,
      sortNameLabel, sortModifiedLabel, sortSizeLabel, sortOptions, sortValue,
      newFileLabel, newFolderLabel, renameLabel, deleteLabel,
      addFavoriteLabel, removeFavoriteLabel, openInTerminalLabel,
      copyPathLabel, refreshLabel,
      visibleNodes,
      // 方法
      formatSize, isFavorite, toggleFavorite, removeFavorite, navigateTo, iconClass,
      clearFileNameSearch,
      // 收藏夹编辑
      FAVORITE_ICONS, favEditOpen, favEditName, favEditIcon, favIconSvg, favIconColor,
      openFavEditor, saveFavEdit, favContextMenu, onFavContext, copyFavPath,
      // 收藏夹网格展开
      visibleFavorites, favExpandedRows, FAV_DEFAULT_ROWS, expandFavorites, collapseFavorites,
      updateTreeScrollbar, onTreeScrollbarTrackMouseDown, onTreeScrollbarThumbMouseDown,
      onSortKeyChange,
      toggleSortDir,
      onNodeClick, onNodeDblClick, onNodeContext, toggleNode,
      loadMore,
      openCreateModal, onFileModalCreate,
      startRename, commitRename, cancelRename,
      deleteNode, copyNodePath, openTerminalHere, openInCurrentTerminal,
      onDragStart, onDragOver, onDrop, onExternalDragOver, onExternalDragLeave, onExternalDrop,
      openTransfer, isRemoteTree,
      refreshTree,
      // 列宽缩放
      panelWidth, resizing, onResizerMouseDown,
    };
  },
});
