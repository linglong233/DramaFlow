import { AppShell } from "../../../components/app-shell";
import { TeamAdminPanel } from "../../../components/team-admin-panel";

export default function TeamAdminPage() {
  return (
    <AppShell requireAuth>
      <TeamAdminPanel />
    </AppShell>
  );
}