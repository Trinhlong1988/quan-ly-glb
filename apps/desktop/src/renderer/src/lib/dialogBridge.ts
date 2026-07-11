// Cầu nối để CODE THUẦN (không phải React component, ví dụ lib/exportCsv) gọi được hộp thoại DÙNG CHUNG
// (success / alert / confirm) mà không cần hook useToast. ToastProvider đăng ký khi mount (setDialogBridge).
export interface ConfirmOpts { title?: string; okLabel?: string; cancelLabel?: string }
export interface DialogBridge {
  success: (m: string) => void;
  alert: (m: string, title?: string) => void;
  confirm: (m: string, opts?: ConfirmOpts) => Promise<boolean>;
}

let bridge: DialogBridge | null = null;
export function setDialogBridge(b: DialogBridge): void {
  bridge = b;
}
export function getDialogBridge(): DialogBridge {
  if (!bridge) throw new Error('Hộp thoại chưa sẵn sàng (ToastProvider chưa mount).');
  return bridge;
}
