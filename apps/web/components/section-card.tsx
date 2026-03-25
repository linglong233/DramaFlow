import type { ReactNode } from "react";

interface SectionCardProps {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

export function SectionCard({ title, description, children, className }: SectionCardProps) {
  return (
    <section className={className ? `section-card ${className}` : "section-card"}>
      {title || description ? (
        <div className="section-card__header">
          {title ? <h2>{title}</h2> : null}
          {description ? <p className="muted">{description}</p> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}