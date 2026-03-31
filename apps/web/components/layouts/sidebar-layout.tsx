"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { clearSession } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { useSession } from "../../lib/use-session";
import { ConfirmAction } from "../confirm-action";
import { LanguageSwitcher } from "../language-switcher";

type NavItemType = "link" | "section";

interface NavItem {
  id: string;
  type: NavItemType;
  label: string;
  href?: string;
  children?: NavItem[];
}

interface SidebarLayoutProps {
  children: ReactNode;
  variant: "dashboard" | "project";
  projectId?: string;
}

export function SidebarLayout({ children, variant, projectId }: SidebarLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { session } = useSession();
  const { t } = useI18n();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["workspace", "team", "project-core"]));
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen || typeof document === "undefined") {
      document.body.style.overflow = "";
      return;
    }
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
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
      returnFocusRef.current = null;
    };
  }, [drawerOpen]);

  const dashboardNav: NavItem[] = [
    {
      id: "workspace",
      type: "section",
      label: t("nav.workspace"),
      children: [
        { id: "overview", type: "link", label: t("nav.overview"), href: "/dashboard" },
        { id: "projects", type: "link", label: t("nav.projects"), href: "/dashboard/projects" },
      ],
    },
    {
      id: "team",
      type: "section",
      label: t("nav.team"),
      children: [
        { id: "team-members", type: "link", label: t("nav.teamMembers"), href: "/dashboard/team" },
        { id: "team-settings", type: "link", label: t("nav.teamSettings"), href: "/dashboard/team/settings" },
      ],
    },
    {
      id: "settings",
      type: "section",
      label: t("nav.settings"),
      children: [
        { id: "language-settings", type: "link", label: t("nav.language"), href: "/dashboard/settings/language" },
      ],
    },
  ];

  const projectNav: NavItem[] = projectId ? [
    {
      id: "project-core",
      type: "section",
      label: "Project",
      children: [
        { id: "back", type: "link", label: "← " + t("nav.overview"), href: "/dashboard" },
        { id: "p-overview", type: "link", label: t("nav.overview"), href: `/projects/${projectId}` },
        { id: "p-drafts", type: "link", label: t("projectWorkspace.tabs.draft") || "Drafts", href: `/projects/${projectId}/drafts` },
        { id: "p-generate", type: "link", label: t("projectWorkspace.tabs.generate") || "Generate", href: `/projects/${projectId}/generate` },
        { id: "p-review", type: "link", label: "Review", href: `/projects/${projectId}/review` },
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
          <button className="nav-section-header" onClick={() => toggleSection(item.id)} aria-expanded={isExpanded}>
            <span className="nav-section-label">{item.label}</span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={`nav-chevron${isExpanded ? " expanded" : ""}`} aria-hidden="true">
              <path d={isExpanded ? "M4 10l4-4 4 4" : "M6 4l4 4-4 4"} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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
      let isActive = false;
      if (item.href === "/dashboard") {
        isActive = pathname === "/dashboard";
      } else if (projectId && item.href === `/projects/${projectId}`) {
        isActive = pathname === `/projects/${projectId}`;
      } else {
        isActive = pathname.startsWith(item.href);
      }
      
      return (
        <Link key={item.id} href={item.href as any} className={`nav-item${isActive ? " active" : ""} level-${level}`} aria-current={isActive ? "page" : undefined}>
          {item.label}
        </Link>
      );
    }
    return null;
  }

  function renderSidebarFooter() {
    return (
      <div className="app-sidebar-footer">
        {session && (
          <div className="app-sidebar-user">
            <div className="app-sidebar-avatar" aria-hidden="true">
              {session.user.displayName.slice(0, 2).toUpperCase()}
            </div>
            <div className="app-sidebar-user-info">
              <div className="app-sidebar-user-name">{session.user.displayName}</div>
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
      <div className="app-drawer__body" ref={drawerRef} role="dialog" aria-modal="true" aria-label={t("common.openNavigation")}>
        <div className="app-drawer__header">
          <Link href="/dashboard" className="app-sidebar-logo-mark" style={{ textDecoration: "none" }}>DRAMAFLOW</Link>
          <button className="btn btn-ghost btn-sm" type="button" onClick={closeDrawer} aria-label={t("common.closeNavigation")}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2 2L14 14M14 2L2 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="app-sidebar-nav" style={{ padding: "16px 12px" }}>
          {navSections.map(item => renderNavItem(item, 0))}
        </div>
        {renderSidebarFooter()}
      </div>
    );
  }

  return (
    <div className="app-layout">
      <a className="skip-link" href="#app-main">{t("common.skipToMain")}</a>
      <aside className="app-sidebar">
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
      <main id="app-main" className="app-main">
        <header style={{
            position: "sticky", top: 0, zIndex: 10, display: "flex", alignItems: "center", padding: "0 16px",
            height: "56px", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-surface)", justifyContent: "space-between",
          }}
        >
          <div className="mobile-only" style={{ display: "flex", alignItems: "center" }}>
            <button className="btn btn-ghost btn-sm" type="button" onClick={(e) => openDrawer(e.currentTarget)} aria-label={t("common.openNavigation")} style={{ marginLeft: "-8px" }}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path d="M2 4h14M2 9h14M2 14h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-secondary)", marginLeft: "8px" }}>DramaFlow</span>
          </div>
          <LanguageSwitcher style={{ width: "auto", marginLeft: "auto" }} />
        </header>
        <div className="app-content">
          {children}
        </div>
      </main>
    </div>
  );
}
