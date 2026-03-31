import { use } from "react";
import { ProjectOverview } from "../../../components/project-overview";

export default function ProjectPage(props: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(props.params);

  return <ProjectOverview projectId={projectId} />;
}