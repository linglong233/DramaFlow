import { use } from "react";
import { ProjectGenerate } from "../../../../components/project-generate";

export default function ProjectGeneratePage(props: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(props.params);
  return <ProjectGenerate projectId={projectId} />;
}
