"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { VersionRecord } from "@dramaflow/shared";

import { apiFetch, formatApiError } from "../../lib/api";
import { useI18n, getVersionStatusLabel } from "../../lib/i18n";
import { queryKeys } from "../../lib/query-keys";
import { ReviewPanel } from "./review-panel";
import { RewritePanel } from "./rewrite-panel";

interface JobItem {
  id: string;
  type: string;
  status: string;
  error?: string | null;
  updatedAt: string;
  shotId?: string;
  result?: Record<string, unknown>;
}

interface DocItem {
  id: string;
  type: string;
  shotId?: string;
  currentVersionId?: string;
}

interface VersionItem {
  id: string;
  documentId: string;
}

interface Props {
  projectId: string;
  selectedVersionId: string;
  selectedVersion: Pick<VersionRecord, "id" | "title" | "versionNumber" | "status" | "content" | "createdAt"> | null;
  currentMode: string;
  isEditing: boolean;
  onStartEdit: () => void;
  onFeedback: (msg: { message: string | null; error: string | null }) => void;
  jobs: JobItem[];
  documents: DocItem[];
  versions: VersionItem[];
}

function CommentIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2 2h10a1 1 0 011 1v6a1 1 0 01-1 1H5l-3 3V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4.5 7l2 2 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M10.5 1.5l2 2-8 8H2.5v-2l8-8z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M7 1l1.5 3.5L12 6l-3.5 1.5L7 11 5.5 7.5 2 6l3.5-1.5L7 1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function MediaQueueIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1.5" y="2.5" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="5" cy="6" r="1.2" stroke="currentColor" strokeWidth="1" />
      <path d="M1.5 9.5l3-2.5 2 2 3-3 3 3" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
}

function JobDot({ status }: { status: string }) {
  const color = status === "completed" ? "#34d399"
    : status === "running" ? "#38bdf8"
    : status === "failed" ? "#f87171"
    : "#a1a1aa";
  return (
    <span style={{
      width: 6, height: 6, borderRadius: "50%", backgroundColor: color,
      display: "inline-block", flexShrink: 0,
      boxShadow: status === "running" ? "0 0 6px rgba(56,189,248,0.4)" : undefined,
      animation: status === "running" ? "uw-pulse 1.5s ease-in-out infinite" : undefined,
    }} />
  );
}

export function RightContextPanel({
  projectId, selectedVersionId, selectedVersion, currentMode,
  isEditing, onStartEdit, onFeedback, jobs, documents, versions,
}: Props) {
  const { t, formatDate } = useI18n();
  const queryClient = useQueryClient();
  const [reviewComment, setReviewComment] = useState("");

  async function invalidateWorkspace() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectVersions(projectId) }),
    ]);
  }

  const submitVersion = useMutation({
    mutationFn: (versionId: string) => apiFetch(`/versions/${versionId}/submit`, { method: "POST" }),
    onSuccess: async () => {
      onFeedback({ message: t("projectWorkspace.versions.submitAction"), error: null });
      await invalidateWorkspace();
    },
    onError: (error) => onFeedback({ message: null, error: formatApiError(error, t, "projectWorkspace.feedback.versionActionFailed") }),
  });

  const approveVersion = useMutation({
    mutationFn: (versionId: string) => apiFetch(`/versions/${versionId}/approve`, { method: "POST", body: { comment: reviewComment || undefined } }),
    onSuccess: async () => {
      setReviewComment("");
      onFeedback({ message: t("projectWorkspace.versions.approveAction"), error: null });
      await invalidateWorkspace();
    },
    onError: (error) => onFeedback({ message: null, error: formatApiError(error, t, "projectWorkspace.feedback.versionActionFailed") }),
  });

  const rejectVersion = useMutation({
    mutationFn: (versionId: string) => apiFetch(`/versions/${versionId}/reject`, { method: "POST", body: { comment: reviewComment || undefined } }),
    onSuccess: async () => {
      setReviewComment("");
      onFeedback({ message: t("projectWorkspace.versions.rejectAction"), error: null });
      await invalidateWorkspace();
    },
    onError: (error) => onFeedback({ message: null, error: formatApiError(error, t, "projectWorkspace.feedback.versionActionFailed") }),
  });

  const restoreVersion = useMutation({
    mutationFn: (versionId: string) => apiFetch(`/versions/${versionId}/restore`, { method: "POST" }),
    onSuccess: async () => {
      onFeedback({ message: t("versionRestore.success"), error: null });
      await invalidateWorkspace();
    },
    onError: (error) => onFeedback({ message: null, error: formatApiError(error, t, "versionRestore.failed") }),
  });

  const canReview = selectedVersion?.status === "pending_review" || selectedVersion?.status === "submitted";

  // Find current document for rewrite panel
  const selectedDocId = useMemo(() => {
    if (!selectedVersionId) return "";
    const versionItem = versions.find((v) => v.id === selectedVersionId);
    return versionItem?.documentId ?? "";
  }, [selectedVersionId, versions]);

  // Generate mode: show recent gen jobs
  const recentGenJobs = useMemo(() => {
    return jobs
      .filter((j) => j.type === "script_generation" || j.type === "storyboard_generation")
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 8);
  }, [jobs]);

  // Media mode: asset stats
  const mediaStats = useMemo(() => {
    const imageDocs = documents.filter((d) => d.type === "image" && d.currentVersionId);
    const videoDocs = documents.filter((d) => d.type === "video" && d.currentVersionId);
    const mediaJobs = jobs.filter((j) => j.type === "image_generation" || j.type === "video_generation");
    const activeMediaJobs = mediaJobs.filter((j) => j.status === "queued" || j.status === "running");
    return { images: imageDocs.length, videos: videoDocs.length, activeJobs: activeMediaJobs.length, allMediaJobs: mediaJobs };
  }, [documents, jobs]);

  return (
    <div className="uw-right-scroll">
      {/* ── Document mode: Review + Edit + Discussion ── */}
      {currentMode === "document" && (
        <>
          {/* Edit action */}
          {selectedVersion && !isEditing && (
            <div className="uw-right-section">
              <div className="uw-right-section-header">
                <span className="uw-right-section-icon"><EditIcon /></span>
                <span className="uw-right-section-title">{t("projectWorkspace.workspace.modeEdit")}</span>
              </div>
              <button className="uw-quick-btn" type="button" onClick={onStartEdit}>
                <EditIcon />
                {t("projectWorkspace.workspace.startEditing")}
              </button>
            </div>
          )}

          {/* Review actions */}
          {selectedVersion && (
            <div className="uw-right-section">
              <div className="uw-right-section-header">
                <span className="uw-right-section-icon"><CheckIcon /></span>
                <span className="uw-right-section-title">{t("projectWorkspace.workspace.reviewActions")}</span>
              </div>
              <div className="uw-review-actions">
                <div className="uw-review-status">
                  <span>{t("projectWorkspace.review.statusLabel", { value: getVersionStatusLabel(t, selectedVersion.status) })}</span>
                </div>
                {selectedVersion.status === "draft" && (
                  <button
                    className="btn btn-secondary"
                    type="button"
                    onClick={() => submitVersion.mutate(selectedVersion.id)}
                    disabled={submitVersion.isPending}
                    style={{ width: "100%", fontSize: 12 }}
                  >
                    {submitVersion.isPending ? t("common.submitting") : t("projectWorkspace.review.submitForReview")}
                  </button>
                )}
                {canReview && (
                  <>
                    <textarea
                      className="input"
                      value={reviewComment}
                      onChange={(event) => setReviewComment(event.target.value)}
                      placeholder="???? / Review note"
                      style={{ minHeight: 88, resize: "none" }}
                    />
                    <div className="uw-review-btn-row">
                      <button
                        className="btn btn-danger"
                        type="button"
                        onClick={() => rejectVersion.mutate(selectedVersion.id)}
                        disabled={rejectVersion.isPending}
                      >
                        {rejectVersion.isPending ? t("common.submitting") : t("projectWorkspace.versions.rejectAction")}
                      </button>
                      <button
                        className="btn btn-primary"
                        type="button"
                        onClick={() => approveVersion.mutate(selectedVersion.id)}
                        disabled={approveVersion.isPending}
                      >
                        {approveVersion.isPending ? t("common.submitting") : t("projectWorkspace.versions.approveAction")}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Discussion */}
          <div className="uw-right-section">
            <div className="uw-right-section-header">
              <span className="uw-right-section-icon"><CommentIcon /></span>
              <span className="uw-right-section-title">{t("projectWorkspace.discussion.title")}</span>
            </div>
            {selectedVersionId ? (
              <ReviewPanel versionId={selectedVersionId} />
            ) : (
              <div style={{ fontSize: 12, color: "var(--text-tertiary)", padding: "var(--space-2) 0" }}>
                {t("projectWorkspace.review.noVersionDiscussion")}
              </div>
            )}
          </div>

          {/* Restore version */}
          {selectedVersion && selectedVersion.status !== "draft" && (
            <div className="uw-right-section">
              <button
                className="uw-quick-btn"
                type="button"
                onClick={() => restoreVersion.mutate(selectedVersion.id)}
                disabled={restoreVersion.isPending}
              >
                {restoreVersion.isPending ? t("versionRestore.restoring") : t("versionRestore.action")}
              </button>
            </div>
          )}

          {/* AI Rewrite */}
          {selectedDocId && (
            <div className="uw-right-section">
              <RewritePanel
                projectId={projectId}
                documentId={selectedDocId}
                onFeedback={onFeedback}
              />
            </div>
          )}
        </>
      )}

      {/* ── Generate mode: Recent generation jobs ── */}
      {currentMode === "generate" && (
        <div className="uw-right-section">
          <div className="uw-right-section-header">
            <span className="uw-right-section-icon"><SparkleIcon /></span>
            <span className="uw-right-section-title">{t("projectWorkspace.workspace.recentGenJobs")}</span>
          </div>
          {recentGenJobs.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-tertiary)", padding: "var(--space-2) 0", lineHeight: 1.6 }}>
              {t("projectWorkspace.workspace.genJobsHint")}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
              {recentGenJobs.map((job) => (
                <div key={job.id} className="uw-job-item">
                  <JobDot status={job.status} />
                  <span className="uw-job-name">{t(`enums.jobType.${job.type}` as any)}</span>
                  <span className="uw-job-status">{t(`enums.jobStatus.${job.status}` as any)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Media mode: Media generation queue + stats ── */}
      {currentMode === "media" && (
        <div className="uw-right-section">
          <div className="uw-right-section-header">
            <span className="uw-right-section-icon"><MediaQueueIcon /></span>
            <span className="uw-right-section-title">{t("projectWorkspace.workspace.mediaQueueStatus")}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {/* Stats */}
            {mediaStats.images > 0 || mediaStats.videos > 0 ? (
              <div className="uw-review-status">
                <span>{t("projectWorkspace.workspace.mediaAssetStats", { images: mediaStats.images, videos: mediaStats.videos })}</span>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "var(--text-tertiary)", padding: "var(--space-2) 0" }}>
                {t("projectWorkspace.workspace.noMediaYet")}
              </div>
            )}
            {/* Active media jobs */}
            {mediaStats.allMediaJobs.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                {mediaStats.allMediaJobs
                  .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
                  .slice(0, 10)
                  .map((job) => (
                    <div key={job.id} className="uw-job-item">
                      <JobDot status={job.status} />
                      <span className="uw-job-name">{t(`enums.jobType.${job.type}` as any)}</span>
                      <span className="uw-job-status">{t(`enums.jobStatus.${job.status}` as any)}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
