import { AuthGuard } from "../../components/layouts/auth-guard";
import { SidebarLayout } from "../../components/layouts/sidebar-layout";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <SidebarLayout variant="dashboard">
        {children}
      </SidebarLayout>
    </AuthGuard>
  );
}
