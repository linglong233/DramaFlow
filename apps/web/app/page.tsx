"use client";

import Link from "next/link";
import { useI18n } from "../lib/i18n";
import { useSession } from "../lib/use-session";
import { LanguageSwitcher } from "../components/language-switcher";

export default function HomePage() {
  const { t } = useI18n();
  const { session, ready } = useSession();
  const isLoggedIn = ready && Boolean(session);
  const stages = [
    { title: t("home.workflowStory"), description: t("home.workflowStoryDescription") },
    { title: t("home.workflowVisual"), description: t("home.workflowVisualDescription") },
    { title: t("home.workflowTeam"), description: t("home.workflowTeamDescription") },
  ];

  return (
    <div className="studio-landing">
      <header className="studio-public-header">
        <Link href="/" className="studio-wordmark">DRAMAFLOW<span aria-hidden="true">/</span></Link>
        <div className="studio-public-actions">
          <LanguageSwitcher style={{ width: "auto" }} />
          {ready && <Link href={isLoggedIn ? "/dashboard" : "/login"} className="btn btn-secondary">{isLoggedIn ? t("nav.workspace") : t("common.signIn")}</Link>}
        </div>
      </header>
      <main className="studio-landing-main">
        <section className="studio-hero">
          <div className="studio-hero-copy">
            <span className="studio-eyebrow">DramaFlow Studio</span>
            <h1><span>{t("home.title")}</span><span>{t("home.titleSecondLine")}</span></h1>
            <p>{t("home.description")}</p>
            <Link href={isLoggedIn ? "/dashboard" : "/login"} className="btn btn-primary studio-hero-cta">
              {isLoggedIn ? t("common.openWorkspace") : t("home.primaryAction")}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </Link>
          </div>
          <div className="studio-hero-art studio-production-preview" aria-label={t("home.previewLabel")}>
            <div className="studio-preview-topline"><span>DRAMAFLOW / STUDIO</span><span>{t("home.previewLabel")}</span></div>
            <div className="studio-preview-script">
              <span className="studio-preview-step" aria-hidden="true">01</span>
              <div className="studio-preview-script-copy"><h2>{t("home.workflowStory")}</h2><p>{t("home.previewScriptMeta")}</p></div>
              <div className="studio-preview-page" aria-hidden="true"><span /><span /><span /><span /></div>
            </div>
            <div className="studio-preview-connector" aria-hidden="true"><span /><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 2v11m-4-4 4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
            <div className="studio-preview-storyboard">
              <div className="studio-preview-section-heading"><span className="studio-preview-step" aria-hidden="true">02</span><h2>{t("home.workflowVisual")}</h2><span className="studio-preview-meta">{t("home.previewStoryboardMeta")}</span></div>
              <div className="studio-preview-shots" aria-hidden="true">
                <div className="studio-preview-shot">
                  <svg viewBox="0 0 220 140" fill="none"><rect width="220" height="140" fill="#0e2330" /><circle cx="172" cy="31" r="19" fill="#38bdf8" opacity=".11" /><path d="M0 100 61 76 110 90 163 68 220 87v53H0z" fill="#122f3e" /><path d="M0 120 94 88 220 125M0 139 97 91 154 140" stroke="#326176" strokeWidth="1" /><path d="M22 106V43h32v51m3-1V57h25v27m58 24V54h21v63m3 1V37h31v71" stroke="#5b7f8e" strokeWidth="1.5" /><path d="M31 53h13m-13 9h13m-13 9h13m104-7h6m-6 9h6m18-26h12m-12 9h12m-12 9h12" stroke="#73b1c6" strokeWidth="2" opacity=".6" /><circle cx="111" cy="95" r="4" fill="#b0d7e6" /><path d="M111 101v12m0-8-6 5m6-5 5 5m-5 3-4 10m4-10 4 10" stroke="#b0d7e6" strokeWidth="2" strokeLinecap="round" /><path d="M12 24V12h16m164 0h16v12M12 116v12h16m164 0h16v-12" stroke="#64a3bd" opacity=".6" /></svg>
                  <span>SHOT 01 <i /></span>
                </div>
                <div className="studio-preview-shot">
                  <svg viewBox="0 0 220 140" fill="none"><rect width="220" height="140" fill="#191d32" /><path d="M26 140V40h87v100M35 140V49h68v91" stroke="#575777" strokeWidth="1.5" /><path d="m103 49 35-19v110h-35z" fill="#31304a" /><path d="M143 115h77v25h-77z" fill="#25283f" /><path d="M157 63h50v43h-50zM153 111h59" stroke="#68647e" strokeWidth="1.4" /><path d="m163 83 19 12 19-12M163 79h38v22h-38z" stroke="#aba3d6" strokeWidth="1.5" /><path d="m112 54 20-11v76l-20 8" fill="#a78bfa" opacity=".13" /><circle cx="120" cy="88" r="2" fill="#c4b5fd" /><path d="M12 24V12h16m164 0h16v12M12 116v12h16m164 0h16v-12" stroke="#9688bc" opacity=".6" /></svg>
                  <span>SHOT 02 <i /></span>
                </div>
              </div>
            </div>
            <div className="studio-preview-connector" aria-hidden="true"><span /><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 2v11m-4-4 4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
            <div className="studio-preview-review"><span className="studio-preview-step" aria-hidden="true">03</span><div><h2>{t("home.workflowTeam")}</h2><p>{t("home.previewReviewMeta")}</p></div><svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 11h8m-8 4h5M6 4h9l4 4v12H5V4h1zm9 0v5h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
          </div>
        </section>
        <section className="studio-workflow" aria-labelledby="workflow-title">
          <div className="studio-workflow-heading"><h2 id="workflow-title">{t("home.workflowLabel")}</h2><p>{t("home.workflowDescription")}</p></div>
          <div className="studio-workflow-grid">
            {stages.map((stage, index) => <article key={stage.title}><span className="studio-stage-number">0{index + 1}</span><h3>{stage.title}</h3><p>{stage.description}</p></article>)}
          </div>
        </section>
      </main>
      <footer className="studio-public-footer"><span>DramaFlow</span><span>{t("login.brandSubtitle")}</span></footer>
    </div>
  );
}

