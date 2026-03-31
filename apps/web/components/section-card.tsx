import type { ReactNode } from "react";

interface SectionCardProps {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
  variant?: "default" | "summary" | "utility";
  actions?: ReactNode;
}

export function SectionCard({
  title,
  description,
  children,
  className,
  variant = "default",
  actions,
}: SectionCardProps) {
  const baseClassName = `section-card section-card--${variant}`;
  const resolvedClassName = className ? `${baseClassName} ${className}` : baseClassName;

  return (
    <section className={resolvedClassName}>
      {title || description ? (
        <div className="section-card__header">
          <div>
            {title ? <h2>{title}</h2> : null}
            {description ? <p className="muted">{description}</p> : null}
          </div>
          {actions ? <div className="section-card__actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className="section-card__body">{children}</div>
    </section>
  );
}