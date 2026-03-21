import { NavigationShell } from "../../components/navigation-shell";
import { DashboardOverview } from "../../components/dashboard-overview";

export default function DashboardPage() {
  return (
    <NavigationShell>
      <DashboardOverview />
    </NavigationShell>
  );
}

