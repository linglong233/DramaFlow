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
      <div className="error-state-title">{title}</div>
      {description && <div className="error-state-description">{description}</div>}
      {action}
    </div>
  );
}