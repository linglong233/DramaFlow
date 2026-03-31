"use client";

import { useI18n } from "../../../../lib/i18n";
import { PageHeader } from "../../../../components/page-header";

export default function DashboardTeamSettingsPage() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader kicker="Settings" title={t("nav.teamSettings") || "Team Settings"} description="Configure your team workspace." />
      <div className="empty-state">
        <div className="empty-state-title">Coming Soon</div>
        <div className="empty-state-description">Team settings configuration will go here.</div>
      </div>
    </>
  );
}
