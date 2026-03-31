import { use } from "react";
import { ProjectDrafts } from "../../../../components/project-drafts";

export default function ProjectDraftsPage(props: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(props.params);
  return <ProjectDrafts projectId={projectId} />;
}
