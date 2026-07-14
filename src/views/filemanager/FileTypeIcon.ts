import { defineComponent, computed, h, type PropType } from 'vue';

/**
 * FileTypeIcon — 专业文件类型图标组件
 *
 * 基于 Craft 主题的 SVG 图标系统。每种文件类型有独特的视觉识别：
 * - 方块底 + 语言缩写（代码/文档类）
 * - Tabler 风格轮廓图标（媒体/系统类）
 *
 * 使用 CSS 变量保持主题适配，品牌色用于文件类型识别。
 *
 * size 支持：
 * - 数字（如 48）：正常尺寸，代码/文档类渲染方块徽章，其余渲染轮廓图标
 * - 'list'：列表视图专用 16px 轮廓图标，文件夹使用柔和填充双色样式
 */
export default defineComponent({
  name: 'FileTypeIcon',
  props: {
    icon: { type: String, required: true },
    size: { type: [Number, String] as PropType<number | 'list'>, default: 48 },
  },
  setup(props) {
    const config = computed(() => ICON_CONFIGS[props.icon] ?? ICON_CONFIGS['file']);
    return () => {
      const cfg = config.value;

      // 列表模式：统一渲染 16px 轮廓图标（文件夹使用柔和填充双色）
      if (props.size === 'list') {
        return h('span', {
          class: 'fti-list',
          style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
        }, [hSvgList(cfg)]);
      }

      const s = props.size as number;

      // 方块底类型：渲染圆角方块 + 居中文字
      if (cfg.style === 'badge') {
        return h('span', { class: 'fti-wrap' }, [hSvgBadge(s, cfg)]);
      }

      // 轮廓类型：渲染 Tabler 风格 SVG path
      return h('span', { class: 'fti-wrap' }, [hSvgOutline(s, cfg)]);
    };
  },
});

function hSvgBadge(size: number, cfg: IconConfig) {
  const pad = 6;
  const inner = 48 - pad * 2;
  const fontSize = cfg.text && cfg.text.length > 2 ? 11 : 14;
  const textY = cfg.text && cfg.text.length > 2 ? 28 : 30;
  return h('svg', {
    viewBox: '0 0 48 48',
    width: size,
    height: size,
    class: 'fti-badge',
  }, [
    h('rect', {
      x: pad, y: pad, width: inner, height: inner,
      rx: 7, fill: cfg.color, opacity: 0.14,
    }),
    h('rect', {
      x: pad, y: pad, width: inner, height: inner,
      rx: 7, fill: 'none', stroke: cfg.color, 'stroke-width': 1.5,
    }),
    h('text', {
      x: 24, y: textY,
      'text-anchor': 'middle',
      'font-family': 'JetBrains Mono, monospace',
      'font-size': fontSize,
      'font-weight': 700,
      fill: cfg.color,
    }, cfg.text || ''),
  ]);
}

function hSvgOutline(size: number, cfg: IconConfig) {
  return h('svg', {
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    fill: 'none',
    stroke: cfg.color,
    'stroke-width': 1.5,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    class: 'fti-outline',
  }, (cfg.paths || []).map((d) => h('path', { d })));
}

/**
 * 列表视图图标：统一 16px 轮廓风格。
 * - 文件夹：柔和填充双色（fill: var(--accent-soft), stroke: var(--accent)），
 *   与列表模板的 .cell-icon.folder 视觉一致
 * - 其他图标（含代码/文档类）：简单轮廓，fill: none，描边用各自配置色
 */
function hSvgList(cfg: IconConfig) {
  const isFolder = cfg === ICON_CONFIGS['folder'];
  return h('svg', {
    viewBox: '0 0 24 24',
    width: 16,
    height: 16,
    fill: isFolder ? 'var(--accent-soft)' : 'none',
    stroke: cfg.color,
    'stroke-width': 1.5,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    class: 'fti-list-svg',
  }, (cfg.paths || []).map((d) => h('path', { d })));
}

interface IconConfig {
  style: 'badge' | 'outline';
  color: string;
  bgColor?: string;
  text?: string;
  paths?: string[];
}

// 使用 CSS 变量保持主题适配，品牌色用于识别
const C = {
  accent: 'var(--accent)',
  textMuted: 'var(--text-muted)',
  textSub: 'var(--text-sub)',
  blue: 'var(--blue)',
  green: 'var(--green)',
  yellow: 'var(--yellow)',
  red: 'var(--red)',
  mauve: 'var(--mauve)',
  peach: 'var(--peach)',
  teal: 'var(--teal)',
  pink: 'var(--pink)',
  // 品牌色 (硬编码，因为品牌识别需要一致)
  ts: '#3178c6',
  rust: '#ce422b',
};

const ICON_CONFIGS: Record<string, IconConfig> = {
  folder: {
    style: 'outline', color: C.accent,
    paths: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  },
  typescript: { style: 'badge', color: C.ts, bgColor: C.ts, text: 'TS' },
  javascript: { style: 'badge', color: C.yellow, bgColor: C.yellow, text: 'JS' },
  rust: { style: 'badge', color: C.rust, bgColor: C.rust, text: 'RS' },
  python: { style: 'badge', color: C.teal, bgColor: C.teal, text: 'PY' },
  json: { style: 'badge', color: C.yellow, bgColor: C.yellow, text: '{}' },
  markdown: { style: 'badge', color: C.blue, bgColor: C.blue, text: 'MD' },
  css: { style: 'badge', color: C.mauve, bgColor: C.mauve, text: 'CSS' },
  html: { style: 'badge', color: C.peach, bgColor: C.peach, text: '<>' },
  config: { style: 'badge', color: C.textMuted, bgColor: C.textMuted, text: 'CFG' },
  word: { style: 'badge', color: C.blue, bgColor: C.blue, text: 'W' },
  excel: { style: 'badge', color: C.green, bgColor: C.green, text: 'X' },
  ppt: { style: 'badge', color: C.red, bgColor: C.red, text: 'P' },
  image: {
    style: 'outline', color: C.teal,
    paths: [
      'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
      'M3 16l5-5 4 4 3-3 6 6',
      'M9 9.5a1 1 0 1 0 0-0.01',
    ],
  },
  video: {
    style: 'outline', color: C.pink,
    paths: [
      'M3 8a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
      'M16 10l5-3v10l-5-3',
    ],
  },
  audio: {
    style: 'outline', color: C.mauve,
    paths: [
      'M9 18V6l10-2v12',
      'M6 18a3 3 0 1 0 0-0.01',
      'M16 16a3 3 0 1 0 0-0.01',
    ],
  },
  archive: {
    style: 'outline', color: C.mauve,
    paths: [
      'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
      'M4 10v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8',
      'M10 6v4M14 6v4M12 10v4',
    ],
  },
  executable: {
    style: 'outline', color: C.green,
    paths: [
      'M3 5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
      'M2 20h20',
      'M9 10l2 2-2 2',
      'M13 14h3',
    ],
  },
  pdf: {
    style: 'outline', color: C.red,
    paths: [
      'M4 3a1 1 0 0 1 1-1h9l6 6v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z',
      'M14 2v6h6',
      'M8 14h1.5a1.5 1.5 0 0 1 0 3H8v-3zM8 17v1.5',
    ],
  },
  drive: {
    style: 'outline', color: C.textSub,
    paths: ['M3 6h18l-2 12H5z', 'M7 12h.01M11 12h.01'],
  },
  file: {
    style: 'outline', color: C.textMuted,
    paths: [
      'M4 3a1 1 0 0 1 1-1h9l6 6v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z',
      'M14 2v6h6',
    ],
  },
};
