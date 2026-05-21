"use client";

import type { ImpactIssueSummary } from "@dramaflow/shared";
import { useI18n } from "../../lib/i18n";

interface Props {
  issues: ImpactIssueSummary[];
  activeIssueId?: string;
  onSelectIssue?: (issueId: string) => void;
  onIgnore?: (issueId: string) => void;
  onReopen?: (issueId: string) => void;
  onResolve?: (issueId: string) => void;
  onSuggest?: (issueId: string) => void;
  isMutating?: boolean;
}

export function ImpactIssueList({
  issues,
  activeIssueId,
  onSelectIssue,
  onIgnore,
  onReopen,
  onResolve,
  onSuggest,
  isMutating,
}: Props) {
  const { t } = useI18n();

  if (issues.length === 0) {
    return <div className="impact-empty">{t("impact.empty")}</div>;
  }

  return (
    <div className="impact-list">
      {issues.map((issue) => (
        <div
          key={issue.id}
          className={`impact-row${activeIssueId === issue.id ? " impact-row--active" : ""}`}
          role={onSelectIssue ? "button" : undefined}
          tabIndex={onSelectIssue ? 0 : undefined}
          onClick={() => onSelectIssue?.(issue.id)}
          onKeyDown={(event) => {
            if (!onSelectIssue) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelectIssue(issue.id);
            }
          }}
        >
          <div className="impact-row__main">
            <span className={`impact-badge impact-badge--${issue.status}`}>
              {t(`impact.status.${issue.status}` as any)}
            </span>
            <span className={`impact-severity impact-severity--${issue.severity}`}>
              {t(`impact.severity.${issue.severity}` as any)}
            </span>
            <strong className="impact-row__title">{issue.title}</strong>
            <span className="impact-row__summary">{issue.summary}</span>
          </div>
          <div className="impact-row__actions" onClick={(event) => event.stopPropagation()}>
            {(issue.status === "ignored" || issue.status === "resolved") && onReopen ? (
              <button className="btn btn-secondary btn-sm" type="button" disabled={isMutating} onClick={() => onReopen(issue.id)}>
                {t("impact.actions.reopen")}
              </button>
            ) : null}
            {(issue.status === "open" || issue.status === "suggested") && onSuggest ? (
              <button className="btn btn-secondary btn-sm" type="button" disabled={isMutating} onClick={() => onSuggest(issue.id)}>
                {t("impact.actions.suggest")}
              </button>
            ) : null}
            {(issue.status === "open" || issue.status === "suggested") && onIgnore ? (
              <button className="btn btn-ghost btn-sm" type="button" disabled={isMutating} onClick={() => onIgnore(issue.id)}>
                {t("impact.actions.ignore")}
              </button>
            ) : null}
            {issue.status !== "resolved" && issue.status !== "ignored" && onResolve ? (
              <button className="btn btn-primary btn-sm" type="button" disabled={isMutating} onClick={() => onResolve(issue.id)}>
                {t("impact.actions.resolve")}
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
