import { NavigationShell } from "../../../components/navigation-shell";
import { ProjectWorkspace } from "../../../components/project-workspace";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return (
    <NavigationShell>
      <ProjectWorkspace projectId={projectId} />
    </NavigationShell>
  );
}

