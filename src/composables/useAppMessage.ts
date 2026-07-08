import { useMessage } from 'naive-ui';

let messageApi: ReturnType<typeof useMessage> | null = null;

/** 在 n-message-provider 子组件内注册 message API */
export function registerMessageApi(api: ReturnType<typeof useMessage>) {
  messageApi = api;
}

export function showMessage(content: string, type: 'info' | 'success' | 'warning' | 'error' = 'info', duration = 2000) {
  if (messageApi) {
    messageApi[type](content, { duration });
    return;
  }
  const existing = document.querySelector('.toast-notification');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'toast-notification';
  toast.textContent = content;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

export function useAppMessage() {
  const message = useMessage();
  registerMessageApi(message);
  return message;
}
