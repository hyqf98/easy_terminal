let toastEl: HTMLDivElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export function showToast(message: string, type: ToastType = 'info', duration = 2500) {
  if (toastEl) {
    toastEl.remove();
    toastEl = null;
  }
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }

  const el = document.createElement('div');
  el.className = `native-toast native-toast-${type}`;
  el.textContent = message;
  document.body.appendChild(el);
  toastEl = el;

  requestAnimationFrame(() => {
    el.classList.add('visible');
  });

  toastTimer = setTimeout(() => {
    el.classList.remove('visible');
    setTimeout(() => {
      el.remove();
      if (toastEl === el) toastEl = null;
    }, 300);
  }, duration);
}

export function showConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'native-confirm-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'native-confirm';

    const msg = document.createElement('div');
    msg.className = 'native-confirm-message';
    msg.textContent = message;

    const actions = document.createElement('div');
    actions.className = 'native-confirm-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'native-btn';
    cancelBtn.textContent = '取消';
    cancelBtn.addEventListener('click', () => {
      overlay.remove();
      resolve(false);
    });

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'native-btn primary';
    confirmBtn.textContent = '确定';
    confirmBtn.addEventListener('click', () => {
      overlay.remove();
      resolve(true);
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    dialog.appendChild(msg);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(false);
      }
    });
  });
}
