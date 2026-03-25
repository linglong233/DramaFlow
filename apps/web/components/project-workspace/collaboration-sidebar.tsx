import type { FormEvent } from "react";
import type { CommentRecord, GenerateScriptInput, GenerateStoryboardInput } from "@dramaflow/shared";

import { getAnchorTypeLabel, getShotDensityLabel, useI18n } from "../../lib/i18n";
import { EmptyState } from "../empty-state";
import { LoadingSkeleton } from "../loading-skeleton";
import { SectionCard } from "../section-card";
import { StatusBadge } from "../status-badge";

interface CollaborationSidebarProps {
  comments: CommentRecord[];
  commentsLoading: boolean;
  commentsError?: string | null;
  selectedVersionId: string;
  manualTitle: string;
  manualContent: string;
  onManualTitleChange: (value: string) => void;
  onManualContentChange: (value: string) => void;
  onCreateManualVersion: (event: FormEvent<HTMLFormElement>) => void;
  creatingManualVersion: boolean;
  commentBody: string;
  onCommentBodyChange: (value: string) => void;
  onAddComment: (event: FormEvent<HTMLFormElement>) => void;
  addingComment: boolean;
  scriptForm: GenerateScriptInput;
  onScriptFormChange: (patch: Partial<GenerateScriptInput>) => void;
  onQueueScriptJob: (event: FormEvent<HTMLFormElement>) => void;
  queueingScriptJob: boolean;
  storyboardForm: Omit<GenerateStoryboardInput, "documentId" | "versionId">;
  onStoryboardFormChange: (patch: Partial<Omit<GenerateStoryboardInput, "documentId" | "versionId">>) => void;
  onQueueStoryboardJob: (event: FormEvent<HTMLFormElement>) => void;
  queueingStoryboardJob: boolean;
  canQueueStoryboard: boolean;
  mediaForm: {
    shotId: string;
    prompt: string;
    style: string;
    aspectRatio: string;
    durationSeconds: number;
  };
  onMediaFormChange: (patch: Partial<{ shotId: string; prompt: string; style: string; aspectRatio: string; durationSeconds: number }>) => void;
  onQueueMediaJob: (kind: "image" | "video") => void;
  queueingImageJob: boolean;
  queueingVideoJob: boolean;
  activeTab: "discussion" | "ai";
}

export function CollaborationSidebar({
  comments,
  commentsLoading,
  commentsError,
  selectedVersionId,
  manualTitle,
  manualContent,
  onManualTitleChange,
  onManualContentChange,
  onCreateManualVersion,
  creatingManualVersion,
  commentBody,
  onCommentBodyChange,
  onAddComment,
  addingComment,
  scriptForm,
  onScriptFormChange,
  onQueueScriptJob,
  queueingScriptJob,
  storyboardForm,
  onStoryboardFormChange,
  onQueueStoryboardJob,
  queueingStoryboardJob,
  canQueueStoryboard,
  mediaForm,
  onMediaFormChange,
  onQueueMediaJob,
  queueingImageJob,
  queueingVideoJob,
  activeTab,
}: CollaborationSidebarProps) {
  const { t, formatDate } = useI18n();
  const canQueueMedia = Boolean(mediaForm.shotId.trim() && mediaForm.prompt.trim());

  return (
    <div className="sidebar-panels">
        {activeTab === "discussion" ? (
          <SectionCard title={t("projectWorkspace.sidebar.manualTitle")} description={t("projectWorkspace.sidebar.manualDescription")}>
        <div className="stack stack--tight">
          <form className="stack stack--tight" onSubmit={onCreateManualVersion}>
            <label>
              {t("projectWorkspace.sidebar.versionTitleLabel")}
              <input
                value={manualTitle}
                onChange={(event) => onManualTitleChange(event.target.value)}
                placeholder={t("projectWorkspace.sidebar.versionTitlePlaceholder")}
              />
            </label>
            <label>
              {t("projectWorkspace.sidebar.versionContentLabel")}
              <textarea
                value={manualContent}
                onChange={(event) => onManualContentChange(event.target.value)}
                placeholder={t("projectWorkspace.sidebar.versionContentPlaceholder")}
              />
            </label>
            <button className="primary-btn" type="submit" disabled={creatingManualVersion}>
              {creatingManualVersion ? t("common.creating") : t("projectWorkspace.sidebar.createVersionAction")}
            </button>
          </form>

          <form className="stack stack--tight" onSubmit={onAddComment}>
            <label>
              {t("projectWorkspace.sidebar.versionCommentsLabel")}
              <textarea
                value={commentBody}
                onChange={(event) => onCommentBodyChange(event.target.value)}
                placeholder={t("projectWorkspace.sidebar.versionCommentsPlaceholder")}
              />
            </label>
            <button className="secondary-btn" type="submit" disabled={!selectedVersionId || addingComment || !commentBody.trim()}>
              {addingComment ? t("common.submitting") : t("projectWorkspace.sidebar.addCommentAction")}
            </button>
          </form>

          <div className="sidebar-note">
            <StatusBadge tone={selectedVersionId ? "info" : "warning"}>
              {selectedVersionId
                ? t("projectWorkspace.sidebar.selectedVersionHint", { versionId: selectedVersionId })
                : t("projectWorkspace.sidebar.selectVersionHint")}
            </StatusBadge>
          </div>

          {commentsLoading ? <LoadingSkeleton rows={3} /> : null}
          {commentsError ? <div className="notice notice--error">{commentsError}</div> : null}
          {!commentsLoading && !commentsError && comments.length === 0 ? (
            <EmptyState
              title={t("projectWorkspace.sidebar.commentsEmptyTitle")}
              description={t("projectWorkspace.sidebar.commentsEmptyDescription")}
            />
          ) : null}
          {comments.map((comment) => (
            <div key={comment.id} className="comment-thread">
              <div className="comment-thread__meta">
                <StatusBadge tone="neutral">{getAnchorTypeLabel(t, comment.anchorType)}</StatusBadge>
                <StatusBadge tone={comment.resolved ? "success" : "warning"}>
                  {comment.resolved ? t("projectWorkspace.sidebar.resolved") : t("projectWorkspace.sidebar.discussing")}
                </StatusBadge>
              </div>
              <p>{comment.body}</p>
              <div className="muted">{comment.authorId} · {formatDate(comment.createdAt)}</div>
            </div>
          ))}
        </div>
      </SectionCard>
        ) : null}

        {activeTab === "ai" ? (
          <div className="ai-orchestrator">
        <div className="ai-job-card">
          <div className="ai-job-card__content">
            <header className="ai-pipeline-header">
              <h3 className="ai-pipeline-title">{t("projectWorkspace.sidebar.aiTitle")}</h3>
              <p className="ai-pipeline-desc">{t("projectWorkspace.sidebar.aiDescription")}</p>
            </header>

            <form className="stack stack--tight" onSubmit={onQueueScriptJob}>
              <div className="ai-input-group">
                <label>{t("projectWorkspace.sidebar.scriptTitleLabel")}</label>
                <input
                  value={scriptForm.title}
                  onChange={(event) => onScriptFormChange({ title: event.target.value })}
                  placeholder={t("projectWorkspace.sidebar.scriptTitlePlaceholder")}
                />
              </div>
              <div className="ai-input-group">
                <label>{t("projectWorkspace.sidebar.genreLabel")}</label>
                <input
                  value={scriptForm.genre}
                  onChange={(event) => onScriptFormChange({ genre: event.target.value })}
                  placeholder={t("projectWorkspace.sidebar.genrePlaceholder")}
                />
              </div>
              <div className="ai-input-group">
                <label>{t("projectWorkspace.sidebar.premiseLabel")}</label>
                <textarea
                  value={scriptForm.premise}
                  onChange={(event) => onScriptFormChange({ premise: event.target.value })}
                  placeholder={t("projectWorkspace.sidebar.premisePlaceholder")}
                />
              </div>
              <div className="ai-input-group">
                <label>{t("projectWorkspace.sidebar.episodeGoalLabel")}</label>
                <input
                  value={scriptForm.episodeGoal}
                  onChange={(event) => onScriptFormChange({ episodeGoal: event.target.value })}
                  placeholder={t("projectWorkspace.sidebar.episodeGoalPlaceholder")}
                />
              </div>
              <div className="ai-input-group">
                <label>{t("projectWorkspace.sidebar.toneLabel")}</label>
                <input
                  value={scriptForm.tone}
                  onChange={(event) => onScriptFormChange({ tone: event.target.value })}
                  placeholder={t("projectWorkspace.sidebar.tonePlaceholder")}
                />
              </div>
              <div className="ai-input-group">
                <label>{t("projectWorkspace.sidebar.audienceLabel")}</label>
                <input
                  value={scriptForm.audience}
                  onChange={(event) => onScriptFormChange({ audience: event.target.value })}
                  placeholder={t("projectWorkspace.sidebar.audiencePlaceholder")}
                />
              </div>
              <button className="ai-magic-btn" type="submit" disabled={queueingScriptJob}>
                {queueingScriptJob ? t("common.submitting") : t("projectWorkspace.sidebar.submitScriptAction")}
              </button>
            </form>

            <hr style={{ border: "none", borderTop: "1px solid rgba(23, 33, 43, 0.1)", margin: "12px 0" }} />

            <form className="stack stack--tight" onSubmit={onQueueStoryboardJob}>
              <div className="ai-input-group">
                <label>{t("projectWorkspace.sidebar.cinematicStyleLabel")}</label>
                <textarea
                  value={storyboardForm.cinematicStyle}
                  onChange={(event) => onStoryboardFormChange({ cinematicStyle: event.target.value })}
                  placeholder={t("projectWorkspace.sidebar.cinematicStylePlaceholder")}
                />
              </div>
              <div className="ai-input-group">
                <label>{t("projectWorkspace.sidebar.shotDensityLabel")}</label>
                <select
                  value={storyboardForm.shotDensity}
                  onChange={(event) => onStoryboardFormChange({ shotDensity: event.target.value as GenerateStoryboardInput["shotDensity"] })}
                >
                  <option value="sparse">{getShotDensityLabel(t, "sparse")}</option>
                  <option value="balanced">{getShotDensityLabel(t, "balanced")}</option>
                  <option value="dense">{getShotDensityLabel(t, "dense")}</option>
                </select>
              </div>
              <button className="ai-magic-btn ai-magic-btn--secondary" type="submit" disabled={!canQueueStoryboard || queueingStoryboardJob}>
                {queueingStoryboardJob
                  ? t("common.submitting")
                  : canQueueStoryboard
                    ? t("projectWorkspace.sidebar.submitStoryboardAction")
                    : t("projectWorkspace.sidebar.prepareScriptVersionHint")}
              </button>
            </form>
          </div>
        </div>

        <div className="ai-job-card">
          <div className="ai-job-card__content">
            <header className="ai-pipeline-header">
              <h3 className="ai-pipeline-title">{t("projectWorkspace.sidebar.mediaTitle")}</h3>
              <p className="ai-pipeline-desc">{t("projectWorkspace.sidebar.mediaDescription")}</p>
            </header>
            <div className="stack stack--tight">
              <div className="ai-input-group">
                <label>{t("projectWorkspace.sidebar.shotIdLabel")}</label>
                <input
                  value={mediaForm.shotId}
                  onChange={(event) => onMediaFormChange({ shotId: event.target.value })}
                  placeholder={t("projectWorkspace.sidebar.shotIdPlaceholder")}
                />
              </div>
              <div className="ai-input-group">
                <label>{t("projectWorkspace.sidebar.promptLabel")}</label>
                <textarea
                  value={mediaForm.prompt}
                  onChange={(event) => onMediaFormChange({ prompt: event.target.value })}
                  placeholder={t("projectWorkspace.sidebar.promptPlaceholder")}
                />
              </div>
              <div className="ai-input-group">
                <label>{t("projectWorkspace.sidebar.styleLabel")}</label>
                <input
                  value={mediaForm.style}
                  onChange={(event) => onMediaFormChange({ style: event.target.value })}
                  placeholder={t("projectWorkspace.sidebar.stylePlaceholder")}
                />
              </div>
              <div className="ai-input-group">
                <label>{t("projectWorkspace.sidebar.aspectRatioLabel")}</label>
                <select value={mediaForm.aspectRatio} onChange={(event) => onMediaFormChange({ aspectRatio: event.target.value })}>
                  <option value="16:9">16:9</option>
                  <option value="9:16">9:16</option>
                  <option value="1:1">1:1</option>
                </select>
              </div>
              <div className="ai-input-group">
                <label>{t("projectWorkspace.sidebar.durationLabel")}</label>
                <input
                  type="number"
                  min={1}
                  value={mediaForm.durationSeconds}
                  onChange={(event) => onMediaFormChange({ durationSeconds: Math.max(1, Number(event.target.value) || 1) })}
                />
              </div>
              <div className="inline-actions inline-actions--equal">
                <button className="ai-magic-btn" type="button" disabled={!canQueueMedia || queueingImageJob} onClick={() => onQueueMediaJob("image")}>
                  {queueingImageJob ? t("common.submitting") : t("projectWorkspace.sidebar.submitImageAction")}
                </button>
                <button className="ai-magic-btn ai-magic-btn--secondary" type="button" disabled={!canQueueMedia || queueingVideoJob} onClick={() => onQueueMediaJob("video")}>
                  {queueingVideoJob ? t("common.submitting") : t("projectWorkspace.sidebar.submitVideoAction")}
                </button>
              </div>
            </div>
          </div>
        </div>
          </div>
        ) : null}
    </div>
  );
}