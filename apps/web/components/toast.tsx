/**
 * @fileoverview 单条 Toast 视图
 * @module web/components
 *
 * 自管理自动消失定时器，支持 hover/focus 暂停与恢复。
 */

"use client";

import { useEffect, useRef } from "react";

export type ToastVariant = "success" | "error" | "info";

export interface ToastItemProps {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
  durationMs: number;
  closeLabel: string;
  onDismiss: (id: string) => void;
}

export function ToastItem({
  id,
  variant,
  title,
  description,
  durationMs,
  closeLabel,
  onDismiss,
}: ToastItemProps) {
  // 剩余停留时长；hover/focus 暂停后据此恢复
  const remainingRef = useRef(durationMs);
  const startedAtRef = useRef(Date.now());
  const timerRef = useRef<number | null>(null);
  const hoveredRef = useRef(false);
  const focusedRef = useRef(false);

  useEffect(() => {
    startedAtRef.current = Date.now();
    timerRef.current = window.setTimeout(() => onDismiss(id), remainingRef.current);
    return () => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    // 仅在挂载时启停定时器；onDismiss 由 Provider 保持稳定引用
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pause() {
    if (timerRef.current == null) {
      return;
    }
    remainingRef.current = Math.max(
      remainingRef.current - (Date.now() - startedAtRef.current),
      0,
    );
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }

  function resume() {
    if (timerRef.current != null || hoveredRef.current || focusedRef.current) {
      return;
    }
    startedAtRef.current = Date.now();
    timerRef.current = window.setTimeout(() => onDismiss(id), remainingRef.current);
  }

  return (
    <div
      className={`toast toast--${variant}`}
      role={variant === "error" ? "alert" : "status"}
      aria-atomic="true"
      onMouseEnter={() => {
        hoveredRef.current = true;
        pause();
      }}
      onMouseLeave={() => {
        hoveredRef.current = false;
        resume();
      }}
      onFocus={() => {
        focusedRef.current = true;
        pause();
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          focusedRef.current = false;
          resume();
        }
      }}
    >
      <span className={`toast__icon toast__icon--${variant}`} aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {variant === "success" ? <path d="m5 12 4 4L19 6" /> : null}
          {variant === "error" ? <path d="M12 5v9m0 4h.01" /> : null}
          {variant === "info" ? <path d="M12 10v8m0-12h.01" /> : null}
        </svg>
      </span>
      <div className="toast__body">
        <div className="toast__title">{title}</div>
        {description ? <div className="toast__description">{description}</div> : null}
      </div>
      <button
        type="button"
        className="toast__close"
        aria-label={closeLabel}
        onClick={() => onDismiss(id)}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
