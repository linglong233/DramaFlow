/**
 * @fileoverview 审核策略切换器
 * @module web/components
 *
 * 项目审核策略的快捷切换组件。
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReviewPolicyMode } from "@dramaflow/shared";

import { useI18n, getReviewPolicyLabel } from "../lib/i18n";
import { apiFetch, formatApiError } from "../lib/api";
import { queryKeys } from "../lib/query-keys";
import { InlineFeedback } from "./inline-feedback";

/* ── SVG Icons ── */
function InheritIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2v4M8 6L5 9M8 6l3 3M4 12h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RequiredIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 8l1.5 1.5L10 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BypassIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 8h8M11 5l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3.5 7l2.5 2.5L10.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const POLICY_OPTIONS: Array<{
  mode: ReviewPolicyMode;
  Icon: React.ComponentType;
  descKey: "inheritDescription" | "requiredDescription" | "bypassDescription";
}> = [
  { mode: "inherit", Icon: InheritIcon, descKey: "inheritDescription" },
  { mode: "required", Icon: RequiredIcon, descKey: "requiredDescription" },
  { mode: "bypass", Icon: BypassIcon, descKey: "bypassDescription" },
];

interface ReviewPolicySwitcherProps {
  projectId: string;
  currentMode: ReviewPolicyMode;
  teamId?: string;
  variant?: "full" | "compact";
}

export function ReviewPolicySwitcher({
  projectId,
  currentMode,
  teamId,
  variant = "full",
}: ReviewPolicySwitcherProps) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [feedback, setFeedback] = useState<{ message: string | null; error: string | null }>({ message: null, error: null });
  const [selectedMode, setSelectedMode] = useState<ReviewPolicyMode>(currentMode);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sync selectedMode when currentMode changes from server
  useEffect(() => {
    setSelectedMode(currentMode);
  }, [currentMode]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSelectedMode(currentMode); // Reset on close
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, currentMode]);

  const hasChanges = selectedMode !== currentMode;

  const mutation = useMutation({
    mutationFn: (mode: ReviewPolicyMode) =>
      apiFetch(`/projects/${projectId}/review-policy`, {
        method: "PATCH",
        body: { reviewPolicyMode: mode },
      }),
    onSuccess: async (_, mode) => {
      setOpen(false);
      setFeedback({
        message: t("projectWorkspace.feedback.reviewPolicySuccess", { mode: getReviewPolicyLabel(t, mode) }),
        error: null,
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
      if (teamId) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.teamOverview(teamId) });
      }
    },
    onError: (error) => {
      setFeedback({
        message: null,
        error: formatApiError(error, t, "projectWorkspace.feedback.reviewPolicyFailed"),
      });
    },
  });

  const handleSelect = useCallback((mode: ReviewPolicyMode) => {
    setFeedback({ message: null, error: null });
    setSelectedMode(mode);
  }, []);

  const handleSave = useCallback(() => {
    if (!hasChanges) return;
    setFeedback({ message: null, error: null });
    mutation.mutate(selectedMode);
  }, [hasChanges, selectedMode, mutation]);

  const handleCancel = useCallback(() => {
    setSelectedMode(currentMode);
    setFeedback({ message: null, error: null });
  }, [currentMode]);

  function optionClass(mode: ReviewPolicyMode): string {
    const classes = ["rps-option"];
    if (mode === currentMode && mode === selectedMode) classes.push("rps-option--active");
    else if (mode === selectedMode && mode !== currentMode) classes.push("rps-option--selected");
    return classes.join(" ");
  }

  const currentOption = POLICY_OPTIONS.find((o) => o.mode === currentMode);
  const CurrentIcon = currentOption?.Icon ?? InheritIcon;

  /* ── Compact variant: trigger button + dropdown ── */
  if (variant === "compact") {
    return (
      <div className="rps-compact-root" ref={dropdownRef}>
        <button
          className={`rps-trigger ${open ? "rps-trigger--open" : ""}`}
          type="button"
          onClick={() => {
            setOpen(!open);
            if (open) {
              setSelectedMode(currentMode); // Reset on close
            }
          }}
          aria-expanded={open}
          aria-haspopup="listbox"
        >
          <span className="rps-trigger-icon"><CurrentIcon /></span>
          <span className="rps-trigger-label">{getReviewPolicyLabel(t, currentMode)}</span>
          <span className={`rps-trigger-chevron ${open ? "rps-trigger-chevron--open" : ""}`}>
            <ChevronDownIcon />
          </span>
        </button>

        {open && (
          <div className="rps-dropdown animate-scale-in">
            <div className="rps-dropdown-header">
              <span>{t("projectWorkspace.reviewPolicy.label")}</span>
            </div>
            {POLICY_OPTIONS.map(({ mode, Icon, descKey }) => (
              <button
                key={mode}
                className={optionClass(mode)}
                type="button"
                disabled={mutation.isPending}
                onClick={() => handleSelect(mode)}
                aria-pressed={mode === selectedMode}
              >
                <span className="rps-icon"><Icon /></span>
                <span className="rps-text">
                  <span className="rps-label">
                    {getReviewPolicyLabel(t, mode)}
                  </span>
                  <span className="rps-desc">
                    {t(`projectWorkspace.reviewPolicy.${descKey}` as any)}
                  </span>
                </span>
                {mode === selectedMode && (
                  <span className="rps-check" aria-label="selected">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3.5 7l2.5 2.5L10.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </span>
                )}
              </button>
            ))}
            <div className="rps-dropdown-footer rps-dropdown-footer--actions">
              {hasChanges && (
                <button type="button" className="rps-cancel-btn" onClick={handleCancel}>
                  {t("projectWorkspace.reviewPolicy.cancelAction")}
                </button>
              )}
              <button
                type="button"
                className={`rps-save-btn ${hasChanges ? "rps-save-btn--active" : ""}`}
                disabled={!hasChanges || mutation.isPending}
                onClick={handleSave}
              >
                <SaveIcon />
                {mutation.isPending
                  ? t("projectWorkspace.reviewPolicy.saving")
                  : t("projectWorkspace.reviewPolicy.saveAction")}
              </button>
            </div>
          </div>
        )}
        <InlineFeedback message={feedback.message} error={feedback.error} />
      </div>
    );
  }

  /* ── Full variant: inline card-style options ── */
  return (
    <div>
      <div className="rps-group rps-group--full">
        {POLICY_OPTIONS.map(({ mode, Icon, descKey }) => (
          <button
            key={mode}
            className={optionClass(mode)}
            type="button"
            disabled={mutation.isPending}
            onClick={() => handleSelect(mode)}
            aria-pressed={mode === selectedMode}
          >
            <span className="rps-icon"><Icon /></span>
            <span className="rps-text">
              <span className="rps-label">
                {getReviewPolicyLabel(t, mode)}
              </span>
              <span className="rps-desc">
                {t(`projectWorkspace.reviewPolicy.${descKey}` as any)}
              </span>
            </span>
            {mode === selectedMode && (
              <span className="rps-check" aria-label="selected">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3.5 7l2.5 2.5L10.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
            )}
          </button>
        ))}
      </div>
      {hasChanges && (
        <div className="rps-action-bar">
          <span className="rps-action-bar__hint">
            {t("projectWorkspace.reviewPolicy.confirmChange", { mode: getReviewPolicyLabel(t, selectedMode) })}
          </span>
          <div className="rps-action-bar__buttons">
            <button type="button" className="rps-cancel-btn" onClick={handleCancel}>
              {t("projectWorkspace.reviewPolicy.cancelAction")}
            </button>
            <button
              type="button"
              className="rps-save-btn rps-save-btn--active"
              disabled={mutation.isPending}
              onClick={handleSave}
            >
              <SaveIcon />
              {mutation.isPending
                ? t("projectWorkspace.reviewPolicy.saving")
                : t("projectWorkspace.reviewPolicy.saveAction")}
            </button>
          </div>
        </div>
      )}
      <InlineFeedback message={feedback.message} error={feedback.error} />
    </div>
  );
}
