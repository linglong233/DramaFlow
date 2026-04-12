/**
 * @fileoverview 个人设置页
 * @module web/app/dashboard/settings
 *
 * 用户个人信息和 LLM 配置管理。
 */

import type { Metadata } from "next";

import { ProfileSettingsPanel } from "../../../../components/profile-settings-panel";

export const metadata: Metadata = {
  title: "Profile Settings",
};

export default function ProfileSettingsPage() {
  return <ProfileSettingsPanel />;
}
