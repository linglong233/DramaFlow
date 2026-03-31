"use client";

import { useI18n } from "../../../../lib/i18n";
import { PageHeader } from "../../../../components/page-header";
import { LanguageSwitcher } from "../../../../components/language-switcher";

export default function DashboardLanguageSettingsPage() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader kicker="Preferences" title={t("nav.language") || "Language Settings"} description="Manage your preferred language for the interface." />
      <div className="card card-sm">
        <h3 className="heading-6" style={{ marginBottom: "16px" }}>Select Language</h3>
        <LanguageSwitcher />
      </div>
    </>
  );
}
