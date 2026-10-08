/**
 * @fileoverview 空状态组件
 * @module web/components
 *
 * 数据为空时的友好提示占位。
 */

import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 7h6l2 2h8v10H4z" />
          <path d="M4 7V5h6l2 2h8v2M9 14h6" />
        </svg>
      </span>
      <div className="empty-state-title">{title}</div>
      {description && <div className="empty-state-description">{description}</div>}
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}
