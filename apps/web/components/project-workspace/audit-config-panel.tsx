/**
 * @fileoverview 审核配置面板
 * @module web/components/project-workspace
 *
 * 项目级别的审核策略配置 UI。
 */

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { queryKeys } from "../../lib/query-keys";

interface AuditConfig {
  contentType: string;
  reviewRequired: boolean;
}

const CONTENT_TYPE_KEYS = ["script", "storyboard", "image", "video"] as const;

interface Props {
  projectId: string;
}

export function AuditConfigPanel({ projectId }: Props) {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const { data: configs = [], isLoading } = useQuery<AuditConfig[]>({
    queryKey: queryKeys.auditConfigs(projectId),
    queryFn: () => apiFetch(`/projects/${projectId}/audit-configs`),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ contentType, reviewRequired }: { contentType: string; reviewRequired: boolean }) =>
      apiFetch(`/projects/${projectId}/audit-configs/${contentType}`, {
        method: "PATCH",
        body: { reviewRequired },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.auditConfigs(projectId) });
    },
  });

  function isReviewRequired(contentType: string): boolean {
    const config = configs.find((c) => c.contentType === contentType);
    return config?.reviewRequired ?? false;
  }

  return (
    <section className="pip-section">
      <h3 className="pip-section__title">{t("auditConfig.title")}</h3>
      {isLoading ? (
        <div className="skeleton" style={{ height: 120 }} />
      ) : (
        <div className="pip-list" style={{ gap: "var(--space-2)" }}>
          {CONTENT_TYPE_KEYS.map((ct) => {
            const checked = isReviewRequired(ct);
            return (
              <label
                key={ct}
                className="pip-row"
                style={{ cursor: "pointer", justifyContent: "space-between", padding: "var(--space-3) var(--space-4)" }}
              >
                <span className="pip-row__name">{t(`auditConfig.contentTypes.${ct}`)}</span>
                <span
                  role="switch"
                  aria-checked={checked}
                  className={`toggle-switch ${checked ? "toggle-switch--on" : ""}`}
                  style={{
                    display: "inline-block",
                    width: 40,
                    height: 22,
                    borderRadius: 11,
                    background: checked ? "var(--accent, #38bdf8)" : "var(--border-subtle, #444)",
                    position: "relative",
                    transition: "background 0.2s",
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      display: "block",
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      background: "#fff",
                      position: "absolute",
                      top: 3,
                      left: checked ? 21 : 3,
                      transition: "left 0.2s",
                    }}
                  />
                </span>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    toggleMutation.mutate({ contentType: ct, reviewRequired: !checked })
                  }
                  style={{ position: "absolute", opacity: 0, width: 0, height: 0 }}
                />
              </label>
            );
          })}
        </div>
      )}
    </section>
  );
}
