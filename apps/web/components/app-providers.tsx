"use client";

import type { ReactNode } from "react";

import { type Locale, I18nProvider } from "../lib/i18n";
import { QueryProvider } from "./query-provider";

export function AppProviders({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale: Locale;
}) {
  return (
    <I18nProvider initialLocale={initialLocale}>
      <QueryProvider>{children}</QueryProvider>
    </I18nProvider>
  );
}
