/**
 * IndexSettingsPanel — 索引设置面板
 *
 * 让用户配置索引扫描范围、排除目录、文件类型与扩展名。
 * 打开时从后端加载当前配置，保存时调用 saveIndexConfig（后端会自动触发重建）。
 *
 * 设计：Craft 主题，遵循 FileManager 的组件写法（defineComponent + 独立 .ts/.vue/.css）。
 */
import { defineComponent, ref, reactive, watch } from 'vue';
import * as svc from './fileManagerService';
import type { IndexConfig } from './fileManagerService';
import { showMessage } from '../../composables/useAppMessage';

/** 文件类型类别：key 对应后端分类，label/desc 仅用于展示 */
const FILE_CATEGORIES: ReadonlyArray<{ key: string; label: string; desc: string }> = [
  { key: 'code', label: '代码', desc: '.ts .js .rs .py .go .java ...' },
  { key: 'document', label: '文档', desc: '.md .txt .pdf .docx ...' },
  { key: 'image', label: '图片', desc: '.png .jpg .svg .webp ...' },
  { key: 'audio', label: '音频', desc: '.mp3 .wav .flac ...' },
  { key: 'video', label: '视频', desc: '.mp4 .mov .webm ...' },
  { key: 'archive', label: '压缩包', desc: '.zip .tar.gz .7z ...' },
  { key: 'other', label: '其他', desc: '未分类文件' },
];

/** 后端不可用时的兜底默认配置 */
const DEFAULT_CONFIG: IndexConfig = {
  roots: ['/'],
  excludedPaths: [],
  enabledCategories: ['code', 'document', 'image', 'archive', 'other'],
  customExtensions: [],
  excludeExtensions: [],
};

export default defineComponent({
  name: 'IndexSettingsPanel',
  props: {
    visible: { type: Boolean, default: false },
  },
  emits: ['close'],
  setup(props, { emit }) {
    const loading = ref(false);
    const saving = ref(false);

    // 本地配置副本（与后端解耦，保存时整体回写）
    const config = reactive<IndexConfig>({
      roots: [...DEFAULT_CONFIG.roots],
      excludedPaths: [...DEFAULT_CONFIG.excludedPaths],
      enabledCategories: [...DEFAULT_CONFIG.enabledCategories],
      customExtensions: [...DEFAULT_CONFIG.customExtensions],
      excludeExtensions: [...DEFAULT_CONFIG.excludeExtensions],
    });

    // 输入框临时值
    const newRoot = ref('');
    const newExcluded = ref('');
    const customExtText = ref('');
    const excludeExtText = ref('');

    /** 拉取后端最新配置并填充本地副本 */
    async function loadConfig() {
      loading.value = true;
      try {
        const cfg = await svc.getIndexConfig();
        config.roots = cfg.roots ?? [];
        config.excludedPaths = cfg.excludedPaths ?? [];
        config.enabledCategories = cfg.enabledCategories ?? [];
        config.customExtensions = cfg.customExtensions ?? [];
        config.excludeExtensions = cfg.excludeExtensions ?? [];
        customExtText.value = config.customExtensions.join(', ');
        excludeExtText.value = config.excludeExtensions.join(', ');
      } catch (e) {
        showMessage(`加载索引配置失败：${e}`, 'error');
      } finally {
        loading.value = false;
      }
    }

    // 面板打开时自动加载最新配置
    watch(
      () => props.visible,
      (v) => {
        if (v) loadConfig();
      },
    );

    // === 类别勾选 ===
    function isCategoryEnabled(key: string): boolean {
      return config.enabledCategories.includes(key);
    }
    function toggleCategory(key: string) {
      const idx = config.enabledCategories.indexOf(key);
      if (idx >= 0) config.enabledCategories.splice(idx, 1);
      else config.enabledCategories.push(key);
    }

    // === 扫描根路径 ===
    function addRoot() {
      const v = newRoot.value.trim();
      if (!v) return;
      if (!config.roots.includes(v)) config.roots.push(v);
      newRoot.value = '';
    }
    function removeRoot(p: string) {
      const idx = config.roots.indexOf(p);
      if (idx >= 0) config.roots.splice(idx, 1);
    }

    // === 排除目录 ===
    function addExcluded() {
      const v = newExcluded.value.trim();
      if (!v) return;
      if (!config.excludedPaths.includes(v)) config.excludedPaths.push(v);
      newExcluded.value = '';
    }
    function removeExcluded(p: string) {
      const idx = config.excludedPaths.indexOf(p);
      if (idx >= 0) config.excludedPaths.splice(idx, 1);
    }

    /** 解析逗号分隔的扩展名输入，去掉前导点和空白 */
    function parseExtensions(text: string): string[] {
      return text
        .split(',')
        .map((s) => s.trim().replace(/^\./, ''))
        .filter(Boolean);
    }

    /** 保存配置（后端保存后会自动重建索引） */
    async function save() {
      // 同步扩展名输入框到 config
      config.customExtensions = parseExtensions(customExtText.value);
      config.excludeExtensions = parseExtensions(excludeExtText.value);
      saving.value = true;
      try {
        await svc.saveIndexConfig({
          roots: [...config.roots],
          excludedPaths: [...config.excludedPaths],
          enabledCategories: [...config.enabledCategories],
          customExtensions: [...config.customExtensions],
          excludeExtensions: [...config.excludeExtensions],
        });
        showMessage('索引配置已保存，正在重建索引…', 'success', 3000);
        emit('close');
      } catch (e) {
        showMessage(`保存索引配置失败：${e}`, 'error');
      } finally {
        saving.value = false;
      }
    }

    function close() {
      emit('close');
    }

    return {
      FILE_CATEGORIES,
      loading,
      saving,
      config,
      newRoot,
      newExcluded,
      customExtText,
      excludeExtText,
      isCategoryEnabled,
      toggleCategory,
      addRoot,
      removeRoot,
      addExcluded,
      removeExcluded,
      save,
      close,
    };
  },
});
