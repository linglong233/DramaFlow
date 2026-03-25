import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">...</div>
      <div className="stack stack--tight">
        <strong>{title}</strong>
        <p className="muted">{description}</p>
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  );
}