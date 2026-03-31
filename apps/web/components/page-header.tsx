import type { ReactNode } from "react";

interface PageHeaderProps {
  kicker: string;
  title: string;
  description: string;
  actions?: ReactNode;
}

export function PageHeader({ kicker, title, description, actions }: PageHeaderProps) {
  return (
    <section className="page-header">
      <div>
        <span className="kicker">{kicker}</span>
        <h1 className="page-title">{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {actions ? <div className="inline inline-gap-3">{actions}</div> : null}
    </section>
  );
}