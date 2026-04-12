/**
 * @fileoverview 版本草稿页
 * @module web/app/projects
 *
 * 文档版本管理和编辑。
 */

import { redirect } from "next/navigation";

export default async function ProjectDraftsPage(props: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await props.params;
  redirect(`/projects/${projectId}/workspace?mode=document`);
}
