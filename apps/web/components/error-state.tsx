/**
 * @fileoverview 错误状态组件
 * @module web/components
 *
 * 请求失败或异常时的友好提示。
 */

import type { ReactNode } from "react";

interface ErrorStateProps {
  title: string;
  description: string;
  action?: ReactNode;
}

export function ErrorState({ title, description, action }: ErrorStateProps) {
  return (
    <div className="error-state" role="alert">
      <span className="error-state__icon" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="m12 3 10 17H2L12 3Z" />
          <path d="M12 9v4m0 3h.01" />
        </svg>
      </span>
      <div className="error-state-title">{title}</div>
      {description && <div className="error-state-description">{description}</div>}
      {action ? <div className="error-state__action">{action}</div> : null}
    </div>
  );
}
