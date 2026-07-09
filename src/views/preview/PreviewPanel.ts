import { defineComponent, ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import type { PropType } from 'vue';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { Icon } from '@vicons/utils';
import { X, Edit, Check, DeviceFloppy } from '@vicons/tabler';
import videojs from 'video.js';
import 'video.js/dist/video-js.css';
import { marked } from 'marked';
import { t } from '../../i18n';
import { showMessage } from '../../composables/useAppMessage';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter, foldKeymap, indentOnInput } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
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

// 可识别的文件类型分类
type PreviewKind = 'markdown' | 'image' | 'video' | 'code' | 'binary';

// 预览数据（来自后端 read_file_preview）
interface FilePreviewData {
  path: string;
  language: string;
  content: string;
  truncated: boolean;
  size: number;
}

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

export default defineComponent({
  name: 'PreviewPanel',
  components: { Icon, X, Edit, Check, DeviceFloppy },
  props: {
    filePath: { type: String, default: '' },
    // 文件操作策略：非空时走远程（SSH）策略读取/写入，跳过本地 invoke 与 convertFileSrc
    strategy: { type: Object as PropType<IFileOperationStrategy | null>, default: null },
  },
  emits: ['close'],
  setup(props, { emit }) {
    const kind = ref<PreviewKind>('code');
    const rawContent = ref('');
    const language = ref('');
    const truncated = ref(false);
    const fileSize = ref(0);
    const loading = ref(false);

    // Markdown 预览/源码切换
    const mdMode = ref<'preview' | 'source'>('preview');
    // 图片点击放大
    const imgZoomed = ref(false);
    // 编辑模式（代码/文本/markdown 源码可编辑）
    const editMode = ref(false);
    const editorHostRef = ref<HTMLDivElement | null>(null);
    let editorView: EditorView | null = null;
    const saving = ref(false);

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

    // 渲染后的 Markdown HTML
    const renderedMarkdown = computed(() => {
      if (kind.value !== 'markdown') return '';
      try {
        return marked.parse(rawContent.value) as string;
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
        if (props.strategy) {
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
    }

    // 初始化 video.js 播放器
    function initPlayer() {
      if (kind.value !== 'video' || !videoRef.value) return;
      // 销毁旧实例，避免重复初始化
      if (player) {
        player.dispose();
        player = null;
      }
      player = videojs(videoRef.value, {
        controls: true,
        autoplay: false,
        preload: 'metadata',
        fluid: true,
      });
    }

    // 切换图片缩放
    function toggleZoom() {
      imgZoomed.value = !imgZoomed.value;
    }

    function close() {
      emit('close');
    }

    // 文件路径变化时重新加载
    watch(
      () => props.filePath,
      () => {
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

    onMounted(() => {
      void loadFile();
    });

    onBeforeUnmount(() => {
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
    });

    return {
      kind,
      rawContent,
      language,
      truncated,
      fileSize,
      loading,
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
      toggleZoom,
      close,
      formatSize,
      // 编辑模式
      editMode,
      editorHostRef,
      saving,
      canEdit,
      saveEdit,
      toggleEdit,
    };
  },
});
