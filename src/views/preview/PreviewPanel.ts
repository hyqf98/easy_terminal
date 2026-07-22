import { defineComponent, ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import type { PropType } from 'vue';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { Icon } from '@vicons/utils';
import { X, Edit, DeviceFloppy, Search, ChevronUp, ChevronDown } from '@vicons/tabler';
import videojs from 'video.js';
import 'video.js/dist/video-js.css';
import { marked } from 'marked';
import Mark from 'mark.js';
import { t } from '../../i18n';
import { showMessage } from '../../composables/useAppMessage';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter, foldKeymap, indentOnInput } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { SearchQuery, findNext, findPrevious, search, searchKeymap, setSearchQuery, highlightSelectionMatches } from '@codemirror/search';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { markdown } from '@codemirror/lang-markdown';
import { yaml } from '@codemirror/lang-yaml';
import { java } from '@codemirror/lang-java';
import { xml } from '@codemirror/lang-xml';
import { sql } from '@codemirror/lang-sql';
import { php } from '@codemirror/lang-php';
import { oneDark } from '@codemirror/theme-one-dark';
import type { Extension } from '@codemirror/state';
import type { IFileOperationStrategy } from '../filetree/strategies/FileOperationStrategy';
import type { FilePreviewData, PrefetchedFilePreview } from '../../types';

// 可识别的文件类型分类
type PreviewKind = 'markdown' | 'image' | 'video' | 'code' | 'binary';
type PanelStyle = Record<string, string>;

// 大纲条目：从 Markdown 原文中提取的标题
interface MarkdownHeading {
  level: number;
  text: string;
}

// 根据扩展名推断文件类型分类
function detectKind(name: string): PreviewKind {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['md', 'markdown'].includes(ext)) return 'markdown';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v'].includes(ext)) return 'video';
  // 其余文本类一律作为代码/文本展示
  return 'code';
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
}

function detectVideoMime(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',
  };
  return map[ext] || 'video/mp4';
}

export default defineComponent({
  name: 'PreviewPanel',
  components: { Icon, X, Edit, DeviceFloppy, Search, ChevronUp, ChevronDown },
  props: {
    filePath: { type: String, default: '' },
    // 文件操作策略：非空时走远程（SSH）策略读取/写入，跳过本地 invoke 与 convertFileSrc
    strategy: { type: Object as PropType<IFileOperationStrategy | null>, default: null },
    prefetched: { type: Object as PropType<PrefetchedFilePreview | null>, default: null },
  },
  emits: ['close', 'width-change'],
  setup(props, { emit }) {
    const kind = ref<PreviewKind>('code');
    const rawContent = ref('');
    const language = ref('');
    const truncated = ref(false);
    const fileSize = ref(0);
    const loading = ref(false);
    const PANEL_WIDTH_KEY = 'easy_terminal_preview_panel_width';
    const PANEL_MIN_W = 360;
    const PANEL_MAX_W = 960;
    const panelWidth = ref<number>((() => {
      const raw = localStorage.getItem(PANEL_WIDTH_KEY);
      const parsed = raw ? parseInt(raw, 10) : NaN;
      return Number.isFinite(parsed) ? Math.max(PANEL_MIN_W, Math.min(PANEL_MAX_W, parsed)) : 520;
    })());
    const panelStyle = computed<PanelStyle>(() => ({ width: `${panelWidth.value}px` }));

    // 宽度变化时通知父组件，让 #stage 的 CSS 变量 --preview-w 同步更新
    watch(panelWidth, (w) => emit('width-change', w), { immediate: true });

    // Markdown 预览/源码切换
    const mdMode = ref<'preview' | 'source'>('preview');
    // 图片点击放大
    const imgZoomed = ref(false);
    // 编辑模式（代码/文本/markdown 源码可编辑）
    const editMode = ref(false);
    const editorHostRef = ref<HTMLDivElement | null>(null);
    let editorView: EditorView | null = null;
    // 只读代码预览编辑器（预览模式下的语法高亮 + 折叠）
    let readOnlyEditorView: EditorView | null = null;
    const readOnlyEditorHostRef = ref<HTMLDivElement | null>(null);
    const saving = ref(false);

    // 统一内容搜索：CodeMirror 负责源码/代码，Mark.js 负责 Markdown 渲染内容。
    const searchOpen = ref(false);
    const searchQuery = ref('');
    const searchCurrent = ref(0);
    const searchTotal = ref(0);
    const searchInputRef = ref<HTMLInputElement | null>(null);
    const markdownPreviewRef = ref<HTMLElement | null>(null);
    const markdownSourceRef = ref<HTMLElement | null>(null);
    let domSearchMatches: HTMLElement[] = [];
    let editorSearchMatches: Array<{ from: number; to: number }> = [];
    let searchRunId = 0;

    const canSearch = computed(() => kind.value === 'code' || kind.value === 'markdown');
    const searchPlaceholder = computed(() => t('file.searchPlaceholder'));
    const searchResultLabel = computed(() => searchQuery.value ? `${searchCurrent.value} / ${searchTotal.value}` : '');

    function activeSearchEditor(): EditorView | null {
      if (editMode.value) return editorView;
      if (kind.value === 'code') return readOnlyEditorView;
      return null;
    }

    function activeDomSearchRoot(): HTMLElement | null {
      if (kind.value !== 'markdown' || editMode.value) return null;
      return mdMode.value === 'preview' ? markdownPreviewRef.value : markdownSourceRef.value;
    }

    function setActiveDomMatch(index: number) {
      domSearchMatches.forEach((element) => element.classList.remove('current'));
      if (!domSearchMatches.length) {
        searchCurrent.value = 0;
        return;
      }
      const normalized = (index + domSearchMatches.length) % domSearchMatches.length;
      const current = domSearchMatches[normalized];
      current.classList.add('current');
      current.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      searchCurrent.value = normalized + 1;
    }

    function clearDomSearch(root: HTMLElement | null): Promise<void> {
      domSearchMatches = [];
      if (!root) return Promise.resolve();
      return new Promise((resolve) => new Mark(root).unmark({ done: () => resolve() }));
    }

    function clearEditorSearch(view: EditorView | null) {
      if (!view) return;
      view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '' })) });
    }

    async function refreshSearch() {
      const runId = ++searchRunId;
      await nextTick();
      const query = searchQuery.value.trim();
      const editor = activeSearchEditor();
      const domRoot = activeDomSearchRoot();

      if (editorView !== editor) clearEditorSearch(editorView);
      if (readOnlyEditorView !== editor) clearEditorSearch(readOnlyEditorView);
      await clearDomSearch(markdownPreviewRef.value);
      await clearDomSearch(markdownSourceRef.value);
      if (runId !== searchRunId) return;

      searchCurrent.value = 0;
      searchTotal.value = 0;
      editorSearchMatches = [];
      if (!query || !searchOpen.value) {
        clearEditorSearch(editor);
        return;
      }

      if (editor) {
        const cmQuery = new SearchQuery({ search: query, caseSensitive: false, literal: true });
        editor.dispatch({
          effects: setSearchQuery.of(cmQuery),
          selection: { anchor: 0 },
        });
        const cursor = cmQuery.getCursor(editor.state);
        for (let result = cursor.next(); !result.done; result = cursor.next()) {
          editorSearchMatches.push(result.value);
        }
        searchTotal.value = editorSearchMatches.length;
        if (editorSearchMatches.length) {
          findNext(editor);
          searchCurrent.value = 1;
        }
        return;
      }

      if (domRoot) {
        await new Promise<void>((resolve) => {
          new Mark(domRoot).mark(query, {
            className: 'preview-search-mark',
            separateWordSearch: false,
            caseSensitive: false,
            acrossElements: true,
            each: (element) => domSearchMatches.push(element as HTMLElement),
            done: () => resolve(),
          });
        });
        if (runId !== searchRunId) return;
        searchTotal.value = domSearchMatches.length;
        if (domSearchMatches.length) setActiveDomMatch(0);
      }
    }

    function syncEditorSearchCurrent(view: EditorView) {
      const selection = view.state.selection.main;
      const index = editorSearchMatches.findIndex((match) => match.from === selection.from && match.to === selection.to);
      if (index >= 0) searchCurrent.value = index + 1;
    }

    function goToSearchMatch(direction: 1 | -1) {
      if (!searchQuery.value.trim()) return;
      const editor = activeSearchEditor();
      if (editor) {
        (direction === 1 ? findNext : findPrevious)(editor);
        syncEditorSearchCurrent(editor);
        return;
      }
      if (domSearchMatches.length) setActiveDomMatch(searchCurrent.value - 1 + direction);
    }

    function openSearch() {
      if (!canSearch.value) return;
      searchOpen.value = true;
      void nextTick(() => searchInputRef.value?.focus());
    }

    function closeSearch() {
      searchOpen.value = false;
      searchQuery.value = '';
      searchCurrent.value = 0;
      searchTotal.value = 0;
      searchRunId += 1;
      clearEditorSearch(editorView);
      clearEditorSearch(readOnlyEditorView);
      void clearDomSearch(markdownPreviewRef.value);
      void clearDomSearch(markdownSourceRef.value);
    }

    function onGlobalSearchKeydown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f' && canSearch.value) {
        event.preventDefault();
        event.stopPropagation();
        openSearch();
      }
    }

    /** 根据语言名获取 CodeMirror 语法扩展 */
    function getLangExtensions(lang: string): Extension[] {
      const map: Record<string, () => Extension[]> = {
        typescript: () => [javascript({ typescript: true })],
        javascript: () => [javascript()],
        json: () => [json()],
        css: () => [css()],
        scss: () => [css()],
        html: () => [html()],
        python: () => [python()],
        rust: () => [rust()],
        markdown: () => [markdown()],
        yaml: () => [yaml()],
        java: () => [java()],
        xml: () => [xml()],
        sql: () => [sql()],
        php: () => [php()],
      };
      return map[lang]?.() || [];
    }

    /** 初始化 CodeMirror 编辑器 */
    function initEditor() {
      if (!editorHostRef.value) return;
      if (editorView) { editorView.destroy(); editorView = null; }
      const isDark = !document.documentElement.getAttribute('data-theme')?.includes('light');
      const fontSize = parseInt(localStorage.getItem('terminal-font-size') || '14', 10);
      const extensions: Extension[] = [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        drawSelection(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        foldGutter(),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        highlightSelectionMatches(),
        search({ top: true }),
        ...getLangExtensions(language.value),
        keymap.of([
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
          ...closeBracketsKeymap,
          indentWithTab,
        ]),
        EditorState.tabSize.of(2),
        EditorView.lineWrapping,
        EditorView.theme({
          '&': { fontSize: fontSize + 'px', height: '100%' },
          '.cm-scroller': { fontFamily: 'var(--font-mono)' },
        }, { dark: isDark }),
      ];
      if (isDark) extensions.push(oneDark);
      editorView = new EditorView({
        state: EditorState.create({ doc: rawContent.value, extensions }),
        parent: editorHostRef.value,
      });
      if (searchOpen.value && searchQuery.value) void refreshSearch();
    }

    /** 初始化只读 CodeMirror（代码预览，支持语法高亮 + 折叠） */
    function initReadOnlyEditor() {
      if (readOnlyEditorView) {
        readOnlyEditorView.destroy();
        readOnlyEditorView = null;
      }
      if (!readOnlyEditorHostRef.value || kind.value !== 'code') return;

      const isDark = !document.documentElement.getAttribute('data-theme')?.includes('light');
      const fontSize = parseInt(localStorage.getItem('terminal-font-size') || '14', 10);
      const extensions: Extension[] = [
        ...getLangExtensions(language.value),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        bracketMatching(),
        foldGutter(),
        indentOnInput(),
        EditorView.lineWrapping,
        EditorState.readOnly.of(true),
        search({ top: true }),
        keymap.of([...foldKeymap]),
        EditorView.theme({
          '&': { fontSize: fontSize + 'px', height: '100%' },
          '.cm-scroller': { fontFamily: 'var(--font-mono)' },
        }, { dark: isDark }),
      ];
      if (isDark) extensions.push(oneDark);
      readOnlyEditorView = new EditorView({
        state: EditorState.create({ doc: rawContent.value, extensions }),
        parent: readOnlyEditorHostRef.value,
      });
      if (searchOpen.value && searchQuery.value) void refreshSearch();
    }

    /** 保存编辑内容 */
    async function saveEdit() {
      if (!editorView || !props.filePath) return;
      saving.value = true;
      const content = editorView.state.doc.toString();
      try {
        // 远程走策略写入，本地走后端 invoke
        if (props.strategy) {
          await props.strategy.writeFile(props.filePath, content);
        } else {
          await invoke('write_text_file', { path: props.filePath, content });
        }
        rawContent.value = content;
        showMessage('文件已保存', 'success');
      } catch (err) {
        showMessage(String(err), 'error');
      } finally {
        saving.value = false;
      }
    }

    /** 切换编辑/预览模式 */
    function toggleEdit() {
      if (editMode.value) {
        editMode.value = false;
        if (editorView) { editorView.destroy(); editorView = null; }
      } else {
        editMode.value = true;
        if (kind.value === 'markdown') mdMode.value = 'source';
        void nextTick(() => initEditor());
      }
    }

    /** 是否可编辑（代码、文本、markdown 均可；图片/视频/二进制不可） */
    const canEdit = computed(() => ['code', 'markdown'].includes(kind.value) && !truncated.value);

    // 媒体 URL（图片/视频）：由 convertFileSrc 转换本地路径
    const mediaUrl = ref('');

    // 视频播放器实例与宿主元素
    const videoRef = ref<HTMLVideoElement | null>(null);
    // videojs 命名空间类型未单独导出，使用其返回类型推断播放器实例
    let player: ReturnType<typeof videojs> | null = null;

    const fileName = computed(() => baseName(props.filePath));
    const previewLabel = computed(() => t('file.previewMode'));
    const sourceLabel = computed(() => t('file.sourceMode'));
    const outlineLabel = computed(() => t('file.outline'));
    const cannotPreviewLabel = computed(() => t('file.cannotPreview'));

    // 文件类型徽标文本：跟随当前分类映射为可读名称
    const kindLabel = computed(() => {
      switch (kind.value) {
        case 'markdown': return 'Markdown';
        case 'image': return 'Image';
        case 'video': return 'Video';
        case 'code': return language.value ? language.value.toUpperCase() : 'Text';
        default: return 'Binary';
      }
    });

    // 渲染后的 Markdown HTML（给 H1-H3 添加 data-heading-idx，与大纲 headings 数组一一对应）
    const renderedMarkdown = computed(() => {
      if (kind.value !== 'markdown') return '';
      try {
        let html = marked.parse(rawContent.value, { async: false }) as string;
        // 给 H1-H3 添加递增索引，与 headings computed 的顺序一致
        let idx = 0;
        html = html.replace(/<(h[1-3])\b/gi, (_match, tag) => {
          return `<${tag} data-heading-idx="${idx++}"`;
        });
        return html;
      } catch {
        return '';
      }
    });

    // 从 Markdown 原文提取 H1-H3 大纲
    const headings = computed<MarkdownHeading[]>(() => {
      if (kind.value !== 'markdown') return [];
      const result: MarkdownHeading[] = [];
      const regex = /^(#{1,3})\s+(.*)$/gm;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(rawContent.value)) !== null) {
        result.push({ level: match[1].length, text: match[2].trim() });
      }
      return result;
    });

    /** 点击大纲条目，平滑滚动到对应标题并临时高亮 */
    function scrollToHeading(idx: number) {
      const body = document.querySelector('.preview-md');
      if (!body) return;
      const target = body.querySelector(`[data-heading-idx="${idx}"]`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        (target as HTMLElement).style.background = 'var(--accent-soft)';
        setTimeout(() => { (target as HTMLElement).style.background = ''; }, 1200);
      }
    }

    // 加载文件预览内容（文本类），并按类型初始化媒体 URL
    async function loadFile() {
      if (!props.filePath) return;
      loading.value = true;
      kind.value = detectKind(props.filePath);

      // 图片 / 视频：远程策略无法直接 convertFileSrc，仅本地模式生成可访问 URL
      if (kind.value === 'image' || kind.value === 'video') {
        mediaUrl.value = props.strategy ? '' : convertFileSrc(props.filePath);
        loading.value = false;
        return;
      }

      // Markdown / 代码 / 文本：远程走策略读取，本地走后端 invoke
      try {
        const prefetched = props.prefetched?.path === props.filePath ? props.prefetched.data : null;
        if (prefetched) {
          rawContent.value = prefetched.content;
          language.value = prefetched.language;
          truncated.value = prefetched.truncated;
          fileSize.value = prefetched.size;
          mdMode.value = 'preview';
        } else if (props.strategy) {
          // 远程文件：直接使用策略返回的预览数据
          const data = await props.strategy.readFilePreview(props.filePath);
          rawContent.value = data.content;
          language.value = data.language;
          truncated.value = data.truncated;
          fileSize.value = data.size;
          mdMode.value = 'preview';
        } else {
          const data = await invoke<FilePreviewData>('read_file_preview', { path: props.filePath });
          rawContent.value = data.content;
          language.value = data.language;
          truncated.value = data.truncated;
          fileSize.value = data.size;
          mdMode.value = 'preview';
        }
      } catch (err) {
        // 二进制文件读取失败：回退到无法预览的空状态
        kind.value = 'binary';
        showMessage(String(err), 'error');
      } finally {
        loading.value = false;
      }
      // 代码/文本：初始化只读 CodeMirror（等 DOM 更新后挂载）
      if (kind.value === 'code') {
        await nextTick();
        initReadOnlyEditor();
      }
    }

    // 初始化 video.js 播放器
    function initPlayer() {
      if (kind.value !== 'video' || !videoRef.value || !mediaUrl.value) return;
      // 销毁旧实例，避免重复初始化
      if (player) {
        player.dispose();
        player = null;
      }
      player = videojs(videoRef.value, {
        controls: true,
        autoplay: false,
        preload: 'metadata',
        fill: true,
        responsive: true,
      });
      player.src({ src: mediaUrl.value, type: detectVideoMime(props.filePath) });
      player.load();
    }

    // 切换图片缩放
    function toggleZoom() {
      imgZoomed.value = !imgZoomed.value;
    }

    function close() {
      emit('close');
    }

    function startResize(e: MouseEvent) {
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = panelWidth.value;
      function onMove(ev: MouseEvent) {
        const next = startWidth + (startX - ev.clientX);
        panelWidth.value = Math.max(PANEL_MIN_W, Math.min(PANEL_MAX_W, next));
      }
      function onUp() {
        localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth.value));
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }

    // 文件路径变化时重新加载
    watch(
      [() => props.filePath, () => props.strategy, () => props.prefetched],
      () => {
        closeSearch();
        if (player) {
          player.dispose();
          player = null;
        }
        // 销毁旧的只读代码编辑器
        if (readOnlyEditorView) {
          readOnlyEditorView.destroy();
          readOnlyEditorView = null;
        }
        mediaUrl.value = '';
        rawContent.value = '';
        imgZoomed.value = false;
        void loadFile();
      },
      { immediate: true }
    );

    // 视频类型且 DOM 就绪后初始化播放器
    watch(
      [kind, mediaUrl],
      async () => {
        if (kind.value === 'video' && mediaUrl.value) {
          await nextTick();
          initPlayer();
        }
      }
    );

    watch(
      [searchQuery, mdMode, editMode, rawContent],
      () => { if (searchOpen.value) void refreshSearch(); },
      { flush: 'post' }
    );

    onMounted(() => document.addEventListener('keydown', onGlobalSearchKeydown, true));

    onBeforeUnmount(() => {
      document.removeEventListener('keydown', onGlobalSearchKeydown, true);
      closeSearch();
      // 释放 video.js 播放器资源
      if (player) {
        player.dispose();
        player = null;
      }
      // 释放 CodeMirror 编辑器
      if (editorView) {
        editorView.destroy();
        editorView = null;
      }
      // 释放只读代码预览编辑器
      if (readOnlyEditorView) {
        readOnlyEditorView.destroy();
        readOnlyEditorView = null;
      }
    });

    return {
      kind,
      rawContent,
      language,
      truncated,
      fileSize,
      loading,
      panelWidth,
      panelStyle,
      mdMode,
      imgZoomed,
      mediaUrl,
      videoRef,
      fileName,
      previewLabel,
      sourceLabel,
      outlineLabel,
      cannotPreviewLabel,
      kindLabel,
      renderedMarkdown,
      headings,
      scrollToHeading,
      toggleZoom,
      startResize,
      close,
      formatSize,
      // 编辑模式
      editMode,
      editorHostRef,
      saving,
      // 只读代码预览编辑器
      readOnlyEditorHostRef,
      canEdit,
      saveEdit,
      toggleEdit,
      // 内容搜索
      canSearch,
      searchOpen,
      searchQuery,
      searchCurrent,
      searchTotal,
      searchInputRef,
      searchPlaceholder,
      searchResultLabel,
      markdownPreviewRef,
      markdownSourceRef,
      openSearch,
      closeSearch,
      goToSearchMatch,
    };
  },
});
