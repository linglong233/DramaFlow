/**
 * @fileoverview 根路由加载骨架
 * @module web/app
 *
 * 路由切换/初始加载时的骨架占位，避免空白闪烁。
 */

import { LoadingSkeleton } from "../components/loading-skeleton";

export default function Loading() {
  return (
    <div className="app-error-boundary stack stack-gap-6">
      <LoadingSkeleton variant="hero" rows={4} />
      <LoadingSkeleton rows={6} />
    </div>
  );
}
