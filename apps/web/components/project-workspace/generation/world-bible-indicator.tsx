"use client";

import { normalizeWorldBibleContent, type ProjectWorkspacePayload } from "@dramaflow/shared";

interface Props {
  project: ProjectWorkspacePayload;
}

export function WorldBibleIndicator({ project }: Props) {
  const wb = normalizeWorldBibleContent(project.worldBible);
  const charCount = wb.characters.length;
  const locCount = wb.locations.length;
  const hasStyle = Boolean(wb.styleGuide?.visualStyle);

  if (charCount === 0 && locCount === 0 && !hasStyle) return null;

  const parts: string[] = [];
  if (charCount > 0) parts.push(`${charCount} 角色已设定`);
  if (locCount > 0) parts.push(`${locCount} 场景已设定`);
  if (hasStyle) parts.push("视觉风格已设定");

  return (
    <div className="wb-indicator">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
      <span className="wb-indicator__text">
        世界观已关联：{parts.join("，")}
      </span>
    </div>
  );
}
