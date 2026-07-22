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
  /** 该小地图块对应的终端画布世界坐标，用于点击导航时读取中心点 */
  rect: WorldRect;
}

interface CanvasTransform {
  panX: number;
  panY: number;
  zoom: number;
}

/** 读取终端窗口世界坐标；展开文件栏时使用统一外壳矩形，避免小地图只显示右侧终端。 */
function readTerminalRects(): TerminalRect[] {
  const nodes = document.querySelectorAll<HTMLElement>(
    '.canvas-stage .terminal-unified-window, .canvas-stage .terminal-window:not(.has-file-panel)'
  );
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
    const hoveredIndex = ref<number | null>(null);

    // 保存最近一次渲染的坐标映射参数，供拖拽视口框时反算世界坐标
    let lastScale = 1;
    let lastOffsetX = 0;
    let lastOffsetY = 0;
    let lastZoom = 1;

    let pollTimer: number | null = null;
    let mutationObserver: MutationObserver | null = null;
    let resizeObserver: ResizeObserver | null = null;

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
        rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
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

      // 保存映射参数供拖拽反算
      lastScale = scale;
      lastOffsetX = offsetX;
      lastOffsetY = offsetY;
      lastZoom = transform.zoom || 1;
    }

    function onTermEnter(idx: number) {
      hoveredIndex.value = idx;
    }
    function onTermLeave() {
      hoveredIndex.value = null;
    }

    /**
     * 点击小地图中的终端块：把该终端平移到视口正中央。
     * 直接写 #canvas 的 transform（保持现有 zoom，仅调整 pan），
     * 这样小地图复用与画布一致的 DOM 读写模式，无需依赖 Canvas 实例引用。
     * 注意：此操作绕过 Canvas 内部 panX/panY 状态，后续滚轮/拖拽会以 Canvas
     * 自身状态为准；当前交互场景下可接受。
     */
    function onTermClick(item: MinimapItem) {
      const canvas = document.getElementById('canvas');
      const stage = document.querySelector<HTMLElement>('.canvas-stage');
      if (!canvas || !stage) return;

      const rect = item.rect;
      const centerX = rect.x + rect.w / 2;
      const centerY = rect.y + rect.h / 2;

      const transform = parseCanvasTransform(canvas);
      const zoom = transform.zoom || 1;
      const stageW = stage.clientWidth;
      const stageH = stage.clientHeight;

      const panX = stageW / 2 - centerX * zoom;
      const panY = stageH / 2 - centerY * zoom;

      canvas.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${zoom})`;

      // 跳转后短暂高亮目标终端，便于用户定位
      focusTerminal(rect);
      render();
    }

    /** 根据世界矩形在 DOM 中匹配对应 .terminal-window 并短暂高亮 */
    function focusTerminal(rect: WorldRect) {
      const nodes = Array.from(document.querySelectorAll<HTMLElement>(
        '.canvas-stage .terminal-unified-window, .canvas-stage .terminal-window:not(.has-file-panel)'
      ));
      let best: HTMLElement | null = null;
      let bestDist = Infinity;
      // 使用同步 for...of 而非 forEach 闭包，避免 TS 控制流把 best 误判为 never
      for (const node of nodes) {
        const l = parseFloat(node.style.left || '0');
        const t = parseFloat(node.style.top || '0');
        const w = parseFloat(node.style.width || '0');
        const h = parseFloat(node.style.height || '0');
        const dist = Math.abs(l - rect.x) + Math.abs(t - rect.y) +
                     Math.abs(w - rect.w) + Math.abs(h - rect.h);
        if (dist < bestDist) {
          bestDist = dist;
          best = node;
        }
      }
      if (!best) return;
      const target = best;
      target.classList.add('minimap-flash');
      window.setTimeout(() => target.classList.remove('minimap-flash'), 900);
    }

    /** 将 minimap 内坐标反算为画布世界坐标中心点 */
    function minimapPosToWorld(clientX: number, clientY: number): { x: number; y: number } {
      const minimapEl = document.querySelector<HTMLElement>('.minimap');
      if (!minimapEl) return { x: 0, y: 0 };
      const rect = minimapEl.getBoundingClientRect();
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      // 反算：(localX - offsetX) / scale = worldX
      return {
        x: (localX - lastOffsetX) / lastScale,
        y: (localY - lastOffsetY) / lastScale,
      };
    }

    /** 将画布视口中心移动到指定世界坐标（保持当前 zoom） */
    function panToWorldCenter(worldX: number, worldY: number) {
      const canvas = document.getElementById('canvas');
      const stage = document.querySelector<HTMLElement>('.canvas-stage');
      if (!canvas || !stage) return;
      const zoom = lastZoom || 1;
      const panX = stage.clientWidth / 2 - worldX * zoom;
      const panY = stage.clientHeight / 2 - worldY * zoom;
      canvas.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${zoom})`;
      render();
    }

    /** 拖拽视口框：移动画布视口到鼠标位置 */
    function onViewportMouseDown(e: MouseEvent) {
      e.preventDefault();
      e.stopPropagation();
      // 立即跳转到鼠标位置
      const world = minimapPosToWorld(e.clientX, e.clientY);
      panToWorldCenter(world.x, world.y);

      function onMove(ev: MouseEvent) {
        const w = minimapPosToWorld(ev.clientX, ev.clientY);
        panToWorldCenter(w.x, w.y);
      }
      function onUp() {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }

    /** 点击 minimap 空白区域：移动视口到点击位置 */
    function onMinimapMouseDown(e: MouseEvent) {
      // 仅响应 minimap 背景区域点击（非终端块、非视口框）
      const target = e.target as HTMLElement;
      if (target.classList.contains('minimap-term') || target.classList.contains('minimap-viewport')) return;
      onViewportMouseDown(e);
    }

    onMounted(() => {
      render();
      pollTimer = window.setInterval(render, POLL_INTERVAL);
      const stage = document.querySelector<HTMLElement>('.canvas-stage');
      if (stage && typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => render());
        resizeObserver.observe(stage);
      }
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
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
    });

    return { visible, items, viewportStyle, hoveredIndex, onTermClick, onTermEnter, onTermLeave, onViewportMouseDown, onMinimapMouseDown };
  },
});
