import type { Metadata } from "next";

import { ProfileSettingsPanel } from "../../../../components/profile-settings-panel";

export const metadata: Metadata = {
  title: "Profile Settings",
};

export default function ProfileSettingsPage() {
  return <ProfileSettingsPanel />;
}
