import { createApp } from 'vue';
import App from './App.vue';
import './styles/index.css';
import { initDesktopDrawMode } from './views/canvas/desktopDraw';
import { initDetachedTerminalMode } from './views/canvas/detachedTerminal';

const mode = new URLSearchParams(window.location.search).get('mode');

if (mode === 'desktop-draw') {
  window.addEventListener('DOMContentLoaded', () => {
    void initDesktopDrawMode();
  });
} else if (mode === 'detached-terminal') {
  window.addEventListener('DOMContentLoaded', () => {
    void initDetachedTerminalMode();
  });
} else {
  const app = createApp(App);
  app.mount('#app');
}
