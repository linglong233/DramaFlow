/**
 * @fileoverview 页面标题头
 * @module web/components
 *
 * 通用的页面标题和面包屑组件。
 */

import type { ReactNode } from "react";

interface PageHeaderProps {
  kicker: string;
  title: string;
  description: string;
  actions?: ReactNode;
}

export function PageHeader({ kicker, title, description, actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header__content">
        <span className="kicker">{kicker}</span>
        <h1 className="page-title">{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}
