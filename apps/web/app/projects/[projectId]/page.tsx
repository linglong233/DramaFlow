/**
 * @fileoverview 项目详情页
 * @module web/app/projects
 *
 * 项目概览和快速入口。
 */

import { redirect } from "next/navigation";

export default async function ProjectPage(props: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await props.params;
  redirect(`/projects/${projectId}/workspace`);
}