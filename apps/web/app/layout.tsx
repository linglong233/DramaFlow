/**
 * @fileoverview 全局根布局
 * @module web/app
 *
 * 配置全局字体、主题和 SEO 元数据，包裹认证和 React Query Provider。
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { AppProviders } from "../components/app-providers";
import { normalizeLocale } from "../lib/i18n";

import "./globals.css";

export const metadata: Metadata = {
  title: "DramaFlow",
  description: "Director-first short drama control console",
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const cookieStore = await cookies();
  const initialLocale = normalizeLocale(cookieStore.get("dramaflow.locale")?.value);

  return (
    <html lang={initialLocale} data-scroll-behavior="smooth">
      <body>
        <AppProviders initialLocale={initialLocale}>{children}</AppProviders>
      </body>
    </html>
  );
}
