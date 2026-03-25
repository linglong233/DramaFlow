import type { ReactNode } from "react";

interface PageHeaderProps {
  kicker: string;
  title: string;
  description: string;
  actions?: ReactNode;
}

export function PageHeader({ kicker, title, description, actions }: PageHeaderProps) {
  return (
    <section className="hero-panel">
      <div className="hero-panel__body">
        <span className="kicker">{kicker}</span>
        <h1 className="page-title">{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {actions ? <div className="hero-panel__actions">{actions}</div> : null}
    </section>
  );
}