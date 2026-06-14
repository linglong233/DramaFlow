/**
 * @fileoverview 全局 Provider 组装
 * @module web/components
 *
 * 组合 React Query、Session、I18n、Realtime 等全局 Provider。
 */

"use client";

import type { ReactNode } from "react";

import { type Locale, I18nProvider } from "../lib/i18n";
import { QueryProvider } from "./query-provider";
import { RealtimeProvider } from "./realtime-provider";
import { ToastProvider } from "./toast-provider";

export function AppProviders({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale: Locale;
}) {
  return (
    <I18nProvider initialLocale={initialLocale}>
      <QueryProvider>
        <ToastProvider>
          <RealtimeProvider>{children}</RealtimeProvider>
        </ToastProvider>
      </QueryProvider>
    </I18nProvider>
  );
}
