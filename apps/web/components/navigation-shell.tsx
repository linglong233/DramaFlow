"use client";

import type { ReactNode } from "react";

import { AppShell } from "./app-shell";

export function NavigationShell({ children }: { children: ReactNode }) {
  return <AppShell requireAuth>{children}</AppShell>;
}