/**
 * @fileoverview 路由级错误边界
 * @module web/app
 *
 * 捕获路由渲染异常，提供重试与返回工作台入口。
 * 运行在 AppProviders 内部，因此可以使用 useI18n。
 */

"use client";

import { useEffect } from "react";
import Link from "next/link";

import { useI18n } from "../lib/i18n";
import { ErrorState } from "../components/error-state";

interface AppErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AppError({ error, reset }: AppErrorProps) {
  const { t } = useI18n();

  useEffect(() => {
    // 便于在控制台快速定位路由级异常。
    // eslint-disable-next-line no-console
    console.error("[DramaFlow] route error:", error);
  }, [error]);

  const description = error?.message?.trim() || t("common.errorBoundaryDescription");

  return (
    <div className="app-error-boundary">
      <ErrorState
        title={t("common.errorBoundaryTitle")}
        description={description}
        action={
          <div className="inline inline-gap-2" style={{ justifyContent: "center" }}>
            <button type="button" className="btn btn-primary" onClick={() => reset()}>
              {t("common.errorBoundaryReload")}
            </button>
            <Link href="/dashboard" className="btn btn-ghost">
              {t("common.errorBoundaryHome")}
            </Link>
          </div>
        }
      />
    </div>
  );
}
