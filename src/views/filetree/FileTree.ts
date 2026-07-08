import { defineComponent, ref, reactive, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { t } from '../../i18n';
import type { SSHProfile } from '../../types';
import { createLocalFileStrategy } from './strategies';
import type { IFileOperationStrategy, FileEntry } from './strategies/FileOperationStrategy';
import { openFilePreview, closeFilePreview } from './FilePreview';
import { openFileEditor, closeFileEditor } from './FileEditor';
import { showMessage } from '../../composables/useAppMessage';
import { showConfirm } from '../../composables/useAppDialog';
import FileModal from '../../components/modals/FileModal.vue';
import type { FileModalCreatePayload } from '../../components/modals/FileModal';

interface FavoriteItem {
  path: string;
  name: string;
}

interface TreeNode {
  entry: FileEntry;
  children: TreeNode[];
  loaded: boolean;
  expanded: boolean;
}

interface FlattenedNode {
  node: TreeNode;
  depth: number;
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
  components: { FileModal },
  emits: ['open-terminal'],
  setup(_, { emit, expose }) {
    const tree = reactive<{ roots: TreeNode[] }>({ roots: [] });
    const filterText = ref('');
    const sortKey = ref<'name' | 'modified' | 'size'>('name');
    const sortDir = ref<'asc' | 'desc'>('asc');
    const currentPath = ref('');
    const selectedPath = ref('');
    const favorites = ref<FavoriteItem[]>([]);
    const showFavorites = ref(true);
    const previewMode = ref<'preview' | 'edit'>('preview');
    const previewHostRef = ref<HTMLDivElement | null>(null);
    const fileModalOpen = ref(false);
    const fileModalParent = ref('');
    const fileModalMode = ref<'file' | 'folder'>('file');
    const renamingPath = ref('');
    const renamingValue = ref('');
    const contextMenu = ref<ContextMenuState | null>(null);
    const sshProfiles = ref<SSHProfile[]>([]);

    // 当前仅启用本地策略；远程策略保留构造入口以备后续接线
    const strategy: IFileOperationStrategy = createLocalFileStrategy();

    // ===== 国际化标签 =====
    const filterPlaceholder = computed(() => t('file.filterPlaceholder'));
    const favoritesLabel = computed(() => t('file.favorites'));
    const favoritesEmptyLabel = computed(() => t('file.favoritesEmpty'));
    const emptyLabel = computed(() => t('file.noResults'));
    const sortNameLabel = computed(() => t('file.sortName'));
    const sortModifiedLabel = computed(() => t('file.sortModified'));
    const sortSizeLabel = computed(() => t('file.sortSize'));
    const newLabel = computed(() => t('file.newFile'));
    const renameLabel = computed(() => t('file.rename'));
    const deleteLabel = computed(() => t('file.delete'));
    const addFavoriteLabel = computed(() => t('file.addToFavorites'));
    const removeFavoriteLabel = computed(() => t('file.removeFromFavorites'));
    const openInTerminalLabel = computed(() => t('file.openInTerminal'));

    // ===== 工具函数 =====
    function toTreeNode(entry: FileEntry): TreeNode {
      return { entry, children: [], loaded: false, expanded: false };
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

    function flatten(nodes: TreeNode[], depth = 0, acc: FlattenedNode[] = []): FlattenedNode[] {
      for (const node of nodes) {
        acc.push({ node, depth });
        if (node.expanded && node.children.length) {
          flatten(node.children, depth + 1, acc);
        }
      }
      return acc;
    }

    const visibleNodes = computed<FlattenedNode[]>(() => {
      const flattened = flatten(tree.roots);
      if (!filterText.value) return flattened;
      const lower = filterText.value.toLowerCase();
      return flattened.filter((item) => item.node.entry.name.toLowerCase().includes(lower));
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

    const selectedFile = computed<FileEntry | null>(() => {
      if (!selectedPath.value) return null;
      const node = findNode(tree.roots, selectedPath.value);
      if (!node || node.entry.is_dir) return null;
      return node.entry;
    });

    const breadcrumb = computed(() => {
      const path = selectedPath.value || currentPath.value;
      if (!path) return [] as { name: string; path: string; current: boolean }[];
      const parts = path.split('/').filter(Boolean);
      const items: { name: string; path: string; current: boolean }[] = [];
      let acc = '';
      for (let i = 0; i < parts.length; i++) {
        acc = acc + '/' + parts[i];
        items.push({ name: parts[i], path: acc, current: i === parts.length - 1 });
      }
      return items;
    });

    function formatSize(bytes: number): string {
      if (bytes < 1024) return `${bytes}B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
      if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
    }

    function joinPath(parent: string, name: string): string {
      if (!parent) return name;
      return parent.endsWith('/') ? parent + name : parent + '/' + name;
    }

    function parentOf(path: string): string {
      const idx = path.replace(/\/+$/, '').lastIndexOf('/');
      if (idx <= 0) return '/';
      return path.substring(0, idx);
    }

    function baseName(path: string): string {
      const parts = path.split('/').filter(Boolean);
      return parts[parts.length - 1] || path;
    }

    // ===== 收藏夹 =====
    function loadFavorites() {
      const saved = localStorage.getItem(FAVORITES_KEY);
      if (!saved) return;
      try {
        const parsed = JSON.parse(saved) as FavoriteItem[];
        if (Array.isArray(parsed)) favorites.value = parsed;
      } catch {
        /* ignore */
      }
    }

    function persistFavorites() {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites.value));
    }

    function isFavorite(path: string): boolean {
      return favorites.value.some((item) => item.path === path);
    }

    function toggleFavorite(node: TreeNode) {
      if (!node.entry.is_dir) return;
      if (isFavorite(node.entry.path)) {
        favorites.value = favorites.value.filter((item) => item.path !== node.entry.path);
      } else {
        if (favorites.value.length >= MAX_FAVORITES) {
          showMessage(t('file.favoritesFull'), 'warning');
          return;
        }
        favorites.value.push({ path: node.entry.path, name: node.entry.name });
      }
      persistFavorites();
      contextMenu.value = null;
    }

    function removeFavorite(path: string) {
      favorites.value = favorites.value.filter((item) => item.path !== path);
      persistFavorites();
    }

    // ===== 目录加载 =====
    async function loadChildren(node: TreeNode) {
      const entries = await strategy.readDir(node.entry.path);
      node.children = entries.map(toTreeNode);
      node.loaded = true;
      node.expanded = true;
      sortNodes(node.children);
    }

    async function init() {
      try {
        const home = await strategy.getHomePath();
        currentPath.value = home;
        const entries = await strategy.readDir(home);
        tree.roots = entries.map(toTreeNode);
        sortNodes(tree.roots);
        loadFavorites();
      } catch (err) {
        showMessage(`初始化文件树失败: ${err}`, 'error');
      }
    }

    function collectExpanded(nodes: TreeNode[], acc: string[] = []): string[] {
      for (const node of nodes) {
        if (node.expanded) acc.push(node.entry.path);
        if (node.children.length) collectExpanded(node.children, acc);
      }
      return acc;
    }

    async function refreshTree() {
      try {
        const expandedPaths = collectExpanded(tree.roots);
        const entries = await strategy.readDir(currentPath.value);
        tree.roots = entries.map(toTreeNode);
        sortNodes(tree.roots);
        for (const path of expandedPaths) {
          const node = findNode(tree.roots, path);
          if (node && node.entry.is_dir && !node.loaded) {
            await loadChildren(node);
          }
        }
      } catch (err) {
        showMessage(`刷新失败: ${err}`, 'error');
      }
    }

    async function navigateTo(path: string) {
      try {
        currentPath.value = path;
        const entries = await strategy.readDir(path);
        tree.roots = entries.map(toTreeNode);
        sortNodes(tree.roots);
        selectedPath.value = '';
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
        } catch (err) {
          showMessage(`加载目录失败: ${err}`, 'error');
        }
      } else {
        node.expanded = !node.expanded;
      }
    }

    async function onNodeClick(node: TreeNode) {
      selectedPath.value = node.entry.path;
      if (node.entry.is_dir) {
        await toggleNode(node);
      } else {
        // 点击文件时回到预览模式（若此前处于编辑模式）
        previewMode.value = 'preview';
      }
      // 右侧渲染由 watch([selectedPath, previewMode]) 统一触发
    }

    function onNodeContext(event: MouseEvent, node: TreeNode) {
      event.preventDefault();
      event.stopPropagation();
      selectedPath.value = node.entry.path;
      contextMenu.value = { x: event.clientX, y: event.clientY, node };
    }

    // ===== 预览 / 编辑 =====
    async function renderPreview() {
      await nextTick();
      const host = previewHostRef.value;
      const file = selectedFile.value;
      if (!host || !file) return;

      if (previewMode.value === 'edit') {
        closeFilePreview();
        try {
          const data = await strategy.readFilePreview(file.path);
          openFileEditor({
            path: data.path,
            language: data.language,
            content: data.content,
            truncated: data.truncated,
            size: data.size,
            container: host,
            onBack: backToPreview,
          });
        } catch (err) {
          showMessage(`打开编辑器失败: ${err}`, 'error');
          previewMode.value = 'preview';
        }
      } else {
        closeFileEditor();
        await openFilePreview(file.path, '', host);
      }
    }

    function backToPreview() {
      previewMode.value = 'preview';
    }

    async function openEditor() {
      if (!selectedFile.value) return;
      previewMode.value = 'edit';
    }

    async function copyPath() {
      const file = selectedFile.value;
      if (!file) return;
      try {
        await navigator.clipboard.writeText(file.path);
        showMessage('路径已复制', 'success');
      } catch {
        showMessage('复制失败', 'error');
      }
    }

    // 监听选中文件或模式变化，自动重新渲染右侧
    watch([selectedPath, previewMode], () => {
      const file = selectedFile.value;
      if (file) {
        void renderPreview();
      } else {
        // 选中目录或清空时，清理右侧已挂载的预览 / 编辑器实例
        closeFileEditor();
        closeFilePreview();
      }
    });

    // ===== 新建 =====
    function openCreateModal() {
      const node = selectedPath.value ? findNode(tree.roots, selectedPath.value) : null;
      const parent = node && node.entry.is_dir ? node.entry.path : currentPath.value;
      fileModalParent.value = parent;
      fileModalMode.value = 'file';
      fileModalOpen.value = true;
    }

    async function onFileModalCreate(payload: FileModalCreatePayload) {
      const parent = fileModalParent.value || currentPath.value;
      const fullPath = joinPath(parent, payload.name);
      try {
        await strategy.createEntry(fullPath, payload.type === 'folder');
        if (payload.type === 'file' && payload.content) {
          await strategy.writeFile(fullPath, payload.content);
        }
        showMessage(payload.type === 'file' ? '文件已创建' : '文件夹已创建', 'success');
        await refreshTree();
      } catch (err) {
        showMessage(t('file.createFailed', String(err)), 'error');
      }
    }

    // ===== 重命名 =====
    function startRename(node: TreeNode) {
      renamingPath.value = node.entry.path;
      renamingValue.value = node.entry.name;
      contextMenu.value = null;
    }

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
        await strategy.renameEntry(node.entry.path, newPath);
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
        await strategy.deleteEntries([node.entry.path]);
        showMessage('已删除', 'success');
        if (selectedPath.value === node.entry.path) selectedPath.value = '';
        await refreshTree();
      } catch (err) {
        showMessage(t('file.deleteFailed', String(err)), 'error');
      }
    }

    // ===== 在终端中打开 =====
    function openTerminalHere(node: TreeNode) {
      if (node.entry.is_dir) emit('open-terminal', node.entry.path);
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
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    }

    async function onDrop(event: DragEvent, node: TreeNode) {
      event.preventDefault();
      const sourcePath = event.dataTransfer?.getData('text/plain');
      if (!sourcePath || sourcePath === node.entry.path || !node.entry.is_dir) return;
      try {
        const newPath = joinPath(node.entry.path, baseName(sourcePath));
        await strategy.renameEntry(sourcePath, newPath);
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
    });

    onBeforeUnmount(() => {
      document.removeEventListener('click', onGlobalClick);
      document.removeEventListener('keydown', onKeydown, true);
      closeFileEditor();
      closeFilePreview();
    });

    // ===== 对外暴露 =====
    function setSshProfiles(profiles: SSHProfile[]) {
      sshProfiles.value = profiles;
    }

    function syncToTerminal(context: { cwd: string }) {
      if (context.cwd && context.cwd !== currentPath.value) {
        void navigateTo(context.cwd);
      }
    }

    expose({ setSshProfiles, syncToTerminal });

    return {
      // 状态
      filterText, sortKey, sortDir, selectedPath,
      favorites, showFavorites, previewHostRef,
      fileModalOpen, fileModalParent, fileModalMode,
      renamingPath, renamingValue, contextMenu,
      // 计算属性
      filterPlaceholder, favoritesLabel, favoritesEmptyLabel, emptyLabel,
      sortNameLabel, sortModifiedLabel, sortSizeLabel,
      newLabel, renameLabel, deleteLabel, addFavoriteLabel, removeFavoriteLabel, openInTerminalLabel,
      visibleNodes, selectedFile, breadcrumb,
      // 方法
      formatSize, isFavorite, toggleFavorite, removeFavorite, navigateTo,
      onNodeClick, onNodeContext, toggleNode,
      openEditor, copyPath,
      openCreateModal, onFileModalCreate,
      startRename, commitRename, cancelRename,
      deleteNode, openTerminalHere,
      onDragStart, onDragOver, onDrop,
      refreshTree,
    };
  },
});
