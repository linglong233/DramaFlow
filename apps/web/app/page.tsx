"use client";

import Link from "next/link";
import { useI18n } from "../lib/i18n";
import { LanguageSwitcher } from "../components/language-switcher";

export default function HomePage() {
  const { t } = useI18n();

  return (
    <div className="login-container" style={{ position: "relative", overflow: "hidden", minHeight: "100vh" }}>
      {/* Cinematic Studio Lights */}
      <div style={{ position: "absolute", top: "-20%", left: "-10%", width: "50%", height: "50%", background: "radial-gradient(circle, rgba(56,189,248,0.2), transparent 70%)", filter: "blur(60px)", zIndex: 0 }} />
      <div style={{ position: "absolute", bottom: "-20%", right: "-10%", width: "50%", height: "50%", background: "radial-gradient(circle, rgba(168,85,247,0.2), transparent 70%)", filter: "blur(60px)", zIndex: 0 }} />
      
      <main className="app-main animate-fade-in" style={{ margin: 0, position: "relative", zIndex: 10, display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <header className="glass-panel" style={{
            display: "flex", alignItems: "center", padding: "0 24px",
            height: "72px", justifyContent: "space-between", margin: "16px", borderRadius: "16px", border: "1px solid rgba(255,255,255,0.05)"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <span className="app-sidebar-logo-mark" style={{ letterSpacing: "2px", fontWeight: 800, fontSize: "16px" }}>DRAMAFLOW</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <LanguageSwitcher style={{ width: "auto" }} />
          </div>
        </header>

        <div className="app-content landing-hero animate-slide-up" style={{ margin: "auto", flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <h1 className="landing-hero-title">
            {t("home.title")}
          </h1>
          <p className="landing-hero-description" style={{ fontSize: "18px" }}>
            {t("home.description")}
          </p>
          <div className="landing-cta" style={{ marginTop: "32px" }}>
            <Link href="/login" className="btn btn-primary" style={{ height: "48px", padding: "0 32px", fontSize: "16px", borderRadius: "24px" }}>
              {t("home.primaryAction")}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
