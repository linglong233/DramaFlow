import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { AppProviders } from "../components/app-providers";
import { normalizeLocale } from "../lib/i18n";

import "./globals.css";

export const metadata: Metadata = {
  title: "DramaFlow",
  description: "Director-first short drama generation workspace",
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const cookieStore = await cookies();
  const initialLocale = normalizeLocale(cookieStore.get("dramaflow.locale")?.value);

  return (
    <html lang={initialLocale}>
      <body>
        <AppProviders initialLocale={initialLocale}>{children}</AppProviders>
      </body>
    </html>
  );
}
