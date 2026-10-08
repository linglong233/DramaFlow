"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { useI18n } from "../lib/i18n";
import { LanguageSwitcher } from "./language-switcher";

export function AuthShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();

  return (
    <div className="studio-auth">
      <header className="studio-public-header">
        <Link href="/" className="studio-wordmark">DRAMAFLOW<span aria-hidden="true">/</span></Link>
        <LanguageSwitcher style={{ width: "auto" }} />
      </header>
      <main className="studio-auth-main">
        <aside className="studio-auth-story">
          <span className="studio-eyebrow">DramaFlow Studio</span>
          <h2>{t("home.workflowLabel")}</h2>
          <p>{t("home.workflowDescription")}</p>
          <div className="studio-auth-stages">
            {[t("home.workflowStory"), t("home.workflowVisual"), t("home.workflowTeam")].map((label, index) => (
              <div key={label}><span>0{index + 1}</span>{label}</div>
            ))}
          </div>
          <div className="studio-auth-frame" aria-hidden="true"><span /><span /><span /><span /></div>
        </aside>
        <section className="studio-auth-card">
          <div className="studio-auth-card-brand">DramaFlow<span>{t("login.brandSubtitle")}</span></div>
          {children}
        </section>
      </main>
    </div>
  );
}
