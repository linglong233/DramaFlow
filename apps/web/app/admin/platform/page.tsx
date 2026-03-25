import { AppShell } from "../../../components/app-shell";
import { PlatformAdminOverview } from "../../../components/platform-admin-overview";

export default function PlatformAdminPage() {
  return (
    <AppShell requireAuth platformOnly>
      <PlatformAdminOverview />
    </AppShell>
  );
}