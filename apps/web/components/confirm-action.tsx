/**
 * @fileoverview 二次确认操作按钮
 * @module web/components
 *
 * 同一按钮内二次确认，离开焦点或按 Escape 取消确认。
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
    if (disabled) {
      setConfirming(false);
    }
  }, [disabled]);

  const className = tone === "danger" ? "secondary-btn secondary-btn--danger" : "secondary-btn";

  return (
    <button
      type="button"
      className={confirming ? `${className} is-confirming` : className}
      disabled={disabled}
      aria-live="polite"
      aria-atomic="true"
      onBlur={() => setConfirming(false)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && confirming) {
          event.preventDefault();
          event.stopPropagation();
          setConfirming(false);
        }
      }}
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
