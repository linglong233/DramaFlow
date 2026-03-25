"use client";

import { AppShell } from "../../components/app-shell";
import { LoginPanel } from "../../components/login-panel";
import { useI18n } from "../../lib/i18n";

export default function LoginPage() {
  const { t } = useI18n();

  return (
    <AppShell variant="public">
      <section className="auth-layout">
        <div className="hero-panel hero-panel--auth">
          <div className="hero-panel__body">
            <span className="kicker">{t("login.kicker")}</span>
            <h1 className="page-title">{t("login.title")}</h1>
            <p className="page-description">{t("login.description")}</p>
          </div>
        </div>
        <LoginPanel />
      </section>
    </AppShell>
  );
}