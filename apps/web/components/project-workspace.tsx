"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  GenerateScriptInput,
  GenerateStoryboardInput,
  ProjectWorkspacePayload,
  ReviewPolicyMode,
  VersionRecord,
} from "@dramaflow/shared";

import { useI18n, getReviewPolicyLabel } from "../lib/i18n";
import { apiFetch, formatApiError } from "../lib/api";
import { queryKeys } from "../lib/query-keys";
import { ErrorState } from "./error-state";
import { InlineFeedback } from "./inline-feedback";
import { LoadingSkeleton } from "./loading-skeleton";
import { VersionList } from "./project-workspace/version-list";
import { VersionView } from "./project-workspace/version-view";
import { GenerationPanel } from "./project-workspace/generation-panel";
import { ReviewPanel } from "./project-workspace/review-panel";

interface FeedbackState {
  message: string | null;
  error: string | null;
}

interface DocumentWithVersions {
  id: string;
  type: string;
  title: string;
  currentVersionId?: string;
  versions: Array<Pick<VersionRecord, "id" | "title" | "versionNumber" | "status" | "content" | "createdAt">>;
}

interface Props {
  projectId: string;
}

export function ProjectWorkspace({ projectId }: Props) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [feedback, setFeedback] = useState<FeedbackState>({ message: null, error: null });

  const [activeTab, setActiveTab] = useState<"draft" | "generate">("draft");
  const [selectedDocId, setSelectedDocId] = useState<string>("");
  const [selectedVersionId, setSelectedVersionId] = useState<string>("");

  const projectQuery = useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: () => apiFetch<ProjectWorkspacePayload>(`/projects/${projectId}`),
  });

  const project = projectQuery.data?.project;
  const rawDocuments = projectQuery.data?.documents ?? [];
  const rawVersions = projectQuery.data?.versions ?? [];

  // Build documents with embedded versions (sorted by version number desc)
  const documents: DocumentWithVersions[] = useMemo(() => {
    return rawDocuments.map((doc) => {
      const docVersions = rawVersions
        .filter((v) => v.documentId === doc.id)
        .sort((a, b) => b.versionNumber - a.versionNumber);
      return {
        id: doc.id,
        type: doc.type,
        title: doc.title,
        currentVersionId: doc.currentVersionId,
        versions: docVersions,
      };
    });
  }, [rawDocuments, rawVersions]);

  const selectedDoc = useMemo(
    () => documents.find((d) => d.id === selectedDocId) ?? documents[0] ?? null,
    [documents, selectedDocId],
  );

  const selectedVersion = useMemo(
    () => selectedDoc?.versions.find((v) => v.id === selectedVersionId) ?? null,
    [selectedDoc, selectedVersionId],
  );

  async function refreshProject() {
    await queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
  }

  // Update review policy
  const updateReviewPolicyMutation = useMutation({
    mutationFn: (mode: ReviewPolicyMode) => apiFetch(`/projects/${projectId}/review-policy`, {
      method: "PATCH",
      body: { reviewPolicyMode: mode },
    }),
    onSuccess: async (_, mode) => {
      setFeedback({
        message: t("projectWorkspace.feedback.reviewPolicySuccess", { mode }),
        error: null,
      });
      await refreshProject();
    },
    onError: (error) => setFeedback({
      message: null,
      error: formatApiError(error, t, "projectWorkspace.feedback.reviewPolicyFailed"),
    }),
  });

  // Manual version creation
  const [manualTitle, setManualTitle] = useState(t("projectWorkspace.manualVersion.defaultTitle"));
  const [manualContent, setManualContent] = useState("");

  const createVersionMutation = useMutation({
    mutationFn: async () => {
      const targetDocId = selectedDocId || documents[0]?.id;
      if (!targetDocId) {
        throw new Error(t("projectWorkspace.manualVersion.noDocumentError"));
      }
      let parsed: unknown = manualContent;
      try {
        parsed = JSON.parse(manualContent);
      } catch {
        parsed = { raw: manualContent };
      }
      return apiFetch<Pick<VersionRecord, "id" | "versionNumber">>(
        `/documents/${targetDocId}/versions`,
        {
          method: "POST",
          body: {
            title: manualTitle,
            content: parsed,
            metadata: { source: "manual-editor" },
          },
        },
      );
    },
    onSuccess: async (version) => {
      setFeedback({
        message: t("projectWorkspace.feedback.createVersionSuccess", { versionNumber: version.versionNumber }),
        error: null,
      });
      await refreshProject();
    },
    onError: (error) => setFeedback({
      message: null,
      error: formatApiError(error, t, "projectWorkspace.feedback.createVersionFailed"),
    }),
  });

  // Script generation form state (used by GenerationPanel via documents prop)
  const [scriptForm] = useState<GenerateScriptInput>({
    title: "",
    genre: "",
    premise: "",
    episodeGoal: "",
    tone: "",
    audience: "",
  });

  // Storyboard generation form state
  const [storyboardForm] = useState<Omit<GenerateStoryboardInput, "documentId" | "versionId">>({
    cinematicStyle: "",
    shotDensity: "balanced",
  });

  void scriptForm;
  void storyboardForm;

  if (projectQuery.isPending) {
    return (
      <div className="stack stack-gap-4" style={{ padding: "var(--space-8)" }}>
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

  return (
    <div>
      {/* Project header */}
      <div className="project-header">
        <div className="inline" style={{ alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <span className="kicker">{t("projectWorkspace.overview.kicker")}</span>
            <h1 className="project-header-title">{project?.name ?? "..."}</h1>
          </div>
          <div className="tabs" style={{ marginBottom: 0, borderBottom: "none" }}>
            <button
              className={`tab ${activeTab === "draft" ? "active" : ""}`}
              onClick={() => setActiveTab("draft")}
            >
              {t("projectWorkspace.tabs.draft")}
            </button>
            <button
              className={`tab ${activeTab === "generate" ? "active" : ""}`}
              onClick={() => setActiveTab("generate")}
            >
              {t("projectWorkspace.tabs.generate")}
            </button>
          </div>
        </div>
        {/* Review policy selector */}
        <div className="choice-row choice-row--compact" style={{ marginTop: "var(--space-4)" }}>
          <span className="muted text-sm">{t("projectWorkspace.reviewPolicy.label")}</span>
          {(["inherit", "required", "bypass"] as ReviewPolicyMode[]).map((mode) => (
            <button
              key={mode}
              className={mode === project?.reviewPolicyMode ? "choice-chip choice-chip--active" : "choice-chip"}
              type="button"
              disabled={updateReviewPolicyMutation.isPending}
              onClick={() => {
                setFeedback({ message: null, error: null });
                updateReviewPolicyMutation.mutate(mode);
              }}
            >
              {getReviewPolicyLabel(t, mode)}
            </button>
          ))}
        </div>
      </div>

      {/* Feedback */}
      <InlineFeedback message={feedback.message} error={feedback.error} />

      {/* Tab content */}
      <div style={{ padding: "var(--space-8)" }}>
        {activeTab === "draft" ? (
          <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: "var(--space-8)" }}>
            {/* Left panel */}
            <div>
              <VersionList
                documents={documents}
                selectedDocId={selectedDocId || documents[0]?.id || ""}
                selectedVersionId={selectedVersionId}
                onSelectDoc={(id) => {
                  setSelectedDocId(id);
                  const doc = documents.find((d) => d.id === id);
                  if (doc?.versions[0]) {
                    setSelectedVersionId(doc.versions[0].id);
                  }
                }}
                onSelectVersion={(id) => {
                  setSelectedVersionId(id);
                }}
              />
              <hr className="divider" />
              <ReviewPanel versionId={selectedVersionId} />
              <hr className="divider" />
              {/* Manual version creation */}
              <div>
                <span className="faint text-sm" style={{ display: "block", marginBottom: "var(--space-3)" }}>{t("projectWorkspace.manualVersion.sectionTitle")}</span>
                <div className="form-group" style={{ marginBottom: "var(--space-3)" }}>
                  <input
                    className="input"
                    placeholder={t("projectWorkspace.manualVersion.titlePlaceholder")}
                    value={manualTitle}
                    onChange={(e) => setManualTitle(e.target.value)}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: "var(--space-3)" }}>
                  <textarea
                    className="input"
                    placeholder={t("projectWorkspace.manualVersion.contentPlaceholder")}
                    value={manualContent}
                    onChange={(e) => setManualContent(e.target.value)}
                    style={{ minHeight: 80 }}
                  />
                </div>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setFeedback({ message: null, error: null });
                    createVersionMutation.mutate();
                  }}
                  disabled={createVersionMutation.isPending || (!selectedDocId && !documents[0]) || !manualTitle.trim()}
                >
                  {createVersionMutation.isPending ? "..." : t("projectWorkspace.manualVersion.createAction")}
                </button>
              </div>
            </div>
            {/* Main content */}
            <div>
              <VersionView
                version={selectedVersion ?? null}
                projectId={projectId}
                isLoading={projectQuery.isFetching && !projectQuery.data}
              />
            </div>
          </div>
        ) : (
          <GenerationPanel
            projectId={projectId}
            documents={documents.map((d) => ({ id: d.id, type: d.type, currentVersionId: d.currentVersionId }))}
          />
        )}
      </div>
    </div>
  );
}
