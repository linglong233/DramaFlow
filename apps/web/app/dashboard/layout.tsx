/**
 * @fileoverview 工作台布局
 * @module web/app/dashboard
 *
 * 工作台页面的侧边栏布局壳。
 */

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
