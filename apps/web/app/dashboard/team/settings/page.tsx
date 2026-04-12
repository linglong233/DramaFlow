/**
 * @fileoverview 团队设置页
 * @module web/app/dashboard/team
 *
 * 团队名称、审核策略和 LLM/图片生成配置。
 */

import { TeamSettingsPanel } from "../../../../components/team-settings-panel";

export default function DashboardTeamSettingsPage() {
  return <TeamSettingsPanel />;
}