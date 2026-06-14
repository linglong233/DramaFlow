/**
 * @fileoverview 404 未找到页面
 * @module web/app
 *
 * 友好的 404 提示，提供返回入口。
 */

"use client";

import Link from "next/link";

import { useI18n } from "../lib/i18n";
import { EmptyState } from "../components/empty-state";

export default function NotFound() {
  const { t } = useI18n();

  return (
    <div className="app-error-boundary">
      <EmptyState
        title={t("common.notFoundTitle")}
        description={t("common.notFoundDescription")}
        action={
          <Link href="/dashboard" className="btn btn-primary">
            {t("common.notFoundHome")}
          </Link>
        }
      />
    </div>
  );
}
