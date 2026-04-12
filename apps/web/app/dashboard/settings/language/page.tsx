/**
 * @fileoverview 语言设置页
 * @module web/app/dashboard/settings
 *
 * 用户界面语言偏好设置。
 */

"use client";

import { useI18n } from "../../../../lib/i18n";
import { PageHeader } from "../../../../components/page-header";
import { LanguageSwitcher } from "../../../../components/language-switcher";

export default function DashboardLanguageSettingsPage() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader kicker={t("settingsPages.language.kicker")} title={t("nav.language")} description={t("settingsPages.language.description")} />
      <div className="card card-sm">
        <h3 className="heading-6" style={{ marginBottom: "16px" }}>{t("settingsPages.language.selectorTitle")}</h3>
        <LanguageSwitcher />
      </div>
    </>
  );
}
