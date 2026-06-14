/**
 * @fileoverview 工作台路由加载骨架
 * @module web/app/dashboard
 *
 * 工作台切换时的骨架占位。
 */

import { LoadingSkeleton } from "../../components/loading-skeleton";

export default function Loading() {
  return (
    <div className="app-error-boundary">
      <LoadingSkeleton variant="hero" rows={3} />
    </div>
  );
}
