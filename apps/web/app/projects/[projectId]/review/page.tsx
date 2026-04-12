/**
 * @fileoverview 审核页
 * @module web/app/projects
 *
 * 版本审核和审批流程。
 */

import { redirect } from "next/navigation";

export default async function ProjectReviewPage(props: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await props.params;
  redirect(`/projects/${projectId}/workspace?mode=document`);
}
