"use client";

import { useI18n } from "../../../lib/i18n";
import { PageHeader } from "../../../components/page-header";

export default function DashboardTeamPage() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader kicker="Team" title={t("nav.teamMembers") || "Team Members"} description="Manage your team members and their roles." />
      <div className="empty-state">
        <div className="empty-state-title">Coming Soon</div>
        <div className="empty-state-description">Team management features will go here.</div>
      </div>
    </>
  );
}
