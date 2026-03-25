import { AppShell } from "../../components/app-shell";
import { DashboardOverview } from "../../components/dashboard-overview";

export default function DashboardPage() {
  return (
    <AppShell requireAuth>
      <DashboardOverview />
    </AppShell>
  );
}