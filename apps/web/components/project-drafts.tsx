"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProjectWorkspacePayload, VersionRecord } from "@dramaflow/shared";

import { useI18n } from "../lib/i18n";
import { apiFetch, formatApiError } from "../lib/api";
import { queryKeys } from "../lib/query-keys";
import { ErrorState } from "./error-state";
import { InlineFeedback } from "./inline-feedback";
import { LoadingSkeleton } from "./loading-skeleton";
import { VersionList } from "./project-workspace/version-list";
import { VersionView } from "./project-workspace/version-view";

interface DocumentWithVersions {
  id: string;
  type: string;
  title: string;
  currentVersionId?: string;
  versions: Array<Pick<VersionRecord, "id" | "title" | "versionNumber" | "status" | "content" | "createdAt">>;
}

export function ProjectDrafts({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [feedback, setFeedback] = useState<{ message: string | null; error: string | null }>({ message: null, error: null });

  const [selectedDocId, setSelectedDocId] = useState<string>("");
  const [selectedVersionId, setSelectedVersionId] = useState<string>("");

  const projectQuery = useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: () => apiFetch<ProjectWorkspacePayload>(`/projects/${projectId}`),
  });

  const rawDocuments = projectQuery.data?.documents ?? [];
  const rawVersions = projectQuery.data?.versions ?? [];

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

  const [manualTitle, setManualTitle] = useState(t("projectWorkspace.manualVersion.defaultTitle"));
  const [manualContent, setManualContent] = useState("");

  const createVersionMutation = useMutation({
    mutationFn: async () => {
      const targetDocId = selectedDocId || documents[0]?.id;
      if (!targetDocId) throw new Error(t("projectWorkspace.manualVersion.noDocumentError"));
      let parsed: unknown = manualContent;
      try { parsed = JSON.parse(manualContent); } catch { parsed = { raw: manualContent }; }
      return apiFetch<Pick<VersionRecord, "id" | "versionNumber">>(
        `/documents/${targetDocId}/versions`,
        { method: "POST", body: { title: manualTitle, content: parsed, metadata: { source: "manual-editor" } } },
      );
    },
    onSuccess: async (version) => {
      setFeedback({ message: t("projectWorkspace.feedback.createVersionSuccess", { versionNumber: version.versionNumber }), error: null });
      await queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
    },
    onError: (error) => setFeedback({ message: null, error: formatApiError(error, t, "projectWorkspace.feedback.createVersionFailed") }),
  });

  if (projectQuery.isPending) return <div style={{ padding: "var(--space-8)" }}><LoadingSkeleton rows={8} /></div>;
  if (projectQuery.error || !projectQuery.data) return <ErrorState title={t("projectWorkspace.loadErrorTitle")} description={t("projectWorkspace.loadErrorDescription")} action={<button className="primary-btn" onClick={() => void projectQuery.refetch()}>{t("common.reload")}</button>} />;

  return (
    <div style={{ padding: "var(--space-8)" }}>
      <h2 className="heading-3" style={{ marginBottom: "var(--space-6)" }}>{t("projectWorkspace.drafts.title")}</h2>
      <InlineFeedback message={feedback.message} error={feedback.error} />
      <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: "var(--space-8)" }}>
        <div>
          <VersionList
            documents={documents}
            selectedDocId={selectedDocId || documents[0]?.id || ""}
            selectedVersionId={selectedVersionId}
            onSelectDoc={(id) => {
              setSelectedDocId(id);
              const doc = documents.find((d) => d.id === id);
              if (doc?.versions[0]) setSelectedVersionId(doc.versions[0].id);
            }}
            onSelectVersion={(id) => setSelectedVersionId(id)}
          />
          <hr className="divider" />
          <div>
            <span className="faint text-sm" style={{ display: "block", marginBottom: "var(--space-3)" }}>{t("projectWorkspace.manualVersion.sectionTitle")}</span>
            <div className="form-group" style={{ marginBottom: "var(--space-3)" }}>
              <input className="input" placeholder={t("projectWorkspace.manualVersion.titlePlaceholder")} value={manualTitle} onChange={(e) => setManualTitle(e.target.value)} />
            </div>
            <div className="form-group" style={{ marginBottom: "var(--space-3)" }}>
              <textarea className="input" placeholder={t("projectWorkspace.manualVersion.contentPlaceholder")} value={manualContent} onChange={(e) => setManualContent(e.target.value)} style={{ minHeight: 80 }} />
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => { setFeedback({ message: null, error: null }); createVersionMutation.mutate(); }} disabled={createVersionMutation.isPending || (!selectedDocId && !documents[0]) || !manualTitle.trim()}>
              {createVersionMutation.isPending ? "..." : t("projectWorkspace.manualVersion.createAction")}
            </button>
          </div>
        </div>
        <div>
          <VersionView version={selectedVersion ?? null} projectId={projectId} isLoading={projectQuery.isFetching && !projectQuery.data} />
        </div>
      </div>
    </div>
  );
}
