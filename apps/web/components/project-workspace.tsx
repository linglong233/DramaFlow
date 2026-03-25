"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CommentRecord,
  DocumentRecord,
  GenerateScriptInput,
  GenerateStoryboardInput,
  ProjectWorkspacePayload,
  ReviewPolicyMode,
  VersionRecord,
} from "@dramaflow/shared";

import { getJobTypeLabel, getReviewPolicyLabel, getVersionStatusLabel, type Locale, useI18n } from "../lib/i18n";
import { apiFetch, formatApiError } from "../lib/api";
import { queryKeys } from "../lib/query-keys";
import { ErrorState } from "./error-state";
import { InlineFeedback } from "./inline-feedback";
import { LoadingSkeleton } from "./loading-skeleton";
import { CollaborationSidebar } from "./project-workspace/collaboration-sidebar";
import { OverviewCard } from "./project-workspace/overview-card";
import { VersionBrowser } from "./project-workspace/version-browser";
import { VersionDetail } from "./project-workspace/version-detail";

interface FeedbackState {
  message: string | null;
  error: string | null;
}

function createDefaultManualContent(locale: Locale) {
  return locale === "en"
    ? "{\n  \"note\": \"Paste script JSON, storyboard JSON, or asset metadata here.\"\n}"
    : "{\n  \"note\": \"在这里粘贴剧本 JSON、分镜 JSON 或素材元数据\"\n}";
}

function createDefaultScriptForm(locale: Locale): GenerateScriptInput {
  return locale === "en"
    ? {
        title: "Nightfall Chaser",
        genre: "Urban suspense",
        premise: "A director must rebuild a collapsing short-drama project during its final night.",
        episodeGoal: "Establish the central conflict of episode one.",
        tone: "Tense, restrained, cinematic",
        audience: "Urban women aged 18-35 and creative professionals",
      }
    : {
        title: "夜幕追光",
        genre: "都市悬疑",
        premise: "一位导演在最后一晚重组即将流产的短剧项目。",
        episodeGoal: "完成首集核心冲突的搭建。",
        tone: "高压、克制、电影化",
        audience: "18-35 岁都市女性与内容创作者",
      };
}

function createDefaultStoryboardForm(locale: Locale): Omit<GenerateStoryboardInput, "documentId" | "versionId"> {
  return {
    cinematicStyle: locale === "en"
      ? "Wet neon nights, long-lens compression, reflective streets, grounded realism"
      : "夜景霓虹、长焦压缩、潮湿反光、现实主义电影感",
    shotDensity: "balanced",
  };
}

function createDefaultMediaForm(locale: Locale) {
  return {
    shotId: "",
    prompt: locale === "en"
      ? "Night rooftop, the lead turns back into the wind, neon reflections tracing one side of the face."
      : "夜景天台，主角在风里回头，霓虹反光落在侧脸上。",
    style: locale === "en"
      ? "Realistic cinematic lighting, cool palette, strong depth layering"
      : "写实电影感，偏冷调，强烈空间层次",
    aspectRatio: "16:9",
    durationSeconds: 5,
  };
}

function extractFirstShotId(content: unknown) {
  if (!content || typeof content !== "object" || !("shots" in content)) {
    return "";
  }

  const shots = (content as { shots?: Array<{ id?: string }> }).shots;
  if (!Array.isArray(shots) || !shots[0]?.id) {
    return "";
  }

  return shots[0].id;
}

export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { locale, t } = useI18n();
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [manualTitle, setManualTitle] = useState(locale === "en" ? "Manual version" : "手动版本");
  const [manualContent, setManualContent] = useState(() => createDefaultManualContent(locale));
  const [commentBody, setCommentBody] = useState("");
  const [scriptForm, setScriptForm] = useState<GenerateScriptInput>(() => createDefaultScriptForm(locale));
  const [storyboardForm, setStoryboardForm] = useState<Omit<GenerateStoryboardInput, "documentId" | "versionId">>(() => createDefaultStoryboardForm(locale));
  const [mediaForm, setMediaForm] = useState(() => createDefaultMediaForm(locale));
  const [feedback, setFeedback] = useState<FeedbackState>({ message: null, error: null });
  const [sidebarTab, setSidebarTab] = useState<"library" | "discussion" | "ai">("library");

  const projectQuery = useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: () => apiFetch<ProjectWorkspacePayload>(`/projects/${projectId}`),
  });

  const commentsQuery = useQuery({
    enabled: Boolean(selectedVersionId),
    queryKey: queryKeys.versionComments(selectedVersionId),
    queryFn: () => apiFetch<CommentRecord[]>(`/versions/${selectedVersionId}/comments`),
  });

  const documents = projectQuery.data?.documents ?? [];
  const versions = useMemo(() => {
    return [...(projectQuery.data?.versions ?? [])].sort((left, right) => right.versionNumber - left.versionNumber);
  }, [projectQuery.data?.versions]);

  const versionsByDocument = useMemo(() => {
    return versions.reduce<Record<string, typeof versions>>((groups, version) => {
      if (!groups[version.documentId]) {
        groups[version.documentId] = [];
      }
      groups[version.documentId].push(version);
      return groups;
    }, {});
  }, [versions]);

  useEffect(() => {
    if (!selectedDocumentId && documents[0]?.id) {
      setSelectedDocumentId(documents[0].id);
    }
  }, [documents, selectedDocumentId]);

  useEffect(() => {
    if (!selectedDocumentId) {
      setSelectedVersionId("");
      return;
    }

    const currentDocument = documents.find((document) => document.id === selectedDocumentId);
    const documentVersions = versionsByDocument[selectedDocumentId] ?? [];
    const nextVersionId = currentDocument?.currentVersionId ?? documentVersions[0]?.id ?? "";

    if (!documentVersions.some((version) => version.id === selectedVersionId)) {
      setSelectedVersionId(nextVersionId);
    }
  }, [documents, selectedDocumentId, selectedVersionId, versionsByDocument]);

  const selectedDocument = useMemo(
    () => documents.find((document) => document.id === selectedDocumentId),
    [documents, selectedDocumentId],
  );

  const currentVersion = useMemo(
    () => versions.find((version) => version.id === selectedVersionId) ?? null,
    [selectedVersionId, versions],
  );

  const scriptDocument = useMemo(
    () => documents.find((document) => document.type === "script") ?? null,
    [documents],
  );
  const storyboardDocument = useMemo(
    () => documents.find((document) => document.type === "storyboard") ?? null,
    [documents],
  );

  const latestScriptVersion = scriptDocument ? (versionsByDocument[scriptDocument.id] ?? [])[0] ?? null : null;
  const latestStoryboardVersion = storyboardDocument ? (versionsByDocument[storyboardDocument.id] ?? [])[0] ?? null : null;
  const canQueueStoryboard = Boolean(storyboardDocument && latestScriptVersion);

  useEffect(() => {
    const derivedShotId = extractFirstShotId(latestStoryboardVersion?.content);
    if (derivedShotId && !mediaForm.shotId) {
      setMediaForm((current) => ({ ...current, shotId: derivedShotId }));
    }
  }, [latestStoryboardVersion?.content, mediaForm.shotId]);

  async function refreshProject() {
    await queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
  }

  const updateReviewPolicyMutation = useMutation({
    mutationFn: (mode: ReviewPolicyMode) => apiFetch(`/projects/${projectId}/review-policy`, {
      method: "PATCH",
      body: { reviewPolicyMode: mode },
    }),
    onSuccess: async (_, mode) => {
      setFeedback({
        message: t("projectWorkspace.feedback.reviewPolicySuccess", { mode: getReviewPolicyLabel(t, mode) }),
        error: null,
      });
      await refreshProject();
    },
    onError: (error) => setFeedback({
      message: null,
      error: formatApiError(error, t, "projectWorkspace.feedback.reviewPolicyFailed"),
    }),
  });

  const createVersionMutation = useMutation({
    mutationFn: async () => {
      if (!selectedDocumentId) {
        throw new Error(t("projectWorkspace.feedback.selectDocumentFirst"));
      }

      let parsed: unknown = manualContent;
      try {
        parsed = JSON.parse(manualContent);
      } catch {
        parsed = { raw: manualContent };
      }

      return apiFetch<Pick<VersionRecord, "id" | "versionNumber">>(`/documents/${selectedDocumentId}/versions`, {
        method: "POST",
        body: {
          title: manualTitle,
          content: parsed,
          metadata: { source: "manual-editor" },
        },
      });
    },
    onSuccess: async (version) => {
      setFeedback({
        message: t("projectWorkspace.feedback.createVersionSuccess", { versionNumber: version.versionNumber }),
        error: null,
      });
      await refreshProject();
      setSelectedVersionId(version.id);
    },
    onError: (error) => setFeedback({
      message: null,
      error: formatApiError(error, t, "projectWorkspace.feedback.createVersionFailed"),
    }),
  });

  const versionActionMutation = useMutation({
    mutationFn: ({ action, versionId }: { action: "submit" | "approve" | "reject"; versionId: string }) => apiFetch<Pick<VersionRecord, "id" | "status">>(`/versions/${versionId}/${action}`, {
      method: "POST",
    }),    onSuccess: async (version, variables) => {
      const actionLabel = variables.action === "submit"
        ? t("projectWorkspace.versions.submitAction")
        : variables.action === "approve"
          ? t("projectWorkspace.versions.approveAction")
          : t("projectWorkspace.versions.rejectAction");
      setFeedback({
        message: t("projectWorkspace.feedback.versionActionSuccess", {
          action: actionLabel,
          status: getVersionStatusLabel(t, version.status),
        }),
        error: null,
      });
      await refreshProject();
      setSelectedVersionId(version.id);
    },
    onError: (error) => setFeedback({
      message: null,
      error: formatApiError(error, t, "projectWorkspace.feedback.versionActionFailed"),
    }),
  });

  const addCommentMutation = useMutation({
    mutationFn: () => apiFetch(`/versions/${selectedVersionId}/comments`, {
      method: "POST",
      body: {
        body: commentBody,
        anchorType: "document",
      },
    }),
    onSuccess: async () => {
      setCommentBody("");
      setFeedback({ message: t("projectWorkspace.feedback.commentSuccess"), error: null });
      await queryClient.invalidateQueries({ queryKey: queryKeys.versionComments(selectedVersionId) });
    },
    onError: (error) => setFeedback({
      message: null,
      error: formatApiError(error, t, "projectWorkspace.feedback.commentFailed"),
    }),
  });

  const scriptJobMutation = useMutation({
    mutationFn: () => apiFetch<{ id: string }>(`/projects/${projectId}/script-jobs`, {
      method: "POST",
      body: scriptForm,
    }),
    onSuccess: (job) => {
      setFeedback({ message: t("projectWorkspace.feedback.scriptJobSuccess", { jobId: job.id }), error: null });
    },
    onError: (error) => setFeedback({
      message: null,
      error: formatApiError(error, t, "projectWorkspace.feedback.scriptJobFailed"),
    }),
  });

  const storyboardJobMutation = useMutation({
    mutationFn: () => {
      if (!storyboardDocument || !latestScriptVersion) {
        throw new Error(t("projectWorkspace.feedback.storyboardMissingScript"));
      }

      return apiFetch<{ id: string }>(`/projects/${projectId}/storyboard-jobs`, {
        method: "POST",
        body: {
          documentId: storyboardDocument.id,
          versionId: latestScriptVersion.id,
          ...storyboardForm,
        },
      });
    },
    onSuccess: (job) => {
      setFeedback({ message: t("projectWorkspace.feedback.storyboardJobSuccess", { jobId: job.id }), error: null });
    },
    onError: (error) => setFeedback({
      message: null,
      error: formatApiError(error, t, "projectWorkspace.feedback.storyboardJobFailed"),
    }),
  });

  const mediaJobMutation = useMutation({
    mutationFn: (kind: "image" | "video") => apiFetch<{ id: string }>(`/shots/${mediaForm.shotId}/${kind}-jobs`, {
      method: "POST",
      body: {
        projectId,
        style: mediaForm.style,
        aspectRatio: mediaForm.aspectRatio,
        prompt: mediaForm.prompt,
        durationSeconds: mediaForm.durationSeconds,
      },
    }),
    onSuccess: (job, kind) => {
      const label = kind === "image"
        ? getJobTypeLabel(t, "image_generation")
        : getJobTypeLabel(t, "video_generation");
      setFeedback({
        message: t("projectWorkspace.feedback.mediaJobSuccess", { label, jobId: job.id }),
        error: null,
      });
    },
    onError: (error) => setFeedback({
      message: null,
      error: formatApiError(error, t, "projectWorkspace.feedback.mediaJobFailed"),
    }),
  });

  if (projectQuery.isPending) {
    return (
      <div className="stack stack--page">
        <LoadingSkeleton variant="hero" rows={4} />
        <LoadingSkeleton rows={8} />
      </div>
    );
  }

  if (projectQuery.error || !projectQuery.data) {
    return (
      <ErrorState
        title={t("projectWorkspace.loadErrorTitle")}
        description={formatApiError(projectQuery.error, t, "projectWorkspace.loadErrorDescription")}
        action={(
          <button className="primary-btn" type="button" onClick={() => void projectQuery.refetch()}>
            {t("common.reload")}
          </button>
        )}
      />
    );
  }

  const commentsError = commentsQuery.error ? formatApiError(commentsQuery.error, t, "projectWorkspace.commentsLoadError") : null;
  const versionAction = versionActionMutation.variables?.action;

  return (
    <div className="stack stack--page">
      <OverviewCard
        name={projectQuery.data.project.name}
        description={projectQuery.data.project.description}
        reviewPolicyMode={projectQuery.data.project.reviewPolicyMode}
        membersCount={projectQuery.data.members.length}
        invitesCount={projectQuery.data.invites.length}
        documentsCount={projectQuery.data.documents.length}
        currentDocumentType={selectedDocument?.type}
        pending={updateReviewPolicyMutation.isPending}
        onReviewPolicyChange={(mode) => {
          setFeedback({ message: null, error: null });
          updateReviewPolicyMutation.mutate(mode);
        }}
      />

      <InlineFeedback message={feedback.message} error={feedback.error} />

      <section className="project-workspace-grid">
        <div className="super-sidebar stack">
          <div className="tabs-container">
            <div className="tabs-header">
              <button
                className={`tab-btn ${sidebarTab === "library" ? "tab-btn--active" : ""}`}
                onClick={() => setSidebarTab("library")}
              >
                {t("projectWorkspace.sidebar.tabLibrary")}
              </button>
              <button
                className={`tab-btn ${sidebarTab === "discussion" ? "tab-btn--active" : ""}`}
                onClick={() => setSidebarTab("discussion")}
              >
                {t("projectWorkspace.sidebar.tabDiscussion")}
              </button>
              <button
                className={`tab-btn ${sidebarTab === "ai" ? "tab-btn--active" : ""}`}
                onClick={() => setSidebarTab("ai")}
              >
                {t("projectWorkspace.sidebar.tabAi")}
              </button>
            </div>
            <div className="tab-content">
              {sidebarTab === "library" && (
                <VersionBrowser
                  documents={documents}
                  versions={versions}
                  selectedDocumentId={selectedDocumentId}
                  selectedVersionId={selectedVersionId}
                  onSelectDocument={setSelectedDocumentId}
                  onSelectVersion={setSelectedVersionId}
                />
              )}
              {sidebarTab !== "library" && (

        <CollaborationSidebar
          activeTab={sidebarTab}
          comments={commentsQuery.data ?? []}
          commentsLoading={commentsQuery.isPending}
          commentsError={commentsError}
          selectedVersionId={selectedVersionId}
          manualTitle={manualTitle}
          manualContent={manualContent}
          onManualTitleChange={setManualTitle}
          onManualContentChange={setManualContent}
          onCreateManualVersion={(event) => {
            event.preventDefault();
            setFeedback({ message: null, error: null });
            createVersionMutation.mutate();
          }}
          creatingManualVersion={createVersionMutation.isPending}
          commentBody={commentBody}
          onCommentBodyChange={setCommentBody}
          onAddComment={(event) => {
            event.preventDefault();
            setFeedback({ message: null, error: null });
            addCommentMutation.mutate();
          }}
          addingComment={addCommentMutation.isPending}
          scriptForm={scriptForm}
          onScriptFormChange={(patch) => setScriptForm((current) => ({ ...current, ...patch }))}
          onQueueScriptJob={(event) => {
            event.preventDefault();
            setFeedback({ message: null, error: null });
            scriptJobMutation.mutate();
          }}
          queueingScriptJob={scriptJobMutation.isPending}
          storyboardForm={storyboardForm}
          onStoryboardFormChange={(patch) => setStoryboardForm((current) => ({ ...current, ...patch }))}
          onQueueStoryboardJob={(event) => {
            event.preventDefault();
            setFeedback({ message: null, error: null });
            storyboardJobMutation.mutate();
          }}
          queueingStoryboardJob={storyboardJobMutation.isPending}
          canQueueStoryboard={canQueueStoryboard}
          mediaForm={mediaForm}
          onMediaFormChange={(patch) => setMediaForm((current) => ({ ...current, ...patch }))}
          onQueueMediaJob={(kind) => {
            setFeedback({ message: null, error: null });
            mediaJobMutation.mutate(kind);
          }}
          queueingImageJob={mediaJobMutation.isPending && mediaJobMutation.variables === "image"}
          queueingVideoJob={mediaJobMutation.isPending && mediaJobMutation.variables === "video"}
        />
              )}
            </div>
          </div>
        </div>

        <VersionDetail
          currentDocument={selectedDocument ?? undefined}
          currentVersion={currentVersion}
          submitting={versionActionMutation.isPending && versionAction === "submit"}
          reviewing={versionActionMutation.isPending && versionAction !== "submit"}
          onSubmitVersion={() => {
            if (!currentVersion) {
              return;
            }
            setFeedback({ message: null, error: null });
            versionActionMutation.mutate({ action: "submit", versionId: currentVersion.id });
          }}
          onApprove={() => {
            if (!currentVersion) {
              return;
            }
            setFeedback({ message: null, error: null });
            versionActionMutation.mutate({ action: "approve", versionId: currentVersion.id });
          }}
          onReject={() => {
            if (!currentVersion) {
              return;
            }
            setFeedback({ message: null, error: null });
            versionActionMutation.mutate({ action: "reject", versionId: currentVersion.id });
          }}
        />
      </section>
    </div>
  );
}