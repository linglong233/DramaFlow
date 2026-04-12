/**
 * @fileoverview AI 生成页
 * @module web/app/projects
 *
 * AI 剧本/分镜/图片生成工作区。
 */

import { redirect } from "next/navigation";

export default async function ProjectGeneratePage(props: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await props.params;
  redirect(`/projects/${projectId}/workspace?mode=document&sub=generate`);
}
