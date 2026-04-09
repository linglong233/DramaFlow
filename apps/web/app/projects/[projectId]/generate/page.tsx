import { redirect } from "next/navigation";

export default async function ProjectGeneratePage(props: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await props.params;
  redirect(`/projects/${projectId}/workspace?mode=generate`);
}
