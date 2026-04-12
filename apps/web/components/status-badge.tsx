/**
 * @fileoverview 状态徽章
 * @module web/components
 *
 * 版本状态和任务状态的彩色徽章组件。
 */

import type { ReactNode } from "react";

interface StatusBadgeProps {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}

export function StatusBadge({ children, tone = "neutral" }: StatusBadgeProps) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}