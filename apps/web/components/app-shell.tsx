"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { clearSession } from "../lib/api";
import { LOCALE_LABELS, type Locale, useI18n } from "../lib/i18n";
import { useSession } from "../lib/use-session";
import { ConfirmAction } from "./confirm-action";
import { LoadingSkeleton } from "./loading-skeleton";

interface AppShellProps {
  children: ReactNode;
  variant?: "public" | "workspace";
  requireAuth?: boolean;
  platformOnly?: boolean;
}

export function AppShell({
  children,
  variant = "workspace",
  requireAuth = false,
  platformOnly = false,
}: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { session, ready } = useSession();
  const { locale, setLocale, t } = useI18n();

  useEffect(() => {
    if (!ready) {
      return;
    }

    if (requireAuth && !session) {
      router.replace("/login");
      return;
    }

    if (platformOnly && session?.user.globalRole !== "platform_super_admin") {
      router.replace("/dashboard");
    }
  }, [platformOnly, ready, requireAuth, router, session]);

  const blocked = requireAuth
    && (!ready || !session || (platformOnly && session.user.globalRole !== "platform_super_admin"));

  const workspaceLinks = [
    { href: "/dashboard", label: t("nav.dashboard") },
    { href: "/admin/team", label: t("nav.teamAdmin") },
    { href: "/admin/platform", label: t("nav.platformAdmin") },
  ];

  return (
    <main className="page-shell">
      <header className={variant === "public" ? "app-shell app-shell--public" : "app-shell"}>
        <Link href={variant === "public" ? "/" : "/dashboard"} className="brand-link">
          <div className="brand-mark">DF</div>
          <div>
            <strong>DramaFlow</strong>
            <div className="muted">{t("common.brandTagline")}</div>
          </div>
        </Link>

        <div className="shell-actions">
          {variant === "workspace" ? (
            <nav className="nav-links">
              {workspaceLinks.map((item) => {
                if (item.href === "/admin/platform" && session?.user.globalRole !== "platform_super_admin") {
                  return null;
                }

                const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
                return (
                  <Link
                    key={item.href}
                    href={item.href as "/dashboard" | "/admin/team" | "/admin/platform"}
                    className={active ? "nav-link nav-link--active" : "nav-link"}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          ) : null}

          <label className="locale-switcher">
            <span>{t("common.language")}</span>
            <select
              className="locale-switcher__select"
              value={locale}
              onChange={(event) => setLocale(event.target.value as Locale)}
            >
              {(Object.entries(LOCALE_LABELS) as Array<[Locale, string]>).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          {variant === "workspace" ? (
            session ? (
              <div className="shell-user">
                <div>
                  <strong>{session.user.displayName}</strong>
                  <div className="muted">{session.user.email}</div>
                </div>
                <ConfirmAction
                  label={t("common.signOut")}
                  confirmLabel={t("common.confirmSignOut")}
                  tone="neutral"
                  onConfirm={() => {
                    clearSession();
                    router.replace("/login");
                  }}
                />
              </div>
            ) : (
              <Link className="secondary-btn" href="/login">
                {t("common.signIn")}
              </Link>
            )
          ) : (
            <>
              <Link className="secondary-btn" href="/login">
                {t("common.signInRegister")}
              </Link>
              <Link className="primary-btn" href="/dashboard">
                {t("common.openWorkspace")}
              </Link>
            </>
          )}
        </div>
      </header>

      {blocked ? (
        <div className="stack stack--page">
          <LoadingSkeleton variant="hero" rows={4} />
          <LoadingSkeleton rows={6} />
        </div>
      ) : children}
    </main>
  );
}
