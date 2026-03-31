import { use } from "react";
import { ProjectReview } from "../../../../components/project-review";

export default function ProjectReviewPage(props: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(props.params);
  return <ProjectReview projectId={projectId} />;
}
