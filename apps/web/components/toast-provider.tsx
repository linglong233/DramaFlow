/**
 * @fileoverview Toast 全局通知 Provider
 * @module web/components
 *
 * 提供跨页面的成功/错误/信息通知。通过 Portal 挂到 document.body，
 * 队列上限 5 条，支持自动消失（hover/focus 暂停）。
 * 用法：const toast = useToast(); toast.success("已保存");
 */

"use client";

import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { useI18n } from "../lib/i18n";
import { ToastItem, type ToastVariant } from "./toast";

interface ToastRecord {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
  durationMs: number;
}

interface ToastOptions {
  description?: string;
  durationMs?: number;
}

interface ToastContextValue {
  success: (title: string, opts?: ToastOptions) => string;
  error: (title: string, opts?: ToastOptions) => string;
  info: (title: string, opts?: ToastOptions) => string;
  dismiss: (id: string) => void;
}

const DEFAULT_DURATION: Record<ToastVariant, number> = {
  success: 4000,
  error: 6000,
  info: 5000,
};

const MAX_TOASTS = 5;

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (variant: ToastVariant, title: string, opts?: ToastOptions) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const durationMs = opts?.durationMs ?? DEFAULT_DURATION[variant];
      setToasts((current) =>
        [{ id, variant, title, description: opts?.description, durationMs }, ...current].slice(
          0,
          MAX_TOASTS,
        ),
      );
      return id;
    },
    [],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      success: (title, opts) => push("success", title, opts),
      error: (title, opts) => push("error", title, opts),
      info: (title, opts) => push("info", title, opts),
      dismiss,
    }),
    [push, dismiss],
  );

  const closeLabel = t("common.close");

  return (
    <ToastContext.Provider value={value}>
      {children}
      {mounted && typeof document !== "undefined"
        ? createPortal(
            <div className="toast-portal" aria-live="polite" aria-atomic="false">
              {toasts.map((toast) => (
                <ToastItem
                  key={toast.id}
                  id={toast.id}
                  variant={toast.variant}
                  title={toast.title}
                  description={toast.description}
                  durationMs={toast.durationMs}
                  closeLabel={closeLabel}
                  onDismiss={dismiss}
                />
              ))}
            </div>,
            document.body,
          )
        : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}
