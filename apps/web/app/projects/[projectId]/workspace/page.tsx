/**
 * @fileoverview 统一工作区页
 * @module web/app/projects
 *
 * 项目文档和生成的统一工作区入口。
 */

import { use, Suspense } from "react";
import { UnifiedWorkspace } from "../../../../components/unified-workspace";

function WorkspaceContent({ projectId }: { projectId: string }) {
  return <UnifiedWorkspace projectId={projectId} />;
}

export default function WorkspacePage(props: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(props.params);
  return (
    <Suspense>
      <WorkspaceContent projectId={projectId} />
    </Suspense>
  );
}
