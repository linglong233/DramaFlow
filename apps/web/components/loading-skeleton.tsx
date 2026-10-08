/**
 * @fileoverview 加载骨架屏
 * @module web/components
 *
 * 数据加载中的骨架占位动画。
 */

"use client";

import { useI18n } from "../lib/i18n";

interface LoadingSkeletonProps {
  rows?: number;
  variant?: "card" | "hero";
}

export function LoadingSkeleton({ rows = 3, variant = "card" }: LoadingSkeletonProps) {
  const { t } = useI18n();
  const lineCount = variant === "hero" ? Math.max(rows, 4) : rows;

  return (
    <div
      className={variant === "hero" ? "loading-skeleton loading-skeleton--hero" : "loading-skeleton"}
      role="status"
      aria-label={t("common.loading")}
    >
      {Array.from({ length: lineCount }).map((_, index) => (
        <span key={index} className="loading-skeleton__line" aria-hidden="true" />
      ))}
    </div>
  );
}
