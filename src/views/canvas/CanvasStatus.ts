import { defineComponent, ref, onMounted, onBeforeUnmount } from 'vue';

const POLL_INTERVAL = 400;

interface CanvasTransform {
  panX: number;
  panY: number;
  zoom: number;
}

/** 从 #canvas 元素的 transform 解析出 panX / panY / zoom */
function parseCanvasTransform(canvas: HTMLElement | null): CanvasTransform | null {
  if (!canvas) return null;
  const transform = canvas.style.transform || '';
  // 形如：translate3d(12px, -34px, 0) scale(1.2)
  const translateMatch = transform.match(/translate3d\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px/);
  const scaleMatch = transform.match(/scale\(\s*([\d.]+)\s*\)/);
  if (!translateMatch || !scaleMatch) {
    return { panX: 0, panY: 0, zoom: 1 };
  }
  return {
    panX: Math.round(parseFloat(translateMatch[1])),
    panY: Math.round(parseFloat(translateMatch[2])),
    zoom: parseFloat(scaleMatch[1]),
  };
}

export default defineComponent({
  name: 'CanvasStatus',
  setup() {
    const visible = ref(true);
    const panX = ref(0);
    const panY = ref(0);
    const zoomLabel = ref('100%');
    const terminalCount = ref(0);

    let pollTimer: number | null = null;

    function refresh() {
      const canvas = document.getElementById('canvas');
      const transform = parseCanvasTransform(canvas);
      if (transform) {
        panX.value = transform.panX;
        panY.value = transform.panY;
        zoomLabel.value = `${Math.round(transform.zoom * 100)}%`;
      }
      const stage = document.querySelector('.canvas-stage');
      if (stage) {
        terminalCount.value = stage.querySelectorAll('.terminal-window').length;
      }
    }

    onMounted(() => {
      refresh();
      pollTimer = window.setInterval(refresh, POLL_INTERVAL);
    });

    onBeforeUnmount(() => {
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
    });

    return { visible, panX, panY, zoomLabel, terminalCount };
  },
});
