/**
 * FileManager — Windows 风格资源管理器主组件
 *
 * 布局：工具栏（导航+地址栏+搜索）+ 侧栏（快速访问+磁盘容量）+
 *       4 列列表视图（名称/修改时间/类型/大小）+ 状态栏。
 *
 * 功能：面包屑导航、双击进入、右键菜单、Ctrl+C/V/X/Z/Y/A 快捷键、
 *       拖拽移动、外部拖入、全局搜索、磁盘容量条、列排序、撤销/重做。
 *
 * 设计：Craft 主题，参考 demo/console/console.css 模板。
 */
import { defineComponent, ref, reactive, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import * as svc from './fileManagerService';
import type { FileEntry, FileSearchResult, IndexStatus, DiskInfo, ContentSearchResult, QuickAccessLocation } from './fileManagerService';
import { undoStack, type FileOperation } from './UndoStack';
import { fileClipboard } from './ClipboardManager';
import { showMessage } from '../../composables/useAppMessage';
import { showConfirm } from '../../composables/useAppDialog';
import { t, onLangChange } from '../../i18n';
import FileTypeIcon from './FileTypeIcon';
import IndexSettingsPanel from './IndexSettingsPanel.vue';

export default defineComponent({
  name: 'FileManager',
  components: {
    FileTypeIcon,
    IndexSettingsPanel,
  },
  directives: {
    focus: {
      mounted(el: HTMLInputElement) {
        el.focus();
        el.select();
      },
    },
  },
  setup() {
    // === 导航状态 ===
    const currentPath = ref('');
    const history = ref<string[]>([]);
    const historyIndex = ref(-1);
    const entries = ref<FileEntry[]>([]);
    const loading = ref(true);
    const focused = ref(false);

    const canGoBack = computed(() => historyIndex.value > 0);
    const canGoForward = computed(() => historyIndex.value < history.value.length - 1);
    const canGoUp = computed(() => {
      if (!currentPath.value) return false;
      const sep = currentPath.value.includes('\\') ? '\\' : '/';
      const parts = currentPath.value.split(sep).filter(Boolean);
      return parts.length > 1;
    });

    // === 选择状态 ===
    const selectedPaths = ref<Set<string>>(new Set());
    const lastClickedPath = ref<string | null>(null);

    const selectedArray = computed(() => Array.from(selectedPaths.value));

    // === 搜索状态 ===
    // searchActive 现在由 searchQuery 派生：搜索框常驻工具栏，输入即进入搜索模式。
    const searchQuery = ref('');
    const searchResults = ref<FileSearchResult[]>([]);
    const searchLoading = ref(false);
    const searchLimited = ref(false);
    let searchTimer: ReturnType<typeof setTimeout> | null = null;
    let activeSearchId = '';
    let searchSequence = 0;

    // 内容搜索状态
    const searchMode = ref<'filename' | 'content'>('filename');
    const contentResults = ref<ContentSearchResult[]>([]);
    const contentLoading = ref(false);
    const contentLimited = ref(false);
    let contentTimer: ReturnType<typeof setTimeout> | null = null;

    const searchActive = computed(() => searchQuery.value.trim().length > 0);

    // === i18n 响应式 ===
    // 触发依赖 t() 的计算属性（displayEntries 的 type 列、fileTypeLabel 等）在语言切换时重算。
    const langTick = ref(0);
    let unsubLang: (() => void) | null = null;

    // === 排序状态 ===
    const SORT_KEY_STORAGE = 'easy_terminal_fm_sort_key';
    const SORT_DIR_STORAGE = 'easy_terminal_fm_sort_dir';
    const sortKey = ref<'name' | 'date' | 'type' | 'size'>(
      (localStorage.getItem(SORT_KEY_STORAGE) as 'name' | 'date' | 'type' | 'size') || 'name',
    );
    const sortDir = ref<'asc' | 'desc'>((localStorage.getItem(SORT_DIR_STORAGE) as 'asc' | 'desc') || 'asc');

    function setSort(key: typeof sortKey.value) {
      if (sortKey.value === key) {
        sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
      } else {
        sortKey.value = key;
        sortDir.value = 'asc';
      }
      localStorage.setItem(SORT_KEY_STORAGE, sortKey.value);
      localStorage.setItem(SORT_DIR_STORAGE, sortDir.value);
    }

    // === 磁盘状态 ===
    const disks = ref<DiskInfo[]>([]);
    const quickAccessLocations = ref<QuickAccessLocation[]>([]);
    const disksRefreshing = ref(false);

    function normalizeDiskPath(path: string): string {
      const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
      return normalized || '/';
    }

    function isDiskMountForPath(mountPoint: string, path: string): boolean {
      const mount = normalizeDiskPath(mountPoint).toLowerCase();
      const current = normalizeDiskPath(path).toLowerCase();
      return mount === '/' || current === mount || current.startsWith(`${mount}/`);
    }

    const currentDisk = computed<DiskInfo | null>(() => {
      if (!currentPath.value) return null;
      return disks.value
        .filter((disk) => isDiskMountForPath(disk.mount_point, currentPath.value))
        .sort((left, right) => normalizeDiskPath(right.mount_point).length - normalizeDiskPath(left.mount_point).length)[0] || null;
    });

    const totalCapacity = computed(() => disks.value.reduce((sum, disk) => sum + disk.total, 0));
    const totalAvailable = computed(() => disks.value.reduce((sum, disk) => sum + disk.available, 0));
    const totalPercent = computed(() =>
      totalCapacity.value > 0 ? Math.round(((totalCapacity.value - totalAvailable.value) / totalCapacity.value) * 100) : 0,
    );

    const quickAccess = computed(() => quickAccessLocations.value.map((location) => ({
      ...location,
      label: t(`filemanager.quick.${location.id}`),
      icon: location.id === 'downloads'
        ? 'download'
        : location.id === 'documents'
          ? 'document'
          : location.id === 'pictures'
            ? 'picture'
            : location.id,
    })));

    const trashQuickAccess = computed(() => ({
      label: t('filemanager.quick.trash'),
      icon: 'trash',
    }));

    // === 文件夹大小缓存（渐进式后台计算） ===
    // path -> { size, mtime }；命中且 mtime 未变则直接复用，无需重新递归
    const folderSizeCache = ref<Map<string, { size: number; mtime: number }>>(new Map());
    // 正在计算中的路径集合，用于显示「计算中…」
    const folderSizePending = ref<Set<string>>(new Set());
    // 当前文件夹大小请求 id（非响应式）；切换目录时用于取消上一个请求
    let currentSizeRequestId: string | null = null;

    // === 显示条目（应用排序：目录优先，再按当前列排序） ===
    const displayEntries = computed(() => {
      void langTick.value; // i18n 响应性：type 列排序依赖 fileTypeLabel -> t()
      void folderSizeCache.value; // 响应性：文件夹大小更新后触发重排
      void folderSizePending.value;
      let list: FileEntry[];
      if (searchMode.value === 'filename' && searchActive.value && searchQuery.value) {
        list = searchResults.value.map((r) => ({
          name: r.name,
          path: r.path,
          is_dir: r.is_dir,
          size: r.size,
          modified: r.modified,
          icon: guessIcon(r.name, r.is_dir),
        }));
      } else {
        list = entries.value;
      }
      const dirs = list.filter((e) => e.is_dir);
      const files = list.filter((e) => !e.is_dir);
      const cmp = (a: FileEntry, b: FileEntry) => {
        let r = 0;
        if (sortKey.value === 'name') r = a.name.localeCompare(b.name);
        else if (sortKey.value === 'size') r = effectiveSize(a) - effectiveSize(b);
        else if (sortKey.value === 'date') r = a.modified - b.modified;
        else if (sortKey.value === 'type') r = fileTypeLabel(a).localeCompare(fileTypeLabel(b));
        return sortDir.value === 'asc' ? r : -r;
      };
      dirs.sort(cmp);
      files.sort(cmp);
      return [...dirs, ...files];
    });

    /** 条目的有效大小：文件取自身 size，文件夹取缓存大小（未算出则为 0） */
    function effectiveSize(e: FileEntry): number {
      if (!e.is_dir) return e.size;
      return folderSizeCache.value.get(e.path)?.size ?? 0;
    }

    const selectedSize = computed(() =>
      displayEntries.value
        .filter((e) => selectedPaths.value.has(e.path))
        .reduce((s, e) => s + effectiveSize(e), 0),
    );

    const dirCount = computed(() => entries.value.filter((e) => e.is_dir).length);
    const fileCount = computed(() => entries.value.filter((e) => !e.is_dir).length);

    // === 索引状态 ===
    const indexStatus = ref<IndexStatus>({
      indexing: false,
      totalFiles: 0,
      lastScan: 0,
      currentPath: '',
      estimatedTotal: 0,
      progress: 0,
    });
    let unlistenProgress: UnlistenFn | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    // === 索引设置面板 ===
    const indexSettingsVisible = ref(false);
    function openIndexSettings() {
      indexSettingsVisible.value = true;
    }

    // === 右键菜单 ===
    const contextMenu = reactive({
      visible: false,
      x: 0,
      y: 0,
      targetPath: null as string | null,
      targetEntry: null as FileEntry | null,
      isBlank: false,
    });

    // === 重命名 ===
    const renamingPath = ref<string | null>(null);
    const renamingText = ref('');

    // === 新建 ===
    const creating = reactive({
      active: false,
      type: 'file' as 'file' | 'folder',
      text: '',
    });

    // === 拖拽状态 ===
    const dragState = reactive({
      draggingPaths: [] as string[],
      dropTargetPath: null as string | null,
      externalDragging: false,
    });

    // === Toast (撤销提示) ===
    const toast = reactive({
      visible: false,
      text: '',
    });
    let toastTimer: ReturnType<typeof setTimeout> | null = null;

    // === 剪贴板响应式 ===
    const clipboardVersion = ref(0);
    const undoVersion = ref(0);

    const clipboardEmpty = computed(() => {
      void clipboardVersion.value;
      return fileClipboard.isEmpty;
    });
    const undoEmpty = computed(() => {
      void undoVersion.value;
      return !undoStack.canUndo;
    });

    // ========== 导航 ==========

    async function navigateTo(path: string, pushHistory = true) {
      if (!path) return;
      if (searchActive.value) clearSearch();
      loading.value = true;
      try {
        const result = await svc.readDir(path);
        entries.value = result;
        currentPath.value = path;
        selectedPaths.value.clear();
        if (pushHistory) {
          history.value = history.value.slice(0, historyIndex.value + 1);
          history.value.push(path);
          historyIndex.value = history.value.length - 1;
        }
        // 后台渐进式计算各子文件夹大小（不阻塞列表展示）
        requestFolderSizes(result);
      } catch (e) {
        showMessage(t('filemanager.err.openDir', String(e)), 'error');
      } finally {
        loading.value = false;
      }
    }

    function goBack() {
      if (!canGoBack.value) return;
      historyIndex.value--;
      navigateTo(history.value[historyIndex.value], false);
    }

    function goForward() {
      if (!canGoForward.value) return;
      historyIndex.value++;
      navigateTo(history.value[historyIndex.value], false);
    }

    function goUp() {
      if (!canGoUp.value) return;
      const sep = currentPath.value.includes('\\') ? '\\' : '/';
      const parts = currentPath.value.split(sep);
      parts.pop();
      let parent = parts.join(sep);
      if (!parent) parent = sep;
      navigateTo(parent);
    }

    async function refresh() {
      if (currentPath.value) {
        await navigateTo(currentPath.value, false);
      }
    }

    // ========== 双击/打开 ==========

    function onNodeDblClick(entry: FileEntry) {
      if (entry.is_dir) {
        navigateTo(entry.path);
      } else {
        openFile(entry);
      }
    }

    function openFile(entry: FileEntry) {
      if (svc.shouldOpenExternally(entry.icon)) {
        // 特定二进制类型调用系统程序打开
        svc.openWithDefaultApp(entry.path).catch((e) => {
          showMessage(t('filemanager.err.openFile', String(e)), 'error');
        });
      } else {
        // 其余所有文件一律用当前软件预览
        window.dispatchEvent(new CustomEvent('fm-open-preview', { detail: entry.path }));
      }
    }

    // ========== 选择 ==========

    function onNodeClick(entry: FileEntry, event: MouseEvent) {
      // 阻止冒泡到 .fm-files-list 的 onBlankClick，否则选择会被立即清除
      event.stopPropagation();
      // 右键菜单打开时，点击其他条目应关闭菜单（stopPropagation 会阻止 document click）
      if (contextMenu.visible) closeContextMenu();
      if (renamingPath.value === entry.path) return;

      if (event.ctrlKey || event.metaKey) {
        // Ctrl+click: toggle
        if (selectedPaths.value.has(entry.path)) {
          selectedPaths.value.delete(entry.path);
        } else {
          selectedPaths.value.add(entry.path);
        }
        selectedPaths.value = new Set(selectedPaths.value);
      } else if (event.shiftKey && lastClickedPath.value) {
        // Shift+click: range select
        const list = displayEntries.value;
        const startIdx = list.findIndex((e) => e.path === lastClickedPath.value);
        const endIdx = list.findIndex((e) => e.path === entry.path);
        if (startIdx >= 0 && endIdx >= 0) {
          const from = Math.min(startIdx, endIdx);
          const to = Math.max(startIdx, endIdx);
          for (let i = from; i <= to; i++) {
            selectedPaths.value.add(list[i].path);
          }
          selectedPaths.value = new Set(selectedPaths.value);
        }
      } else {
        // 单击
        selectedPaths.value.clear();
        selectedPaths.value.add(entry.path);
        selectedPaths.value = new Set(selectedPaths.value);
      }
      lastClickedPath.value = entry.path;
    }

    function selectAll() {
      selectedPaths.value = new Set(displayEntries.value.map((e) => e.path));
    }

    function clearSelection() {
      selectedPaths.value.clear();
      selectedPaths.value = new Set(selectedPaths.value);
    }

    function onBlankClick() {
      clearSelection();
      if (contextMenu.visible) closeContextMenu();
    }

    // ========== 右键菜单 ==========

    function onNodeContext(entry: FileEntry, event: MouseEvent) {
      event.preventDefault();
      event.stopPropagation();
      if (!selectedPaths.value.has(entry.path)) {
        selectedPaths.value.clear();
        selectedPaths.value.add(entry.path);
        selectedPaths.value = new Set(selectedPaths.value);
      }
      contextMenu.visible = true;
      contextMenu.x = event.clientX;
      contextMenu.y = event.clientY;
      contextMenu.targetPath = entry.path;
      contextMenu.targetEntry = entry;
      contextMenu.isBlank = false;
    }

    function onBlankContext(event: MouseEvent) {
      event.preventDefault();
      contextMenu.visible = true;
      contextMenu.x = event.clientX;
      contextMenu.y = event.clientY;
      contextMenu.targetPath = null;
      contextMenu.isBlank = true;
    }

    function closeContextMenu() {
      contextMenu.visible = false;
    }

    // 右键菜单「打开」：目录→进入，文件→预览或系统打开
    function onContextOpen() {
      const entry = contextMenu.targetEntry;
      if (!entry) return;
      if (entry.is_dir) {
        navigateTo(entry.path);
      } else {
        openFile(entry);
      }
    }

    // ========== 文件操作 ==========

    async function copySelection() {
      if (selectedArray.value.length === 0) return;
      fileClipboard.copy(selectedArray.value);
      showMessage(t('filemanager.toast.copied', String(selectedArray.value.length)), 'info', 2000);
    }

    async function cutSelection() {
      if (selectedArray.value.length === 0) return;
      fileClipboard.cut(selectedArray.value);
      showMessage(t('filemanager.toast.cut', String(selectedArray.value.length)), 'info', 2000);
    }

    async function paste() {
      const { paths, mode } = fileClipboard.consume();
      if (paths.length === 0 || !mode) return;
      try {
        if (mode === 'copy') {
          await svc.copyEntries(paths, currentPath.value);
          const sources = [...paths];
          const dests = paths.map((p) => joinPath(currentPath.value, basename(p)));
          const op: FileOperation = {
            type: 'copy',
            sources,
            destinations: dests,
            label: t('filemanager.toast.copied', String(paths.length)),
            undo: async () => {
              await svc.deleteEntries(dests);
            },
          };
          undoStack.push(op);
          showToast(t('filemanager.toast.pasted', String(paths.length)));
        } else {
          await svc.moveEntries(paths, currentPath.value);
          const dests = paths.map((p) => joinPath(currentPath.value, basename(p)));
          const op: FileOperation = {
            type: 'move',
            sources: [...paths],
            destinations: dests,
            label: t('filemanager.toast.moved', String(paths.length)),
            undo: async () => {
              const parents = paths.map((p) => dirname(p));
              for (let i = 0; i < dests.length; i++) {
                await svc.moveEntries([dests[i]], parents[i]);
              }
            },
          };
          undoStack.push(op);
          showToast(t('filemanager.toast.moved', String(paths.length)));
        }
        await refresh();
      } catch (e) {
        showMessage(t('filemanager.err.paste', String(e)), 'error');
      }
    }

    async function deleteSelection() {
      if (selectedArray.value.length === 0) return;
      const count = selectedArray.value.length;
      const confirmed = await showConfirm({
        content: t('filemanager.dialog.deleteContent', String(count)),
        title: t('filemanager.dialog.deleteTitle'),
        danger: true,
      });
      if (!confirmed) return;
      try {
        await svc.trashEntries(selectedArray.value);
        const sources = [...selectedArray.value];
        const op: FileOperation = {
          type: 'delete',
          sources,
          destinations: [],
          label: t('filemanager.toast.trashed', String(count)),
          // 删除操作依赖系统回收站，撤销提示用户手动恢复
          undo: async () => {
            showMessage(t('filemanager.msg.pathCopied'), 'warning', 6000);
          },
        };
        undoStack.push(op);
        showToast(t('filemanager.toast.trashed', String(count)));
        await refresh();
      } catch (e) {
        showMessage(t('filemanager.err.delete', String(e)), 'error');
      }
    }

    async function renameNode(path: string) {
      renamingPath.value = path;
      renamingText.value = basename(path);
      await nextTick();
    }

    async function commitRename() {
      if (!renamingPath.value) return;
      const oldPath = renamingPath.value;
      const newName = renamingText.value.trim();
      if (!newName || newName === basename(oldPath)) {
        renamingPath.value = null;
        return;
      }
      const newPath = joinPath(dirname(oldPath), newName);
      try {
        await svc.renameEntry(oldPath, newPath);
        const op: FileOperation = {
          type: 'rename',
          sources: [oldPath],
          destinations: [newPath],
          label: `${basename(oldPath)} → ${newName}`,
          undo: async () => {
            await svc.renameEntry(newPath, oldPath);
          },
        };
        undoStack.push(op);
        renamingPath.value = null;
        await refresh();
      } catch (e) {
        showMessage(t('filemanager.err.rename', String(e)), 'error');
      }
    }

    function cancelRename() {
      renamingPath.value = null;
    }

    async function copyAbsolutePath() {
      const paths = contextMenu.targetPath ? [contextMenu.targetPath] : selectedArray.value;
      if (paths.length === 0) return;
      try {
        await navigator.clipboard.writeText(paths.join('\n'));
        showMessage(t('filemanager.msg.pathCopied'), 'success', 2000);
      } catch {
        /* ignore */
      }
    }

    async function openWithSystem() {
      const path = contextMenu.targetPath ?? selectedArray.value[0];
      if (!path) return;
      await svc.openWithDefaultApp(path);
    }

    async function revealInFM() {
      const path = contextMenu.targetPath ?? selectedArray.value[0];
      if (!path) return;
      await svc.revealInFileManager(path);
    }

    function startCreate(type: 'file' | 'folder') {
      creating.active = true;
      creating.type = type;
      creating.text = '';
      closeContextMenu();
    }

    async function commitCreate() {
      if (!creating.active) return;
      const name = creating.text.trim();
      if (!name) {
        creating.active = false;
        return;
      }
      const newPath = joinPath(currentPath.value, name);
      try {
        if (creating.type === 'file') {
          await svc.createFile(newPath);
        } else {
          await svc.createDir(newPath);
        }
        const op: FileOperation = {
          type: 'create',
          sources: [],
          destinations: [newPath],
          label:
            creating.type === 'file'
              ? `${t('filemanager.ctx.newFile')} ${name}`
              : `${t('filemanager.ctx.newFolder')} ${name}`,
          undo: async () => {
            await svc.deleteEntries([newPath]);
          },
        };
        undoStack.push(op);
        creating.active = false;
        await refresh();
      } catch (e) {
        showMessage(t('filemanager.err.create', String(e)), 'error');
        creating.active = false;
      }
    }

    function cancelCreate() {
      creating.active = false;
    }

    // ========== 撤销/重做 ==========

    async function undo() {
      const label = await undoStack.undo();
      if (label) {
        showToast(t('filemanager.toast.undone', label));
        await refresh();
      }
    }

    async function redo() {
      const label = await undoStack.redo();
      if (label) {
        showToast(t('filemanager.toast.redone', label));
        await refresh();
      }
    }

    // ========== 搜索 ==========

    function cancelActiveSearch() {
      if (activeSearchId) {
        void svc.cancelFileSearch(activeSearchId);
        activeSearchId = '';
      }
    }

    function resetSearchResults() {
      cancelActiveSearch();
      searchResults.value = [];
      contentResults.value = [];
      searchLimited.value = false;
      contentLimited.value = false;
      searchLoading.value = false;
      contentLoading.value = false;
    }

    function nextSearchId() {
      searchSequence += 1;
      return `file-search-${Date.now()}-${searchSequence}`;
    }

    function onSearchInput() {
      if (searchTimer) clearTimeout(searchTimer);
      if (contentTimer) clearTimeout(contentTimer);
      resetSearchResults();

      if (!searchQuery.value.trim()) return;

      const mode = searchMode.value;
      const timer = setTimeout(() => {
        const query = searchQuery.value.trim();
        if (!query || mode !== searchMode.value) return;

        const searchId = nextSearchId();
        activeSearchId = searchId;
        if (mode === 'filename') {
          searchLoading.value = true;
          void svc.searchFilesStream(query, searchId, (event) => {
            if (event.searchId !== activeSearchId) return;
            if (event.kind === 'batch') {
              const knownPaths = new Set(searchResults.value.map((result) => result.path));
              searchResults.value.push(...event.results.filter((result) => !knownPaths.has(result.path)));
              return;
            }
            searchLoading.value = false;
            searchLimited.value = event.limited;
            activeSearchId = '';
          }).catch((error) => {
            if (searchId === activeSearchId) {
              searchLoading.value = false;
              activeSearchId = '';
              showMessage(`${t('filemanager.search.failed')}: ${String(error)}`, 'error');
            }
          });
          return;
        }

        contentLoading.value = true;
        void svc.searchContentStream(query, currentPath.value, searchId, (event) => {
          if (event.searchId !== activeSearchId) return;
          if (event.kind === 'batch') {
            const knownPaths = new Set(contentResults.value.map((result) => result.path));
            contentResults.value.push(...event.results.filter((result) => !knownPaths.has(result.path)));
            return;
          }
          contentLoading.value = false;
          contentLimited.value = event.limited;
          activeSearchId = '';
        }).catch((error) => {
          if (searchId === activeSearchId) {
            contentLoading.value = false;
            activeSearchId = '';
            showMessage(`${t('filemanager.search.failed')}: ${String(error)}`, 'error');
          }
        });
      }, mode === 'filename' ? 300 : 500);

      if (mode === 'filename') searchTimer = timer;
      else contentTimer = timer;
    }

    function clearSearch() {
      if (searchTimer) clearTimeout(searchTimer);
      if (contentTimer) clearTimeout(contentTimer);
      searchQuery.value = '';
      resetSearchResults();
    }

    function toggleSearchMode() {
      searchMode.value = searchMode.value === 'filename' ? 'content' : 'filename';
      clearSearch();
    }

    /** 将匹配行文本按 matchStart/matchEnd 分割为三段，用于高亮渲染 */
    function splitMatchLine(lineText: string, matchStart: number, matchEnd: number) {
      if (matchStart >= matchEnd || matchEnd > lineText.length) {
        return { before: lineText, match: '', after: '' };
      }
      return {
        before: lineText.slice(0, matchStart),
        match: lineText.slice(matchStart, matchEnd),
        after: lineText.slice(matchEnd),
      };
    }

    /** 内容搜索结果适配：构造 FileEntry 后调用 openFile */
    function openContentFile(filePath: string) {
      const sep = filePath.includes('\\') ? '\\' : '/';
      const name = filePath.split(sep).pop() || filePath;
      openFile({ name, path: filePath, is_dir: false, size: 0, modified: 0, icon: guessIcon(name, false) });
    }

    async function refreshIndexStatus() {
      try {
        indexStatus.value = await svc.getIndexStatus();
      } catch {
        /* ignore */
      }
    }

    async function refreshDisks() {
      if (disksRefreshing.value) return;
      disksRefreshing.value = true;
      try {
        disks.value = await svc.listDisks();
        showToast(t('filemanager.disk.refreshSuccess'));
      } catch (error) {
        showMessage(`${t('filemanager.disk.refreshFailed')}: ${String(error)}`, 'error');
      } finally {
        disksRefreshing.value = false;
      }
    }

    async function openSystemTrash() {
      try {
        await svc.openSystemTrash();
      } catch (error) {
        showMessage(`${t('filemanager.trash.openFailed')}: ${String(error)}`, 'error');
      }
    }

    // ========== 拖拽 ==========

    function onDragStart(entry: FileEntry, event: DragEvent) {
      const paths = selectedPaths.value.has(entry.path) ? selectedArray.value : [entry.path];
      dragState.draggingPaths = paths;
      event.dataTransfer?.setData('text/plain', JSON.stringify(paths));
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
      }
    }

    function onDragOverTarget(entry: FileEntry, event: DragEvent) {
      if (!entry.is_dir) return;
      if (dragState.draggingPaths.includes(entry.path)) return;
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
      dragState.dropTargetPath = entry.path;
    }

    function onDragLeaveTarget() {
      dragState.dropTargetPath = null;
    }

    async function onDropOnTarget(entry: FileEntry, event: DragEvent) {
      event.preventDefault();
      event.stopPropagation();
      dragState.dropTargetPath = null;
      const paths = dragState.draggingPaths;
      if (paths.length === 0 || !entry.is_dir) return;
      if (paths.includes(entry.path)) return;
      try {
        await svc.moveEntries(paths, entry.path);
        const dests = paths.map((p) => joinPath(entry.path, basename(p)));
        const op: FileOperation = {
          type: 'move',
          sources: [...paths],
          destinations: dests,
          label: t('filemanager.toast.moved', String(paths.length)),
          undo: async () => {
            const parents = paths.map((p) => dirname(p));
            for (let i = 0; i < dests.length; i++) {
              await svc.moveEntries([dests[i]], parents[i]);
            }
          },
        };
        undoStack.push(op);
        await refresh();
      } catch (e) {
        showMessage(t('filemanager.err.move', String(e)), 'error');
      }
      dragState.draggingPaths = [];
    }

    function onDragEnd() {
      dragState.draggingPaths = [];
      dragState.dropTargetPath = null;
    }

    // 外部拖入
    async function onExternalDrop(event: DragEvent) {
      event.preventDefault();
      dragState.externalDragging = false;
      const files = event.dataTransfer?.files;
      if (!files || files.length === 0) return;
      const paths: string[] = [];
      for (let i = 0; i < files.length; i++) {
        // Tauri webview: File 对象可能带有 path 属性
        const f = files[i] as unknown as { path?: string; name?: string };
        if (f.path) paths.push(f.path);
      }
      if (paths.length === 0) return;
      try {
        await svc.moveEntries(paths, currentPath.value);
        showToast(t('filemanager.toast.moved', String(paths.length)));
        await refresh();
      } catch (e) {
        showMessage(t('filemanager.err.drop', String(e)), 'error');
      }
    }

    // ========== Toast ==========

    function showToast(text: string) {
      toast.text = text;
      toast.visible = true;
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toast.visible = false;
      }, 3000);
    }

    // ========== 快捷键 ==========

    function onKeydown(event: KeyboardEvent) {
      if (!focused.value) return;
      const mod = event.ctrlKey || event.metaKey;

      // 当焦点在输入框（搜索框/重命名/新建）时，除 Cmd+Shift+F 外的快捷键
      // 都放行给浏览器原生处理，避免拦截 Backspace、Cmd+A 等编辑操作
      const eventTarget = event.target;
      const isEditingText =
        eventTarget instanceof HTMLInputElement ||
        eventTarget instanceof HTMLTextAreaElement ||
        (eventTarget instanceof HTMLElement && eventTarget.isContentEditable);

      // Cmd/Ctrl+Shift+F 切换搜索模式（即使在输入框中也生效）
      if (mod && event.shiftKey && (event.key === 'f' || event.key === 'F')) {
        event.preventDefault();
        toggleSearchMode();
        return;
      }

      // 输入框聚焦时，其余快捷键不拦截
      if (isEditingText) return;

      // Ctrl+C
      if (mod && event.key === 'c' && !event.shiftKey) {
        event.preventDefault();
        copySelection();
        return;
      }
      // Ctrl+X
      if (mod && event.key === 'x' && !event.shiftKey) {
        event.preventDefault();
        cutSelection();
        return;
      }
      // Ctrl+V
      if (mod && event.key === 'v' && !event.shiftKey) {
        event.preventDefault();
        paste();
        return;
      }
      // Ctrl+Z
      if (mod && event.key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }
      // Ctrl+Shift+Z 或 Ctrl+Y = redo
      if ((mod && event.key === 'z' && event.shiftKey) || (mod && event.key === 'y')) {
        event.preventDefault();
        redo();
        return;
      }
      // Ctrl+A
      if (mod && event.key === 'a') {
        event.preventDefault();
        selectAll();
        return;
      }
      // Delete
      if (event.key === 'Delete') {
        event.preventDefault();
        deleteSelection();
        return;
      }
      // F2 重命名
      if (event.key === 'F2') {
        event.preventDefault();
        if (selectedArray.value.length === 1) {
          renameNode(selectedArray.value[0]);
        }
        return;
      }
      // Enter 打开
      if (event.key === 'Enter') {
        event.preventDefault();
        if (selectedArray.value.length === 1) {
          const entry = displayEntries.value.find((e) => e.path === selectedArray.value[0]);
          if (entry) onNodeDblClick(entry);
        }
        return;
      }
      // Backspace = 上一级
      if (event.key === 'Backspace' && !renamingPath.value && !creating.active) {
        event.preventDefault();
        goUp();
        return;
      }
      // Alt+Left / Alt+Right
      if (event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault();
        goBack();
        return;
      }
      if (event.altKey && event.key === 'ArrowRight') {
        event.preventDefault();
        goForward();
        return;
      }
      // Escape
      if (event.key === 'Escape') {
        if (renamingPath.value) {
          cancelRename();
          return;
        }
        if (creating.active) {
          cancelCreate();
          return;
        }
        if (contextMenu.visible) {
          closeContextMenu();
          return;
        }
        clearSelection();
        return;
      }
    }

    function onDocClick() {
      if (contextMenu.visible) closeContextMenu();
    }

    // ========== 生命周期 ==========

    onMounted(async () => {
      // i18n 语言切换响应
      unsubLang = onLangChange(() => {
        langTick.value++;
      });

      // 剪贴板 / 撤销栈订阅
      fileClipboard.subscribe(() => {
        clipboardVersion.value++;
      });
      undoStack.subscribe(() => {
        undoVersion.value++;
      });

      // 监听 Tauri index-progress 事件
      try {
        unlistenProgress = await listen<{
          totalFiles: number;
          estimatedTotal: number;
          currentPath: string;
          progress: number;
        }>('index-progress', (e) => {
          indexStatus.value = {
            indexing: true,
            totalFiles: e.payload.totalFiles,
            estimatedTotal: e.payload.estimatedTotal,
            currentPath: e.payload.currentPath,
            progress: e.payload.progress,
            lastScan: indexStatus.value.lastScan,
          };
        });
      } catch {
        /* ignore */
      }

      // 索引状态轮询（仅索引进行中时每 3 秒刷新，完成后停止）
      const startPolling = () => {
        if (pollTimer) return;
        pollTimer = setInterval(async () => {
          await refreshIndexStatus();
          if (!indexStatus.value.indexing && pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
        }, 3000);
      };
      await refreshIndexStatus();
      if (indexStatus.value.indexing) startPolling();

      // 加载磁盘列表与快速访问目录
      try {
        const [loadedDisks, locations] = await Promise.all([
          svc.listDisks(),
          svc.getQuickAccessLocations(),
        ]);
        disks.value = loadedDisks;
        quickAccessLocations.value = locations;
      } catch (e) {
        console.error('[FileManager] Failed to load file manager locations:', e);
      }

      // 初始化：打开用户主目录
      try {
        const home = await svc.getHomeDir();
        await navigateTo(home);
      } catch (err) {
        console.error('[FileManager] init failed:', err);
        // 兜底：尝试常见路径
        try {
          await navigateTo('~');
        } catch {
          // 最后兜底：确保 loading 关闭，显示空状态
          loading.value = false;
        }
      }

      window.addEventListener('keydown', onKeydown);
      document.addEventListener('click', onDocClick);
    });

    onBeforeUnmount(() => {
      window.removeEventListener('keydown', onKeydown);
      document.removeEventListener('click', onDocClick);
      if (unlistenProgress) unlistenProgress();
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (unsubLang) {
        unsubLang();
        unsubLang = null;
      }
      cancelActiveSearch();
      if (searchTimer) clearTimeout(searchTimer);
      if (contentTimer) clearTimeout(contentTimer);
    });

    // ========== 工具函数 ==========

    function basename(path: string): string {
      const sep = path.includes('\\') ? '\\' : '/';
      const parts = path.split(sep).filter(Boolean);
      return parts[parts.length - 1] || path;
    }

    function dirname(path: string): string {
      const sep = path.includes('\\') ? '\\' : '/';
      const parts = path.split(sep);
      parts.pop();
      let parent = parts.join(sep);
      if (!parent) parent = sep;
      return parent;
    }

    function joinPath(dir: string, name: string): string {
      const sep = dir.includes('\\') ? '\\' : '/';
      if (dir.endsWith(sep)) return dir + name;
      return dir + sep + name;
    }

    function guessIcon(name: string, isDir: boolean): string {
      if (isDir) return 'folder';
      const ext = name.split('.').pop()?.toLowerCase() || '';
      const map: Record<string, string> = {
        ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
        rs: 'rust', py: 'python', css: 'css', html: 'html', json: 'json', md: 'markdown',
        toml: 'config', yaml: 'config', yml: 'config',
        png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', svg: 'image', webp: 'image',
        mp4: 'video', webm: 'video', mov: 'video',
        zip: 'archive', tar: 'archive', gz: 'archive',
        doc: 'word', docx: 'word', xls: 'excel', xlsx: 'excel', ppt: 'ppt', pptx: 'ppt',
        pdf: 'pdf', exe: 'executable',
      };
      return map[ext] || 'file';
    }

    function formatSize(bytes: number): string {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
      if (bytes < 1024 * 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
      return `${(bytes / 1024 / 1024 / 1024 / 1024).toFixed(2)} TB`;
    }

    // === 文件夹大小：后台渐进式计算编排 ===

    /**
     * 对列表中的子文件夹发起后台大小计算。
     * - 跳过缓存命中（mtime 未变）的文件夹。
     * - 切换目录时先取消上一个未完成的请求，避免浪费 CPU。
     * - 每算完一个文件夹即通过 Channel 推送，前端渐进式填充。
     */
    function requestFolderSizes(list: FileEntry[]) {
      // 取所有目录条目，过滤掉缓存命中（mtime 未变）的
      const toCompute = list.filter((e) => {
        if (!e.is_dir) return false;
        const cached = folderSizeCache.value.get(e.path);
        return !cached || cached.mtime !== e.modified;
      });
      if (toCompute.length === 0) return;

      // 取消上一个未完成的请求
      if (currentSizeRequestId) {
        svc.cancelFileSearch(currentSizeRequestId).catch(() => {});
      }
      // 清理上一个请求遗留的 pending（未推送结果的目录）
      if (folderSizePending.value.size > 0) {
        folderSizePending.value = new Set();
      }

      const requestId = (crypto.randomUUID?.() ?? `fs-${Date.now()}-${Math.random()}`);
      currentSizeRequestId = requestId;

      // 记录待算目录的 path -> mtime（收到结果时写入缓存）
      const mtimeMap = new Map<string, number>();
      const pending = new Set<string>();
      for (const e of toCompute) {
        pending.add(e.path);
        mtimeMap.set(e.path, e.modified);
      }
      folderSizePending.value = pending;

      const paths = toCompute.map((e) => e.path);
      svc
        .computeFolderSizesStream(paths, requestId, (ev) => {
          // 仅处理当前请求的事件（切换目录后旧请求的事件忽略）
          if (ev.requestId !== currentSizeRequestId) return;
          if (ev.kind === 'size') {
            const mtime = mtimeMap.get(ev.path) ?? 0;
            const next = new Map(folderSizeCache.value);
            next.set(ev.path, { size: ev.size, mtime });
            folderSizeCache.value = next;
            const pend = new Set(folderSizePending.value);
            pend.delete(ev.path);
            folderSizePending.value = pend;
          } else if (ev.kind === 'completed' || ev.kind === 'cancelled') {
            folderSizePending.value = new Set();
            if (ev.kind === 'completed' && currentSizeRequestId === requestId) {
              currentSizeRequestId = null;
            }
          }
        })
        .catch(() => {
          if (currentSizeRequestId === requestId) {
            currentSizeRequestId = null;
          }
        });
    }

    /** 大小列展示文本：文件直接显示，文件夹优先缓存、其次「计算中…」、否则空 */
    function folderSizeLabel(e: FileEntry): string {
      if (!e.is_dir) return formatSize(e.size);
      const cached = folderSizeCache.value.get(e.path);
      if (cached) return formatSize(cached.size);
      if (folderSizePending.value.has(e.path)) return t('filemanager.size.calculating');
      return '';
    }

    /** 该文件夹大小是否正在计算中（用于 CSS 淡色） */
    function isSizeCalculating(e: FileEntry): boolean {
      return !!e.is_dir && folderSizePending.value.has(e.path);
    }

    // 相对时间格式化：今天/昨天/N 天前/具体日期
    function formatTime(ts: number): string {
      if (!ts) return '';
      const now = Date.now();
      const d = new Date(ts * 1000);
      const diff = now - d.getTime();
      const oneDay = 86400000;
      const isToday = d.toDateString() === new Date().toDateString();
      const isYesterday = diff >= oneDay && diff < oneDay * 2;
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      if (isToday) return `${hh}:${mm}`;
      if (isYesterday) return `昨天 ${hh}:${mm}`;
      if (diff < oneDay * 7) return `${Math.floor(diff / oneDay)} 天前`;
      return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    }

    // 面包屑路径段
    const breadcrumbSegments = computed(() => {
      if (!currentPath.value) return [];
      const sep = currentPath.value.includes('\\') ? '\\' : '/';
      const parts = currentPath.value.split(sep).filter(Boolean);
      const segments: { name: string; path: string; isHome: boolean }[] = [];
      let acc = '';
      for (let i = 0; i < parts.length; i++) {
        acc = acc ? acc + sep + parts[i] : sep === '\\' ? parts[i] + '\\' : '/' + parts[i];
        segments.push({ name: parts[i], path: acc, isHome: false });
      }
      if (segments.length > 0) segments[0].isHome = true;
      return segments;
    });

    // ========== 磁盘辅助 ==========

    function diskPercent(disk: DiskInfo): number {
      return disk.total > 0 ? Math.round((disk.used / disk.total) * 100) : 0;
    }

    function diskBarClass(disk: DiskInfo): string {
      const p = diskPercent(disk);
      if (p >= 85) return 'full';
      if (p >= 70) return 'warn';
      return 'normal';
    }

    // 文件类型标签（用于「类型」列与 type 排序）
    function fileTypeLabel(entry: FileEntry): string {
      void langTick.value;
      if (entry.is_dir) return t('filemanager.type.folder');
      const icon = entry.icon;
      const map: Record<string, string> = {
        image: t('filemanager.type.image'),
        video: t('filemanager.type.video'),
        audio: t('filemanager.type.audio'),
        archive: t('filemanager.type.archive'),
        word: t('filemanager.type.document'),
        excel: t('filemanager.type.document'),
        ppt: t('filemanager.type.document'),
        pdf: t('filemanager.type.document'),
        markdown: t('filemanager.type.document'),
        typescript: 'TypeScript',
        javascript: 'JavaScript',
        rust: 'Rust',
        python: 'Python',
        css: 'CSS',
        html: 'HTML',
        json: 'JSON',
        config: t('filemanager.type.code'),
        executable: 'Executable',
      };
      return map[icon] || t('filemanager.type.file');
    }

    return {
      // i18n
      t,
      // 导航
      currentPath, breadcrumbSegments, canGoBack, canGoForward, canGoUp,
      navigateTo, goBack, goForward, goUp, refresh,
      // 数据
      entries, displayEntries, loading, dirCount, fileCount,
      // 选择
      selectedPaths, selectedArray, selectedSize,
      onNodeClick, onNodeDblClick, selectAll, clearSelection, onBlankClick,
      // 右键菜单
      contextMenu, onNodeContext, onBlankContext, closeContextMenu, onContextOpen,
      // 操作
      copySelection, cutSelection, paste, deleteSelection,
      renameNode, commitRename, cancelRename, renamingPath, renamingText,
      copyAbsolutePath, openWithSystem, revealInFM,
      startCreate, commitCreate, cancelCreate, creating,
      // 撤销
      undo, redo, undoEmpty,
      // 搜索
      searchActive, searchQuery, searchResults, searchLoading, searchLimited,
      searchMode, contentResults, contentLoading, contentLimited,
      onSearchInput, clearSearch, toggleSearchMode, splitMatchLine, openContentFile,
      indexStatus,
      // 索引设置面板
      indexSettingsVisible, openIndexSettings,
      // 磁盘
      disks, currentDisk, totalCapacity, totalAvailable, totalPercent, disksRefreshing,
      quickAccess, trashQuickAccess, refreshDisks, openSystemTrash, diskPercent, diskBarClass, fileTypeLabel,
      // 排序
      sortKey, sortDir, setSort,
      // 拖拽
      dragState, onDragStart, onDragOverTarget, onDragLeaveTarget,
      onDropOnTarget, onDragEnd, onExternalDrop,
      // Toast
      toast,
      // 焦点
      focused,
      // 剪贴板
      clipboardEmpty, fileClipboard,
      // 工具
      basename, formatSize, formatTime,
      folderSizeLabel, isSizeCalculating,
      openFile,
    };
  },
});
