"use client";

import { useI18n } from "../../lib/i18n";
import { ForgotPasswordForm } from "../../components/forgot-password-form";
import { LanguageSwitcher } from "../../components/language-switcher";

export default function ForgotPasswordPage() {
  const { t } = useI18n();

  return (
    <div className="login-container" style={{ position: "relative", overflow: "hidden" }}>
      {/* Background ambient light */}
      <div style={{ position: "absolute", top: "-20%", left: "-10%", width: "50%", height: "50%", background: "radial-gradient(circle, rgba(56,189,248,0.15), transparent 70%)", filter: "blur(60px)", zIndex: 0 }} />
      <div style={{ position: "absolute", bottom: "-20%", right: "-10%", width: "50%", height: "50%", background: "radial-gradient(circle, rgba(168,85,247,0.15), transparent 70%)", filter: "blur(60px)", zIndex: 0 }} />
      
      <div style={{ position: "absolute", top: 16, right: 16, zIndex: 10 }}>
        <LanguageSwitcher style={{ width: "auto" }} />
      </div>
      
      <div className="login-card glass-panel animate-fade-in" style={{ position: "relative", zIndex: 10, padding: "var(--space-8)" }}>
        <div style={{ textAlign: "center", marginBottom: "var(--space-6)" }}>
          <h1 className="login-title" style={{ margin: 0 }}>DramaFlow</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginTop: "4px" }}>{t("login.brandSubtitle")}</p>
        </div>
        <ForgotPasswordForm />
      </div>
    </div>
  );
}