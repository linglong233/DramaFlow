import { redirect } from "next/navigation";

export default async function ProjectReviewPage(props: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await props.params;
  redirect(`/projects/${projectId}/workspace?mode=document`);
}
