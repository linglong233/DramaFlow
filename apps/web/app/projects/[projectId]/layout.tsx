import { AuthGuard } from "../../../components/layouts/auth-guard";
import { SidebarLayout } from "../../../components/layouts/sidebar-layout";

export default async function ProjectLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return (
    <AuthGuard>
      <SidebarLayout variant="project" projectId={projectId}>
        {children}
      </SidebarLayout>
    </AuthGuard>
  );
}
