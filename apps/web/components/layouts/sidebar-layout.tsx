/**
 * @fileoverview 侧边栏布局组件
 * @module web/components/layouts
 *
 * 带导航侧边栏的页面布局壳。
 */

"use client";

import type { ReactNode } from "react";
import { Suspense, useEffect, useRef, useState } from "react";
import type { Route } from "next";
import type { TeamSummary } from "@dramaflow/shared";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { apiFetch, clearSession } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { queryKeys } from "../../lib/query-keys";
import { useSession } from "../../lib/use-session";
import { ConfirmAction } from "../confirm-action";
import { LanguageSwitcher } from "../language-switcher";
import { NotificationBell } from "../notification-bell";
import { RealtimeStatus } from "../realtime-status";

type NavItemType = "link" | "section";

interface NavItem {
  id: string;
  type: NavItemType;
  label: string;
  href?: string;
  icon?: ReactNode;
  children?: NavItem[];
}

function NavIcon({ children }: { children: ReactNode }) {
  return <svg className="nav-item-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}

function SidebarNavLink({ item, level, onNavigate }: { item: NavItem; level: number; onNavigate: () => void }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [path, query] = item.href!.split("?");
  const targetParams = new URLSearchParams(query);
  const matchesPath = pathname === path || (path === "/dashboard" && pathname === "/dashboard/projects");
  const isActive = matchesPath && Array.from(targetParams).every(([key, value]) => searchParams.get(key) === value);

  return (
    <Link href={item.href as Route} onClick={onNavigate} className={`nav-item${isActive ? " active" : ""} level-${level}`} aria-current={isActive ? "page" : undefined}>
      {item.icon}<span>{item.label}</span>
    </Link>
  );
}

interface SidebarLayoutProps {
  children: ReactNode;
  variant: "dashboard" | "project";
  projectId?: string;
  flush?: boolean;
}

export function SidebarLayout({ children, variant, projectId, flush }: SidebarLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { session } = useSession();
  const { t } = useI18n();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const teamsQuery = useQuery({
    queryKey: queryKeys.teams,
    queryFn: () => apiFetch<TeamSummary[]>("/teams"),
    enabled: variant === "dashboard" && Boolean(session),
  });
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["workspace", "team", "platform", "settings", "project-core"]));
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const previousFocus = returnFocusRef.current ?? (document.activeElement as HTMLElement | null);
    const firstFocusable = drawerRef.current?.querySelector<HTMLElement>("button, a, input, select, textarea, [tabindex]:not([tabindex='-1'])");
    firstFocusable?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setDrawerOpen(false);
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;

      const focusables = Array.from(drawerRef.current.querySelectorAll<HTMLElement>("button, a, input, select, textarea, [tabindex]:not([tabindex='-1'])"))
        .filter((el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true");

      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
      returnFocusRef.current = null;
    };
  }, [drawerOpen]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 769px)");
    const closeOnDesktop = () => { if (desktop.matches) setDrawerOpen(false); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  const hasTeamAdminAccess = session?.user.globalRole === "platform_super_admin"
    || (teamsQuery.data ?? []).some((team) => team.canManage);

  const dashboardNav: NavItem[] = [
    {
      id: "workspace",
      type: "section",
      label: t("nav.workspace"),
      children: [
        { id: "overview", type: "link", label: t("nav.projects"), href: "/dashboard", icon: <NavIcon><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 9h18M8 4v5" /></NavIcon> },
      ],
    },
    ...(hasTeamAdminAccess
      ? [{
          id: "team",
          type: "section" as const,
          label: t("nav.team"),
          children: [
            { id: "team-members", type: "link" as const, label: t("nav.teamMembers"), href: "/dashboard/team", icon: <NavIcon><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M21 20v-2a6 6 0 0 0-4-5.65" /></NavIcon> },
            { id: "team-settings", type: "link" as const, label: t("nav.teamSettings"), href: "/dashboard/team/settings", icon: <NavIcon><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" fill="var(--bg-surface)" /><circle cx="15" cy="17" r="3" fill="var(--bg-surface)" /></NavIcon> },
          ],
        }]
      : []),
    ...(session?.user.globalRole === "platform_super_admin"
      ? [{
          id: "platform",
          type: "section" as const,
          label: t("nav.platformAdmin"),
          children: [
            { id: "platform-overview", type: "link" as const, label: t("nav.platformAdmin"), href: "/dashboard/platform", icon: <NavIcon><path d="M12 3l8 4v5c0 4-4 7-8 9-4-2-8-5-8-9V7zM8 12l3 3 5-6" /></NavIcon> },
          ],
        }]
      : []),
    {
      id: "settings",
      type: "section",
      label: t("nav.settings"),
      children: [
        { id: "profile-settings", type: "link", label: t("nav.profileSettings"), href: "/dashboard/settings/profile", icon: <NavIcon><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></NavIcon> },
        { id: "language-settings", type: "link", label: t("nav.language"), href: "/dashboard/settings/language", icon: <NavIcon><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></NavIcon> },
      ],
    },
  ];

  const projectNav: NavItem[] = projectId ? [
    { id: "back", type: "link", label: t("nav.backToProjects"), href: "/dashboard", icon: <NavIcon><path d="M19 12H5m6-6-6 6 6 6" /></NavIcon> },
    {
      id: "project-core",
      type: "section",
      label: t("nav.project"),
      children: [
        { id: "p-info", type: "link", label: t("projectWorkspace.workspace.modeInfo"), href: `/projects/${projectId}/workspace?mode=info`, icon: <NavIcon><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M8 8h8M8 12h8M8 16h4" /></NavIcon> },
        { id: "p-workspace", type: "link", label: t("projectWorkspace.workspace.modeDocument"), href: `/projects/${projectId}/workspace?mode=document`, icon: <NavIcon><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5" /></NavIcon> },
      ],
    }
  ] : dashboardNav;

  const navSections = variant === "project" ? projectNav : dashboardNav;

  function toggleSection(sectionId: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }

  function openDrawer(trigger?: HTMLElement | null) {
    returnFocusRef.current = trigger ?? null;
    setDrawerOpen(true);
  }
  function closeDrawer() {
    setDrawerOpen(false);
  }

  function renderNavItem(item: NavItem, level = 0) {
    const isExpanded = expandedSections.has(item.id);
    const hasChildren = item.children && item.children.length > 0;

    if (item.type === "section" && hasChildren) {
      return (
        <div key={item.id} className="nav-section">
          <button type="button" className="nav-section-header" onClick={() => toggleSection(item.id)} aria-expanded={isExpanded}>
            <span className="nav-section-label">{item.label}</span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={`nav-chevron${isExpanded ? " expanded" : ""}`} aria-hidden="true">
              <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          {isExpanded && (
            <div className="nav-section-children">
              {item.children?.map((child) => renderNavItem(child, level + 1))}
            </div>
          )}
        </div>
      );
    }

    if (item.type === "link" && item.href) {
      return (
        <Suspense key={item.id} fallback={<Link href={item.href as Route} className={`nav-item level-${level}`}>{item.icon}<span>{item.label}</span></Link>}>
          <SidebarNavLink item={item} level={level} onNavigate={closeDrawer} />
        </Suspense>
      );
    }
    return null;
  }

  const isGlobalAdmin = session?.user.globalRole === "platform_super_admin";

  const highestTeamRole = (() => {
    if (isGlobalAdmin) return null;
    const roles = (teamsQuery.data ?? []).map((team) => team.currentUserRole).filter(Boolean);
    if (roles.includes("tenant_owner")) return "tenant_owner" as const;
    if (roles.includes("tenant_admin")) return "tenant_admin" as const;
    return null;
  })();

  const isTeamAdmin = highestTeamRole === "tenant_owner" || highestTeamRole === "tenant_admin";

  function getRoleBadgeLabel(): string | null {
    if (isGlobalAdmin) return t("nav.globalAdminBadge");
    if (highestTeamRole === "tenant_owner") return t("nav.teamOwnerBadge");
    if (highestTeamRole === "tenant_admin") return t("nav.teamAdminBadge");
    return null;
  }

  function getAvatarClass(): string {
    if (isGlobalAdmin) return "app-sidebar-avatar app-sidebar-avatar--admin";
    if (isTeamAdmin) return "app-sidebar-avatar app-sidebar-avatar--team-admin";
    return "app-sidebar-avatar";
  }

  function renderSidebarFooter() {
    const roleBadgeLabel = getRoleBadgeLabel();
    const badgeClass = isGlobalAdmin ? "app-sidebar-admin-badge" : "app-sidebar-admin-badge app-sidebar-admin-badge--team";

    return (
      <div className="app-sidebar-footer">
        {session && (
          <div className="app-sidebar-user">
            <div className={getAvatarClass()} aria-hidden="true">
              {isGlobalAdmin ? (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M8 1L10.2 5.5L15 6.2L11.5 9.6L12.4 14.4L8 12.1L3.6 14.4L4.5 9.6L1 6.2L5.8 5.5L8 1Z" fill="currentColor" />
                </svg>
              ) : isTeamAdmin ? (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M8 2L9.5 6H13.5L10.2 8.5L11.4 12.5L8 10L4.6 12.5L5.8 8.5L2.5 6H6.5L8 2Z" stroke="currentColor" strokeWidth="1.2" fill="none" />
                </svg>
              ) : (
                session.user.displayName.slice(0, 2).toUpperCase()
              )}
            </div>
            <div className="app-sidebar-user-info">
              <div className="app-sidebar-user-name">
                {session.user.displayName}
                {roleBadgeLabel && (
                  <span className={badgeClass}>{roleBadgeLabel}</span>
                )}
              </div>
              <div className="app-sidebar-user-email">{session.user.email}</div>
            </div>
          </div>
        )}
        <ConfirmAction
          label={t("common.signOut")}
          confirmLabel={t("common.confirmSignOut")}
          tone="neutral"
          onConfirm={() => {
            clearSession();
            closeDrawer();
            router.replace("/login");
          }}
        />
      </div>
    );
  }

  function renderDrawerContent() {
    return (
      <div id="app-navigation-drawer" className="app-drawer__body" ref={drawerRef} role="dialog" aria-modal="true" aria-label={t("common.primaryNavigation")}>
        <div className="app-drawer__header">
          <Link href="/dashboard" className="app-sidebar-logo-mark" style={{ textDecoration: "none" }}>DRAMAFLOW</Link>
          <button className="btn btn-ghost btn-sm" type="button" onClick={closeDrawer} aria-label={t("common.closeNavigation")}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2 2L14 14M14 2L2 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <nav className="app-sidebar-nav" aria-label={t("common.primaryNavigation")}>
          {navSections.map(item => renderNavItem(item, 0))}
        </nav>
        {renderSidebarFooter()}
      </div>
    );
  }

  const isFlush = flush || (pathname && pathname.match(/\/projects\/[^\/]+\/workspace$/));

  return (
    <div className="app-layout">
      <a className="skip-link" href="#app-main">{t("common.skipToMain")}</a>
      <aside className="app-sidebar" inert={drawerOpen}>
        <div className="app-sidebar-logo">
          <Link href="/dashboard" className="app-sidebar-logo-mark" style={{ textDecoration: "none" }}>DRAMAFLOW</Link>
        </div>
        <nav className="app-sidebar-nav" aria-label={t("common.primaryNavigation")}>
          {navSections.map(item => renderNavItem(item, 0))}
        </nav>
        {renderSidebarFooter()}
      </aside>
      {drawerOpen && (
        <div className="app-drawer-shell">
          <button className="app-drawer-backdrop" type="button" aria-label={t("common.closeNavigation")} onClick={closeDrawer} />
          {renderDrawerContent()}
        </div>
      )}
      <main id="app-main" className="app-main" tabIndex={-1} inert={drawerOpen}>
        <header className="app-topbar">
          <div className="app-topbar-heading">
            <button className="btn btn-ghost app-navigation-trigger mobile-only" type="button" onClick={(e) => openDrawer(e.currentTarget)} aria-label={t("common.openNavigation")} aria-expanded={drawerOpen} aria-controls={drawerOpen ? "app-navigation-drawer" : undefined}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path d="M2 4h14M2 9h14M2 14h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            <span className="app-topbar-title">{variant === "project" ? t("nav.project") : t("nav.workspace")}</span>
          </div>
          <div className="app-topbar-actions">
            <RealtimeStatus />
            <NotificationBell />
            <LanguageSwitcher style={{ width: "auto" }} />
          </div>
        </header>
        <div className={isFlush ? "app-content--flush" : "app-content"}>
          {children}
        </div>
      </main>
    </div>
  );
}
