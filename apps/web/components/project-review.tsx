"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ProjectWorkspacePayload, VersionRecord } from "@dramaflow/shared";

import { useI18n, getReviewPolicyLabel, getVersionStatusLabel } from "../lib/i18n";
import { apiFetch } from "../lib/api";
import { queryKeys } from "../lib/query-keys";
import { ErrorState } from "./error-state";
import { LoadingSkeleton } from "./loading-skeleton";
import { VersionList } from "./project-workspace/version-list";
import { ReviewPanel } from "./project-workspace/review-panel";

interface DocumentWithVersions {
  id: string;
  type: string;
  title: string;
  currentVersionId?: string;
  versions: Array<Pick<VersionRecord, "id" | "title" | "versionNumber" | "status" | "content" | "createdAt">>;
}

export function ProjectReview({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [selectedDocId, setSelectedDocId] = useState<string>("");
  const [selectedVersionId, setSelectedVersionId] = useState<string>("");

  const projectQuery = useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: () => apiFetch<ProjectWorkspacePayload>(`/projects/${projectId}`),
  });

  const project = projectQuery.data?.project;
  const rawDocuments = projectQuery.data?.documents ?? [];
  const rawVersions = projectQuery.data?.versions ?? [];

  const updatePolicy = useMutation({
    mutationFn: (mode: string) =>
      apiFetch(`/projects/${projectId}/review-policy`, {
        method: "PATCH",
        body: { reviewPolicyMode: mode },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
  });

  const submitVersion = useMutation({
    mutationFn: (versionId: string) => apiFetch(`/versions/${versionId}/submit`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
  });

  const approveVersion = useMutation({
    mutationFn: (versionId: string) => apiFetch(`/versions/${versionId}/approve`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
  });

  const rejectVersion = useMutation({
    mutationFn: (versionId: string) => apiFetch(`/versions/${versionId}/reject`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
  });

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

  if (projectQuery.isPending) return <div style={{ padding: "var(--space-8)" }}><LoadingSkeleton rows={8} /></div>;
  if (projectQuery.error || !projectQuery.data) return <ErrorState title={t("projectWorkspace.loadErrorTitle")} description={t("projectWorkspace.loadErrorDescription")} action={<button className="primary-btn" onClick={() => void projectQuery.refetch()}>{t("common.reload")}</button>} />;

  const selectedVersion = useMemo(() => {
    if (!selectedVersionId) return null;
    for (const doc of documents) {
      const v = doc.versions.find((v) => v.id === selectedVersionId);
      if (v) return v;
    }
    return null;
  }, [documents, selectedVersionId]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "var(--space-4) var(--space-6)", borderBottom: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 className="heading-4" style={{ margin: 0 }}>{t("projectWorkspace.review.title")}</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", background: "var(--bg-surface)", padding: "4px 8px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
          <span className="text-sm font-medium">{t("projectWorkspace.reviewPolicy.label")}</span>
          <select 
            className="input" 
            style={{ width: "160px", padding: "4px 8px", height: "28px", fontSize: "12px" }}
            value={project?.reviewPolicyMode ?? "inherit"}
            onChange={(e) => updatePolicy.mutate(e.target.value)}
            disabled={updatePolicy.isPending}
          >
            <option value="inherit">{getReviewPolicyLabel(t, "inherit")}</option>
            <option value="required">{getReviewPolicyLabel(t, "required")}</option>
            <option value="bypass">{getReviewPolicyLabel(t, "bypass")}</option>
          </select>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr 340px", flex: 1, minHeight: 0 }}>
        {/* Left Col: Timeline */}
        <div style={{ borderRight: "1px solid var(--border-subtle)", overflowY: "auto", background: "var(--bg-surface)" }}>
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
        </div>
        
        {/* Mid Col: Viewer */}
        <div style={{ background: "var(--bg-canvas)", overflowY: "auto", position: "relative" }}>
          <div style={{ maxWidth: "800px", margin: "0 auto", padding: "var(--space-8)" }}>
            {selectedVersion ? (
              <div style={{ background: "var(--bg-surface)", padding: "var(--space-8)", borderRadius: "var(--radius-lg)", boxShadow: "0 4px 20px rgba(0,0,0,0.05)", minHeight: "60vh", display: "flex", flexDirection: "column" }}>
                 <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "var(--space-4)" }}>
                   <div>
                     <h1 className="heading-3" style={{ marginBottom: "var(--space-2)" }}>{selectedVersion.title}</h1>
                     <span className={`badge badge-${selectedVersion.status === 'approved' ? 'success' : selectedVersion.status === 'rejected' ? 'error' : 'neutral'}`}>
                        {getVersionStatusLabel(t, selectedVersion.status as any)}
                      </span>
                   </div>
                   
                   <div style={{ display: "flex", gap: "var(--space-2)" }}>
                     {selectedVersion.status === "draft" && (
                       <button 
                         className="btn btn-primary" 
                         onClick={() => submitVersion.mutate(selectedVersion.id)}
                         disabled={submitVersion.isPending}
                       >
                          {submitVersion.isPending ? t("common.submitting") : t("projectWorkspace.review.submitForReview")}
                       </button>
                     )}
                     {selectedVersion.status === "submitted" && (
                       <>
                         <button 
                           className="btn btn-secondary" 
                           onClick={() => rejectVersion.mutate(selectedVersion.id)}
                           disabled={rejectVersion.isPending}
                         >
                            {t("projectWorkspace.versions.rejectAction")}
                         </button>
                         <button 
                           className="btn btn-primary" 
                           onClick={() => approveVersion.mutate(selectedVersion.id)}
                           disabled={approveVersion.isPending}
                         >
                            {t("projectWorkspace.versions.approveAction")}
                         </button>
                       </>
                     )}
                   </div>
                 </div>
                 <hr style={{ border: "none", borderTop: "1px solid var(--border-subtle)", margin: "var(--space-4) 0" }} />
                 <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.8, color: "var(--text-primary)", fontSize: "15px", fontFamily: "var(--font-cjk)" }}>
                   {typeof selectedVersion.content === "string" ? selectedVersion.content : JSON.stringify(selectedVersion.content, null, 2)}
                 </div>
              </div>
            ) : (
              <div className="empty-state" style={{ height: "100%", marginTop: "10vh" }}>
                <div className="empty-state-title">{t("projectWorkspace.review.selectVersion")}</div>
                 <div className="empty-state-description">{t("projectWorkspace.review.selectVersionHint")}</div>
              </div>
            )}
          </div>
        </div>

        {/* Right Col: Discuss */}
        <div style={{ borderLeft: "1px solid var(--border-subtle)", overflowY: "auto", background: "var(--bg-surface)", display: "flex", flexDirection: "column" }}>
          {selectedVersionId ? (
            <ReviewPanel versionId={selectedVersionId} />
          ) : (
            <div className="empty-state" style={{ padding: "var(--space-6)" }}>
              <div className="empty-state-description">{t("projectWorkspace.review.noVersionDiscussion")}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
