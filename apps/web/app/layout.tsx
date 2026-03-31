import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { Geist, Geist_Mono, Noto_Sans_SC } from "next/font/google";

import { AppProviders } from "../components/app-providers";
import { normalizeLocale } from "../lib/i18n";

import "./globals.css";

const bodySans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
});

const bodyMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

const cjkSans = Noto_Sans_SC({
  variable: "--font-cjk",
  weight: ["400", "500", "700"],
  preload: false,
});

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
    <html lang={initialLocale}>
      <body className={`${bodySans.variable} ${bodyMono.variable} ${cjkSans.variable}`}>
        <AppProviders initialLocale={initialLocale}>{children}</AppProviders>
      </body>
    </html>
  );
}