/**
 * @fileoverview 确认操作对话框
 * @module web/components
 *
 * 通用的操作确认弹窗组件。
 */

"use client";

import { useEffect, useState } from "react";

interface ConfirmActionProps {
  label: string;
  confirmLabel: string;
  tone?: "neutral" | "danger";
  disabled?: boolean;
  onConfirm: () => void;
}

export function ConfirmAction({
  label,
  confirmLabel,
  tone = "danger",
  disabled = false,
  onConfirm,
}: ConfirmActionProps) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) {
      return;
    }

    const timer = window.setTimeout(() => setConfirming(false), 3500);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  const className = tone === "danger" ? "secondary-btn secondary-btn--danger" : "secondary-btn";

  return (
    <button
      type="button"
      className={confirming ? `${className} is-confirming` : className}
      disabled={disabled}
      onClick={() => {
        if (!confirming) {
          setConfirming(true);
          return;
        }

        setConfirming(false);
        onConfirm();
      }}
    >
      {confirming ? confirmLabel : label}
    </button>
  );
}