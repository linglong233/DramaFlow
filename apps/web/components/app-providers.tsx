"use client";

import type { ReactNode } from "react";

import { type Locale, I18nProvider } from "../lib/i18n";
import { QueryProvider } from "./query-provider";
import { RealtimeProvider } from "./realtime-provider";

export function AppProviders({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale: Locale;
}) {
  return (
    <I18nProvider initialLocale={initialLocale}>
      <QueryProvider><RealtimeProvider>{children}</RealtimeProvider></QueryProvider>
    </I18nProvider>
  );
}
