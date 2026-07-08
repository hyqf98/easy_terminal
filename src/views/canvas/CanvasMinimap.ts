import { defineComponent, ref, onMounted, onBeforeUnmount, type CSSProperties } from 'vue';

const POLL_INTERVAL = 600;
const MINIMAP_WIDTH = 180;
const MINIMAP_HEIGHT = 120;
const PADDING_TOP = 18; // 顶部留给 label 的空间
const PADDING_SIDE = 8;

interface WorldRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface TerminalRect extends WorldRect {
  focused: boolean;
}

interface MinimapItem {
  style: CSSProperties;
  focused: boolean;
}

interface CanvasTransform {
  panX: number;
  panY: number;
  zoom: number;
}

/** 读取 .terminal-window 元素的内联 left/top/width/height（画布世界坐标） */
function readTerminalRects(): TerminalRect[] {
  const nodes = document.querySelectorAll<HTMLElement>('.canvas-stage .terminal-window');
  const rects: TerminalRect[] = [];
  nodes.forEach((node) => {
    const left = parseFloat(node.style.left || '0');
    const top = parseFloat(node.style.top || '0');
    const width = parseFloat(node.style.width || '0');
    const height = parseFloat(node.style.height || '0');
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    rects.push({ x: left, y: top, w: width, h: height, focused: node.classList.contains('focused') });
  });
  return rects;
}

function parseCanvasTransform(canvas: HTMLElement | null): CanvasTransform {
  if (!canvas) return { panX: 0, panY: 0, zoom: 1 };
  const transform = canvas.style.transform || '';
  const translateMatch = transform.match(/translate3d\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px/);
  const scaleMatch = transform.match(/scale\(\s*([\d.]+)\s*\)/);
  return {
    panX: translateMatch ? parseFloat(translateMatch[1]) : 0,
    panY: translateMatch ? parseFloat(translateMatch[2]) : 0,
    zoom: scaleMatch ? parseFloat(scaleMatch[1]) : 1,
  };
}

function getViewportWorldRect(transform: CanvasTransform): WorldRect {
  const stage = document.querySelector<HTMLElement>('.canvas-stage');
  const viewportWidth = stage ? stage.clientWidth : window.innerWidth;
  const viewportHeight = stage ? stage.clientHeight : window.innerHeight;
  const zoom = transform.zoom || 1;
  return {
    x: -transform.panX / zoom,
    y: -transform.panY / zoom,
    w: viewportWidth / zoom,
    h: viewportHeight / zoom,
  };
}

export default defineComponent({
  name: 'CanvasMinimap',
  setup() {
    const visible = ref(true);
    const items = ref<MinimapItem[]>([]);
    const viewportStyle = ref<CSSProperties>({ display: 'none' });

    let pollTimer: number | null = null;
    let mutationObserver: MutationObserver | null = null;

    function render() {
      const canvas = document.getElementById('canvas');
      const transform = parseCanvasTransform(canvas);
      const terminals = readTerminalRects();
      const viewport = getViewportWorldRect(transform);

      if (terminals.length === 0) {
        // 没有终端时仅显示视口框
        const innerX = PADDING_SIDE;
        const innerY = PADDING_TOP;
        const innerW = MINIMAP_WIDTH - PADDING_SIDE * 2;
        const innerH = MINIMAP_HEIGHT - PADDING_TOP - PADDING_SIDE;
        const scale = Math.min(innerW / Math.max(viewport.w, 1), innerH / Math.max(viewport.h, 1));
        const offsetX = innerX - viewport.x * scale;
        const offsetY = innerY - viewport.y * scale;
        items.value = [];
        viewportStyle.value = {
          left: `${offsetX + viewport.x * scale}px`,
          top: `${offsetY + viewport.y * scale}px`,
          width: `${Math.max(viewport.w * scale, 4)}px`,
          height: `${Math.max(viewport.h * scale, 4)}px`,
        };
        return;
      }

      // 计算所有终端与视口的联合边界，保证小地图完整可见
      let minX = Math.min(viewport.x, ...terminals.map((r) => r.x));
      let minY = Math.min(viewport.y, ...terminals.map((r) => r.y));
      let maxX = Math.max(viewport.x + viewport.w, ...terminals.map((r) => r.x + r.w));
      let maxY = Math.max(viewport.y + viewport.h, ...terminals.map((r) => r.y + r.h));

      const worldW = Math.max(maxX - minX, 1);
      const worldH = Math.max(maxY - minY, 1);

      const innerX = PADDING_SIDE;
      const innerY = PADDING_TOP;
      const innerW = MINIMAP_WIDTH - PADDING_SIDE * 2;
      const innerH = MINIMAP_HEIGHT - PADDING_TOP - PADDING_SIDE;
      const scale = Math.min(innerW / worldW, innerH / worldH);
      const offsetX = innerX - minX * scale;
      const offsetY = innerY - minY * scale;

      const nextItems: MinimapItem[] = terminals.map((rect) => ({
        focused: rect.focused,
        style: {
          left: `${offsetX + rect.x * scale}px`,
          top: `${offsetY + rect.y * scale}px`,
          width: `${Math.max(rect.w * scale, 2)}px`,
          height: `${Math.max(rect.h * scale, 2)}px`,
        },
      }));
      items.value = nextItems;

      viewportStyle.value = {
        left: `${offsetX + viewport.x * scale}px`,
        top: `${offsetY + viewport.y * scale}px`,
        width: `${Math.max(viewport.w * scale, 4)}px`,
        height: `${Math.max(viewport.h * scale, 4)}px`,
      };
    }

    onMounted(() => {
      render();
      pollTimer = window.setInterval(render, POLL_INTERVAL);
      const canvas = document.getElementById('canvas');
      if (canvas && typeof MutationObserver !== 'undefined') {
        mutationObserver = new MutationObserver(() => render());
        mutationObserver.observe(canvas, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
      }
    });

    onBeforeUnmount(() => {
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
      if (mutationObserver) {
        mutationObserver.disconnect();
        mutationObserver = null;
      }
    });

    return { visible, items, viewportStyle };
  },
});
