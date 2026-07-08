import { useDialog } from 'naive-ui';
import type { DialogOptions } from 'naive-ui';

type DialogApi = ReturnType<typeof useDialog>;

let dialogApi: DialogApi | null = null;

/** 在 n-dialog-provider 子组件内注册 dialog API */
export function registerDialogApi(api: DialogApi) {
  dialogApi = api;
}

export interface ConfirmOptions {
  title?: string;
  content: string;
  positiveText?: string;
  negativeText?: string;
  danger?: boolean;
}

/** 弹出确认框，返回 Promise<boolean>，true 表示用户点击了确认 */
export function showConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!dialogApi) {
      resolve(window.confirm(options.content));
      return;
    }
    dialogApi.create({
      title: options.title ?? '确认操作',
      content: options.content,
      positiveText: options.positiveText ?? '确定',
      negativeText: options.negativeText ?? '取消',
      type: options.danger ? 'error' : 'warning',
      onPositiveClick: () => resolve(true),
      onNegativeClick: () => resolve(false),
      onMaskClick: () => resolve(false),
      onClose: () => resolve(false),
    });
  });
}

export function useAppDialog() {
  const dialog = useDialog();
  registerDialogApi(dialog);
  return dialog;
}

export type { DialogOptions };
