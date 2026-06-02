/**
 * 小说导入工作台（占位组件，Task 6 将替换为完整实现）
 */
import type { ProjectWorkspacePayload } from "@dramaflow/shared";

interface NovelImportWorkbenchProps {
  projectId: string;
  project: ProjectWorkspacePayload;
}

export function NovelImportWorkbench({ projectId }: NovelImportWorkbenchProps) {
  return (
    <div className="novel-import-workbench">
      <p style={{ padding: "1rem", color: "var(--text-secondary)" }}>
        小说导入工作台（开发中）
      </p>
    </div>
  );
}
