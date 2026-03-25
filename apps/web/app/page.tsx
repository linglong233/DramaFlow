"use client";

import Link from "next/link";

import { AppShell } from "../components/app-shell";
import { SectionCard } from "../components/section-card";
import { useI18n } from "../lib/i18n";

export default function HomePage() {
  const { t } = useI18n();

  return (
    <AppShell variant="public">
      <div className="stack stack--page">
        <section className="hero hero--landing">
          <SectionCard className="section-card--hero">
            <div className="stack">
              <span className="kicker">{t("home.kicker")}</span>
              <h1 className="headline">{t("home.title")}</h1>
              <p className="subhead">{t("home.description")}</p>
              <div className="cta-row">
                <Link className="primary-btn" href="/login">
                  {t("home.primaryAction")}
                </Link>
                <Link className="secondary-btn" href="/dashboard">
                  {t("home.secondaryAction")}
                </Link>
              </div>
            </div>
          </SectionCard>

          <div className="stack">
            <SectionCard>
              <div className="info-strip">
                <div className="info-card">
                  <strong>{t("home.scriptTitle")}</strong>
                  <p className="muted">{t("home.scriptDescription")}</p>
                </div>
                <div className="info-card">
                  <strong>{t("home.versionTitle")}</strong>
                  <p className="muted">{t("home.versionDescription")}</p>
                </div>
                <div className="info-card">
                  <strong>{t("home.storageTitle")}</strong>
                  <p className="muted">{t("home.storageDescription")}</p>
                </div>
              </div>
            </SectionCard>

            <SectionCard title={t("home.includesTitle")}>
              <div className="feature-list">
                <span>{t("home.includesAuth")}</span>
                <span>{t("home.includesGeneration")}</span>
                <span>{t("home.includesReview")}</span>
              </div>
            </SectionCard>
          </div>
        </section>
      </div>
    </AppShell>
  );
}