import { useContext } from 'react';
import { ToastContext } from './toast.context';
import { ToastType, type ToastItem } from './toast.types';

export interface ToastApi {
  toasts: ToastItem[];
  dismiss: (id: string) => void;
  success: (message: string, title?: string) => void;
  error: (message: string, title?: string) => void;
  warning: (message: string, title?: string) => void;
  info: (message: string, title?: string) => void;
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider.');

  return {
    toasts: context.toasts,
    dismiss: context.dismissToast,
    success: (message, title) => context.addToast(ToastType.Success, message, title),
    error: (message, title) => context.addToast(ToastType.Error, message, title),
    warning: (message, title) => context.addToast(ToastType.Warning, message, title),
    info: (message, title) => context.addToast(ToastType.Info, message, title),
  };
}
