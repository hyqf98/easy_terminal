import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { t } from './i18n';
import { applyStoredAppearance } from './mode-bootstrap';

interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export async function initDesktopDrawMode() {
  await applyStoredAppearance();

  document.documentElement.className = 'mode-desktop-draw';
  document.body.className = 'mode-desktop-draw';
  document.body.innerHTML = `
    <div id="desktop-draw-root">
      <div class="desktop-draw-backdrop"></div>
      <div class="desktop-draw-hint">
        <strong>${t('desktop.drawTitle')}</strong>
        <span>${t('desktop.drawHint')}</span>
      </div>
      <div id="desktop-draw-selection"></div>
    </div>
  `;

  const root = document.getElementById('desktop-draw-root') as HTMLDivElement;
  const selection = document.getElementById('desktop-draw-selection') as HTMLDivElement;
  const appWindow = getCurrentWindow();
  let drawing = false;
  let startX = 0;
  let startY = 0;

  const resetSelection = () => {
    drawing = false;
    selection.style.display = 'none';
    selection.style.width = '0';
    selection.style.height = '0';
  };

  const renderSelection = (bounds: Bounds) => {
    selection.style.display = 'block';
    selection.style.left = `${bounds.x}px`;
    selection.style.top = `${bounds.y}px`;
    selection.style.width = `${bounds.w}px`;
    selection.style.height = `${bounds.h}px`;
  };

  const getBounds = (clientX: number, clientY: number): Bounds => ({
    x: Math.min(startX, clientX),
    y: Math.min(startY, clientY),
    w: Math.abs(clientX - startX),
    h: Math.abs(clientY - startY),
  });

  root.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    drawing = true;
    startX = event.clientX;
    startY = event.clientY;
    renderSelection({ x: startX, y: startY, w: 0, h: 0 });
  });

  window.addEventListener('mousemove', (event) => {
    if (!drawing) return;
    renderSelection(getBounds(event.clientX, event.clientY));
  });

  window.addEventListener('mouseup', async (event) => {
    if (!drawing) return;

    const bounds = getBounds(event.clientX, event.clientY);
    resetSelection();

    if (bounds.w < 180 || bounds.h < 120) {
      return;
    }

    try {
      await invoke('create_detached_terminal_window', { bounds });
      await appWindow.destroy();
    } catch (error) {
      console.error('create detached terminal window failed', error);
    }
  });

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    void appWindow.destroy().catch((error) => {
      console.error('desktop draw window destroy failed', error);
    });
  });
}
