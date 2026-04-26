/**
 * @fileoverview 统一工作区
 * @module web/components
 *
 * 项目文档编辑和 AI 生成的统一工作区界面。
 */

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  normalizeScriptContent,
  normalizeStoryboardContent,
  normalizeWorldBibleContent,
  type ExportRecord,
  type ProjectVersionsResponse,
  type ProjectWorkspacePayload,
  type ProjectWorkspaceSummaryPayload,
  type RealtimeJobUpdatedEvent,
  type RealtimeReviewUpdatedEvent,
  type ScriptContent,
  type StoryboardContent,
  type WorldBibleContent,
  type TaskListResponse,
  type TimelineResponse,
  type VersionRecord,
} from "@dramaflow/shared";

import { useI18n } from "../lib/i18n";
import { apiFetch, formatApiError } from "../lib/api";
import { queryKeys } from "../lib/query-keys";
import { ErrorState } from "./error-state";
import { InlineFeedback } from "./inline-feedback";
import { LoadingSkeleton } from "./loading-skeleton";
import { VersionList } from "./project-workspace/version-list";
import { VersionView } from "./project-workspace/version-view";
import { VideoDocumentViewer } from "./project-workspace/video-document-viewer";
import { VersionDiffView } from "./project-workspace/version-diff-view";
import { RichScriptEditor } from "./project-workspace/rich-script-editor";
import { StoryboardEditor } from "./project-workspace/storyboard-editor";
import { TextGeneratorPanel } from "./project-workspace/text-generator-panel";
import { JobStatusBar } from "./project-workspace/job-status-bar";
import { RightContextPanel } from "./project-workspace/right-context-panel";
import { ReviewPolicySwitcher } from "./review-policy-switcher";
import { ProjectInfoPanel } from "./project-workspace/project-info-panel";
import { WorldBibleEditor } from "./project-workspace/world-bible-editor";
import { TaskPanel } from "./project-workspace/task-panel";
import { TimelineEditor } from "./project-workspace/timeline-editor";
import { useRealtime } from "./realtime-provider";

// Workspace modes: document (with sub-tabs: view/edit/generate), info, tasks, timeline
type WorkspaceMode = "document" | "info" | "tasks" | "timeline";

// Sub-tabs within document mode
type DocSubTab = "view" | "edit" | "generate";

// Backward-compat mapping for old URL mode params
const MODE_COMPAT_MAP: Record<string, WorkspaceMode> = {
  view: "document",
  edit: "document",
  document: "document",
  generate: "document",
  info: "info",
  worldbible: "document",
  tasks: "tasks",
  timeline: "timeline",
};

const VIRTUAL_SYNOPSIS_DOC_ID = "__virtual_synopsis__";
const VIRTUAL_VIDEO_DOC_ID = "__video_timeline__";

interface DocumentWithVersions {
  id: string;
  type: string;
  title: string;
  shotId?: string;
  currentVersionId?: string;
  versions: Array<Pick<VersionRecord, "id" | "title" | "versionNumber" | "status" | "content" | "createdAt">>;
}


function mergeProjectJobs(
  current: TaskListResponse | undefined,
  nextJob: TaskListResponse["jobs"][number],
): TaskListResponse {
  const existingJobs = current?.jobs ?? [];
  const jobs = [nextJob, ...existingJobs.filter((job) => job.id !== nextJob.id)]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  return {
    jobs,
    total: current ? Math.max(current.total, jobs.length) : jobs.length,
  };
}

/* 閳光偓閳光偓 Inline SVG Icons 閳光偓閳光偓 */
function DocumentIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M4 1h4.5L11 3.5V12a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8.5 1v2.5H11" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5 7h4M5 9.5h2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
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

function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M7 6v4M7 4.5v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function TaskIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="2" y="1.5" width="10" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 5h4M5 7.5h4M5 10h2.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <circle cx="3.5" cy="5" r="0.6" fill="currentColor" />
      <circle cx="3.5" cy="7.5" r="0.6" fill="currentColor" />
      <circle cx="3.5" cy="10" r="0.6" fill="currentColor" />
    </svg>
  );
}

function TimelineIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1" y="2.5" width="12" height="2" rx="0.5" stroke="currentColor" strokeWidth="1.1" />
      <rect x="1" y="6" width="8" height="2" rx="0.5" stroke="currentColor" strokeWidth="1.1" />
      <rect x="1" y="9.5" width="10" height="2" rx="0.5" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

function PanelIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M9.5 1.5v11" stroke="currentColor" strokeWidth="1.3" />
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

function MenuIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2 3.5h10M2 7h10M2 10.5h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M4.5 2.5l3.5 3.5-3.5 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function UnifiedWorkspace({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { connected, socket, subscribeProject, unsubscribeProject } = useRealtime();

  // Parse initial mode with backward compat
  const rawMode = searchParams.get("mode") || "document";
  const rawSub = searchParams.get("sub") || "";
  const initialMode = MODE_COMPAT_MAP[rawMode] || "document";

  const [mode, setMode] = useState<WorkspaceMode>(initialMode);
  const [isEditing, setIsEditing] = useState(rawMode === "edit"); // If came from edit redirect
  const [docSubTab, setDocSubTab] = useState<DocSubTab>(() => {
    if (rawMode === "generate" || rawSub === "generate") return "generate";
    if (rawMode === "edit" || rawSub === "edit") return "edit";
    return "view";
  });
  const [rightPanelOpen, setRightPanelOpen] = useState(true);

  // Hydrate panel state from localStorage after mount
  useEffect(() => {
    const storedRight = localStorage.getItem("uw-right-panel");
    if (storedRight === "false") setRightPanelOpen(false);

    const storedLeft = localStorage.getItem("uw-left-panel");
    if (storedLeft === "false") setLeftPanelOpen(false);
  }, []);
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [selectedDocId, setSelectedDocId] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(false);
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string | null; error: string | null }>({ message: null, error: null });
  const [editorInitialContent, setEditorInitialContent] = useState<ScriptContent | null>(null);
  const [storyboardEditorInitialContent, setStoryboardEditorInitialContent] = useState<StoryboardContent | null>(null);
  const [worldBibleEditorInitialContent, setWorldBibleEditorInitialContent] = useState<WorldBibleContent | null>(null);
  const [editorSessionKey, setEditorSessionKey] = useState(0);
  const [showDiff, setShowDiff] = useState(false);

  const projectQuery = useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: () => apiFetch<ProjectWorkspaceSummaryPayload>(`/projects/${projectId}`),
  });

  const versionsQuery = useQuery({
    queryKey: queryKeys.projectVersions(projectId),
    queryFn: () => apiFetch<ProjectVersionsResponse>(`/projects/${projectId}/versions`),
    enabled: Boolean(projectQuery.data),
  });

  const jobsQuery = useQuery({
    queryKey: queryKeys.projectJobs(projectId),
    queryFn: () => apiFetch<TaskListResponse>(`/projects/${projectId}/jobs?limit=100`),
    enabled: Boolean(projectQuery.data),
  });

  const timelineQuery = useQuery({
    queryKey: queryKeys.timeline(projectId),
    queryFn: () => apiFetch<TimelineResponse>(`/projects/${projectId}/timeline`),
    enabled: Boolean(projectQuery.data) && mode === "timeline",
  });

  const exportsQuery = useQuery({
    queryKey: queryKeys.exports(projectId),
    queryFn: () => apiFetch<ExportRecord[]>(`/projects/${projectId}/exports`),
    enabled: Boolean(projectQuery.data) && mode === "timeline",
  });

  const rawDocuments = projectQuery.data?.documents ?? [];
  const rawVersions = versionsQuery.data?.versions ?? [];
  const jobs = jobsQuery.data?.jobs ?? [];
  const hasActiveJobs = jobs.some((j) => j.status === "queued" || j.status === "running");
  const previousHasActiveJobs = useRef(hasActiveJobs);

  useEffect(() => {
    if (!hasActiveJobs || connected) return;
    const interval = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectJobs(projectId) });
    }, 5000);
    return () => clearInterval(interval);
  }, [connected, hasActiveJobs, projectId, queryClient]);

  useEffect(() => {
    if (previousHasActiveJobs.current && !hasActiveJobs) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectVersions(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.timeline(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.exports(projectId) });
    }
    previousHasActiveJobs.current = hasActiveJobs;
  }, [hasActiveJobs, projectId, queryClient]);

  useEffect(() => {
    if (!projectId) {
      return;
    }

    subscribeProject(projectId);
    return () => unsubscribeProject(projectId);
  }, [projectId, subscribeProject, unsubscribeProject]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    async function handleJobUpdated(event: RealtimeJobUpdatedEvent) {
      if (event.projectId !== projectId) {
        return;
      }

      queryClient.setQueryData<TaskListResponse>(queryKeys.projectJobs(projectId), (current) => mergeProjectJobs(current, event.job));

      if (event.job.type === "export_video") {
        void queryClient.invalidateQueries({ queryKey: queryKeys.exports(projectId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.timeline(projectId) });
      }

      if (event.job.status === "completed" || event.job.status === "failed") {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.projectVersions(projectId) }),
        ]);
      }
    }

    function handleReviewUpdated(event: RealtimeReviewUpdatedEvent) {
      if (event.projectId !== projectId) {
        return;
      }

      void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectVersions(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.versionComments(event.versionId) });
    }

    socket.on("job.updated", handleJobUpdated);
    socket.on("review.updated", handleReviewUpdated);

    return () => {
      socket.off("job.updated", handleJobUpdated);
      socket.off("review.updated", handleReviewUpdated);
    };
  }, [projectId, queryClient, socket]);

  const documents: DocumentWithVersions[] = useMemo(() => {
    const docTypes = new Set(["synopsis", "script", "storyboard", "world_bible"]);
    const typeOrder: Record<string, number> = { world_bible: 0, synopsis: 1, script: 2, storyboard: 3 };
    const realDocs = rawDocuments
      .filter((doc) => docTypes.has(doc.type))
      .sort((a, b) => (typeOrder[a.type] ?? 99) - (typeOrder[b.type] ?? 99))
      .map((doc) => {
      const docVersions = rawVersions
        .filter((v) => v.documentId === doc.id)
        .sort((a, b) => b.versionNumber - a.versionNumber);
      return {
        id: doc.id,
        type: doc.type,
        title: doc.title,
        shotId: doc.shotId,
        currentVersionId: doc.currentVersionId,
        versions: docVersions,
      };
    });

    // Ensure synopsis always appears in sidebar even before first generation
    const hasSynopsis = realDocs.some((d) => d.type === "synopsis");
    if (!hasSynopsis) {
      realDocs.push({
        id: VIRTUAL_SYNOPSIS_DOC_ID,
        type: "synopsis",
        title: "",
        shotId: undefined,
        currentVersionId: undefined,
        versions: [],
      });
      realDocs.sort((a, b) => (typeOrder[a.type] ?? 99) - (typeOrder[b.type] ?? 99));
    }

    // Append virtual video entry that navigates to timeline mode
    realDocs.push({
      id: VIRTUAL_VIDEO_DOC_ID,
      type: "video",
      title: "",
      shotId: undefined,
      currentVersionId: undefined,
      versions: [],
    });

    return realDocs;
  }, [rawDocuments, rawVersions]);

  // Auto-select first document/version (skip virtual video entry)
  useEffect(() => {
    const contentDocs = documents.filter((d) => d.id !== VIRTUAL_VIDEO_DOC_ID);
    if (!contentDocs.length) return;

    const selectableDocs = contentDocs.filter((d) => d.id !== VIRTUAL_SYNOPSIS_DOC_ID || d.versions.length > 0);
    const defaultDoc = selectableDocs.find((d) => d.versions.length > 0) ?? selectableDocs[0] ?? contentDocs[0];
    const activeDoc = selectedDocId ? documents.find((d) => d.id === selectedDocId) ?? defaultDoc : defaultDoc;
    if (!activeDoc || activeDoc.id === VIRTUAL_VIDEO_DOC_ID) return;
    if (!selectedDocId || activeDoc.id !== selectedDocId) setSelectedDocId(activeDoc.id);
    if (selectedVersionId && !activeDoc.versions.some((version) => version.id === selectedVersionId)) {
      setSelectedVersionId(activeDoc.versions[0]?.id ?? "");
      return;
    }
    if (!selectedVersionId && activeDoc.versions[0]) setSelectedVersionId(activeDoc.versions[0].id);
  }, [documents, selectedDocId, selectedVersionId]);

  const selectedDoc = useMemo(
    () => documents.find((d) => d.id === selectedDocId) ?? documents.find((d) => d.id !== VIRTUAL_VIDEO_DOC_ID) ?? null,
    [documents, selectedDocId],
  );

  const selectedVersion = useMemo(() => {
    return selectedDoc?.versions.find((version) => version.id === selectedVersionId) ?? null;
  }, [selectedDoc, selectedVersionId]);

  const isSynopsisDoc = selectedDoc?.type === "synopsis";
  const isScriptDoc = selectedDoc?.type === "script";
  const isStoryboardDoc = selectedDoc?.type === "storyboard";
  const isVideoDoc = selectedDoc?.type === "video";
  const isWorldBibleDoc = selectedDoc?.type === "world_bible";

  // Version creation (for editor save)
  const createVersionMutation = useMutation({
    mutationFn: async (payload: { title: string; content: unknown }) => {
      const targetDocId = selectedDoc?.id;
      if (!targetDocId || targetDocId === VIRTUAL_SYNOPSIS_DOC_ID || targetDocId === VIRTUAL_VIDEO_DOC_ID) {
        throw new Error(t("projectWorkspace.manualVersion.noDocumentError"));
      }
      return apiFetch<Pick<VersionRecord, "id" | "versionNumber">>(
        `/documents/${targetDocId}/versions`,
        { method: "POST", body: { title: payload.title, content: payload.content, metadata: { source: "unified-workspace" } } },
      );
    },
    onSuccess: async (version) => {
      setFeedback({ message: t("projectWorkspace.feedback.createVersionSuccess", { versionNumber: version.versionNumber }), error: null });
      setIsEditing(false);
      setSelectedVersionId(version.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projectVersions(projectId) }),
      ]);
    },
    onError: (error) => setFeedback({ message: null, error: formatApiError(error, t, "projectWorkspace.feedback.createVersionFailed") }),
  });

  // Update existing draft version in-place (for inline storyboard edits)
  const updateVersionMutation = useMutation({
    mutationFn: async (payload: { versionId: string; content: unknown }) => {
      return apiFetch<Pick<VersionRecord, "id" | "versionNumber">>(
        `/versions/${payload.versionId}`,
        { method: "PATCH", body: { content: payload.content } },
      );
    },
    onSuccess: async () => {
      setFeedback({ message: t("projectWorkspace.feedback.updateDraftSuccess"), error: null });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projectVersions(projectId) }),
      ]);
    },
    onError: (error) => setFeedback({ message: null, error: formatApiError(error, t, "projectWorkspace.feedback.updateDraftFailed") }),
  });

  // Submit a draft version for review
  const submitVersionMutation = useMutation({
    mutationFn: async (versionId: string) => {
      return apiFetch(`/versions/${versionId}/submit`, { method: "POST" });
    },
    onSuccess: async () => {
      setFeedback({ message: t("projectWorkspace.versions.submitAction"), error: null });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projectVersions(projectId) }),
      ]);
    },
    onError: (error) => setFeedback({ message: null, error: formatApiError(error, t, "projectWorkspace.feedback.versionActionFailed") }),
  });

  // Approve a pending version
  const approveVersionMutation = useMutation({
    mutationFn: async (versionId: string) => {
      return apiFetch(`/versions/${versionId}/approve`, { method: "POST" });
    },
    onSuccess: async () => {
      setFeedback({ message: t("projectWorkspace.versions.approveAction"), error: null });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projectVersions(projectId) }),
      ]);
    },
    onError: (error) => setFeedback({ message: null, error: formatApiError(error, t, "projectWorkspace.feedback.versionActionFailed") }),
  });

  // Reject a pending version
  const rejectVersionMutation = useMutation({
    mutationFn: async (versionId: string) => {
      return apiFetch(`/versions/${versionId}/reject`, { method: "POST" });
    },
    onSuccess: async () => {
      setFeedback({ message: t("projectWorkspace.versions.rejectAction"), error: null });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projectVersions(projectId) }),
      ]);
    },
    onError: (error) => setFeedback({ message: null, error: formatApiError(error, t, "projectWorkspace.feedback.versionActionFailed") }),
  });

  function handleEditorSave(title: string, content: ScriptContent | StoryboardContent | WorldBibleContent) {
    setFeedback({ message: null, error: null });
    createVersionMutation.mutate({ title, content });
  }

  function handleInlineStoryboardChange(content: StoryboardContent) {
    setFeedback({ message: null, error: null });
    // If the current version is already a draft, update it in-place
    if (selectedVersion && selectedVersion.status === "draft") {
      updateVersionMutation.mutate({ versionId: selectedVersion.id, content });
      return;
    }
    // Otherwise create a new draft version
    createVersionMutation.mutate({ title: "Inline edit", content });
  }

  function openEditor(fromVersion?: typeof selectedVersion) {
    if (isSynopsisDoc) {
      return;
    }

    if (isStoryboardDoc) {
      setStoryboardEditorInitialContent(
        fromVersion ? normalizeStoryboardContent(fromVersion.content) : null,
      );
    } else if (isWorldBibleDoc) {
      setWorldBibleEditorInitialContent(
        fromVersion ? normalizeWorldBibleContent(fromVersion.content) : null,
      );
    } else {
      setEditorInitialContent(
        fromVersion ? normalizeScriptContent(fromVersion.content) : null,
      );
    }
    setEditorSessionKey((k) => k + 1);
    setIsEditing(true);
  }

  function handleEditResult(content: ScriptContent | StoryboardContent | WorldBibleContent) {
    if ("shots" in content || "overview" in content) {
      const storyboardDoc = documents.find((doc) => doc.type === "storyboard");
      if (storyboardDoc) {
        setSelectedDocId(storyboardDoc.id);
        setSelectedVersionId(storyboardDoc.currentVersionId ?? storyboardDoc.versions[0]?.id ?? "");
      }
      setStoryboardEditorInitialContent(normalizeStoryboardContent(content));
    } else if ("locations" in content || "styleGuide" in content || "voiceConfigs" in content) {
      const worldBibleDoc = documents.find((doc) => doc.type === "world_bible");
      if (worldBibleDoc) {
        setSelectedDocId(worldBibleDoc.id);
        setSelectedVersionId(worldBibleDoc.currentVersionId ?? worldBibleDoc.versions[0]?.id ?? "");
      }
      setWorldBibleEditorInitialContent(normalizeWorldBibleContent(content));
    } else {
      const scriptDoc = documents.find((doc) => doc.type === "script");
      if (scriptDoc) {
        setSelectedDocId(scriptDoc.id);
        setSelectedVersionId(scriptDoc.currentVersionId ?? scriptDoc.versions[0]?.id ?? "");
      }
      setEditorInitialContent(normalizeScriptContent(content as ScriptContent));
    }
    setDocSubTab("edit");
  }

  function handleModeChange(newMode: string) {
    const mapped = MODE_COMPAT_MAP[newMode] || (newMode as WorkspaceMode);
    setMode(mapped);
    if (mapped !== "document") {
      setIsEditing(false);
      setDocSubTab("view");
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("mode", mapped);
    params.delete("sub");
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  function handleSubTabChange(sub: DocSubTab) {
    const nextSub = sub === "edit" && isSynopsisDoc ? "generate" : sub;
    setDocSubTab(nextSub);
    if (nextSub === "edit") {
      openEditor(selectedVersion);
    } else {
      setIsEditing(false);
    }
    const params = new URLSearchParams(searchParams.toString());
    if (nextSub !== "view") {
      params.set("sub", nextSub);
    } else {
      params.delete("sub");
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  // Sync URL -> state (for external navigation like sidebar links)
  useEffect(() => {
    const currentMode = searchParams.get("mode") || "document";
    const mapped = MODE_COMPAT_MAP[currentMode] || currentMode;
    if (mapped !== mode) {
      setMode(mapped as WorkspaceMode);
    }
    // Sync sub-tab from URL
    if (mapped === "document") {
      const subParam = searchParams.get("sub");
      if (subParam === "generate") setDocSubTab("generate");
      else if (subParam === "edit") setDocSubTab("edit");
      else if (subParam === "view" || !subParam) {
        // Only reset if coming from external navigation
        if (currentMode !== "document") setDocSubTab("view");
      }
    }
  }, [mode, searchParams]);

  useEffect(() => {
    if (mode === "document" && docSubTab === "edit" && isSynopsisDoc) {
      handleSubTabChange("generate");
    }
  }, [docSubTab, isSynopsisDoc, mode]);

  const modeConfig = [
    { key: "info" as const, label: t("projectWorkspace.workspace.modeInfo"), icon: InfoIcon },
    { key: "document" as const, label: t("projectWorkspace.workspace.modeDocument"), icon: DocumentIcon },
    { key: "tasks" as const, label: t("projectWorkspace.workspace.modeTasks"), icon: TaskIcon },
    { key: "timeline" as const, label: t("projectWorkspace.workspace.modeTimeline"), icon: TimelineIcon },
  ];

  if (projectQuery.isPending || (projectQuery.data && versionsQuery.isPending && !versionsQuery.data)) {
    return (
      <div style={{ padding: "var(--space-8)" }}>
        <LoadingSkeleton rows={8} />
      </div>
    );
  }

  if (projectQuery.error || versionsQuery.error || !projectQuery.data || !versionsQuery.data) {
    return (
      <ErrorState
        title={t("projectWorkspace.loadErrorTitle")}
        description={formatApiError(projectQuery.error ?? versionsQuery.error, t, "projectWorkspace.loadErrorDescription")}
        action={
          <button
            className="primary-btn"
            type="button"
            onClick={() => {
              void Promise.all([projectQuery.refetch(), versionsQuery.refetch()]);
            }}
          >
            {t("common.reload")}
          </button>
        }
      />
    );
  }

  const payload: ProjectWorkspacePayload = {
    ...projectQuery.data,
    versions: versionsQuery.data.versions,
    jobs,
    timeline: timelineQuery.data,
    exports: exportsQuery.data,
  };

  const storyboardDocument = payload.documents.find((document) => document.type === "storyboard");
  const storyboardVersion = payload.versions.find((version) => version.id === storyboardDocument?.currentVersionId);
  const storyboardShots = normalizeStoryboardContent(storyboardVersion?.content).shots;

  const isInfoMode = mode === "info";
  const isTasksMode = mode === "tasks";
  const isTimelineMode = mode === "timeline";
  const showThreeColumnLayout = !isInfoMode && !isTasksMode && !isTimelineMode;
  const isDocumentMode = mode === "document";

  return (
    <div className="uw-root animate-fade-in">
      {/* Mode Switcher Bar with Breadcrumb */}
      <div className="uw-mode-bar">
        <div className="uw-mode-bar-left">
          {/* Breadcrumb */}
          <nav className="uw-breadcrumb" aria-label="breadcrumb">
            <Link href="/dashboard" className="uw-breadcrumb-link">
              {t("projectWorkspace.workspace.breadcrumbProjects")}
            </Link>
            <span className="uw-breadcrumb-sep"><ChevronRightIcon /></span>
            <button
              className="uw-breadcrumb-current"
              type="button"
              onClick={() => handleModeChange("document")}
              title={payload.project.name}
            >
              {payload.project.name}
            </button>
          </nav>

          <div className="uw-mode-tabs">
            {modeConfig.map((m) => (
              <button
                key={m.key}
                className={`uw-mode-tab${mode === m.key ? " uw-mode-tab--active" : ""}`}
                onClick={() => handleModeChange(m.key)}
                type="button"
              >
                <m.icon />
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          {/* Mobile drawer toggles (visible only <1024px) */}
          {showThreeColumnLayout && !isDocumentMode && (
            <div className="uw-mobile-toggles">
              <button className="uw-panel-toggle" type="button" onClick={() => setLeftDrawerOpen(true)}>
                <MenuIcon />
                {t("projectWorkspace.workspace.modeDocument")}
              </button>
              <button className="uw-panel-toggle" type="button" onClick={() => setRightDrawerOpen(true)}>
                <PanelIcon />
                {t("projectWorkspace.workspace.reviewActions")}
              </button>
            </div>
          )}
          {/* Editing state indicator */}
          {mode === "document" && docSubTab === "edit" && (
            <span className="uw-editing-badge">
              <EditIcon />
              {t("projectWorkspace.workspace.editingState")}
            </span>
          )}
          {showThreeColumnLayout && !isDocumentMode && (
            <>
              <ReviewPolicySwitcher
                projectId={projectId}
                currentMode={payload.project.reviewPolicyMode}
                variant="compact"
              />
              <button
                className={`uw-panel-toggle${rightPanelOpen ? " uw-panel-toggle--active" : ""}`}
                type="button"
                onClick={() => {
                  const next = !rightPanelOpen;
                  setRightPanelOpen(next);
                  localStorage.setItem("uw-right-panel", String(next));
                }}
              >
                <PanelIcon />
                {rightPanelOpen ? t("projectWorkspace.workspace.collapsePanel") : t("projectWorkspace.workspace.expandPanel")}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Feedback */}
      <div className="uw-feedback">
        <InlineFeedback message={feedback.message} error={feedback.error} />
      </div>

      {/* Info mode: full-width content */}
      {isInfoMode && (
        <div className="uw-info-scroll">
          <div className="uw-info-inner">
            <ProjectInfoPanel
              projectId={projectId}
              payload={payload}
              onNavigateToVersion={(documentId, versionId) => {
                setSelectedDocId(documentId);
                setSelectedVersionId(versionId);
                setDocSubTab("view");
                handleModeChange("document");
              }}
            />
          </div>
        </div>
      )}

      {/* Tasks mode: full-width content */}
      {isTasksMode && (
        <div className="uw-info-scroll">
          <div className="uw-info-inner">
            <TaskPanel projectId={projectId} shotIds={storyboardShots.map((shot) => shot.id)} />
          </div>
        </div>
      )}

      {/* Timeline mode: full-width content */}
      {isTimelineMode && (
        <div className="uw-info-scroll">
          <div className="uw-info-inner">
            <TimelineEditor
              projectId={projectId}
              data={payload}
              onRefresh={() => {
                void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
                void queryClient.invalidateQueries({ queryKey: queryKeys.timeline(projectId) });
                void queryClient.invalidateQueries({ queryKey: queryKeys.exports(projectId) });
                void queryClient.invalidateQueries({ queryKey: queryKeys.projectJobs(projectId) });
              }}
            />
          </div>
        </div>
      )}

      {/* Three-column body for document/generate/media modes */}
      {showThreeColumnLayout && (
        <div className={`uw-body${rightPanelOpen ? "" : " uw-body--collapsed"}${leftPanelOpen ? "" : " uw-body--left-collapsed"}${isDocumentMode ? " uw-body--no-right" : ""}`}>
          {/* Left: Document tree + Job status */}
          <div className="uw-left">
            <div className="uw-left-scroll">
              <VersionList
                documents={documents}
                selectedDocId={selectedDocId || documents[0]?.id || ""}
                selectedVersionId={selectedVersionId}
                onSelectDoc={(id) => {
                  if (id === VIRTUAL_VIDEO_DOC_ID) {
                    handleModeChange("timeline");
                    return;
                  }
                  const doc = documents.find((d) => d.id === id);
                  setSelectedDocId(id);
                  if (docSubTab === "edit") {
                    setDocSubTab(doc?.type === "synopsis" ? "generate" : "view");
                  }
                  setSelectedVersionId(doc?.versions[0]?.id ?? "");
                }}
                onSelectVersion={(id, docId) => {
                  setSelectedVersionId(id);
                  if (docId) setSelectedDocId(docId);
                  if (docSubTab === "edit") setDocSubTab("view");
                }}
                isCollapsed={!leftPanelOpen}
                onToggleCollapse={() => {
                  const next = !leftPanelOpen;
                  setLeftPanelOpen(next);
                  localStorage.setItem("uw-left-panel", String(next));
                }}
                projectId={projectId}
              />
            </div>
            {leftPanelOpen && <JobStatusBar jobs={jobs} />}
          </div>

          {/* Center: Content area */}
          <div className="uw-center">
            <div className="uw-center-scroll">
              <div className="uw-center-inner">
                {/* Document sub-tab bar */}
                {mode === "document" && (
                  <div className="uw-sub-tabs" role="tablist">
                    <button
                      className={`uw-sub-tab${docSubTab === "view" ? " uw-sub-tab--active" : ""}`}
                      role="tab"
                      aria-selected={docSubTab === "view"}
                      onClick={() => handleSubTabChange("view")}
                      type="button"
                    >
                      <DocumentIcon />
                      {t("projectWorkspace.workspace.modeView")}
                    </button>
                    <button
                      className={`uw-sub-tab${docSubTab === "edit" ? " uw-sub-tab--active" : ""}`}
                      role="tab"
                      aria-selected={docSubTab === "edit"}
                      onClick={() => handleSubTabChange("edit")}
                      type="button"
                      disabled={isSynopsisDoc}
                    >
                      <EditIcon />
                      {t("projectWorkspace.workspace.modeEdit")}
                    </button>
                    <button
                      className={`uw-sub-tab${docSubTab === "generate" ? " uw-sub-tab--active" : ""}`}
                      role="tab"
                      aria-selected={docSubTab === "generate"}
                      onClick={() => handleSubTabChange("generate")}
                      type="button"
                    >
                      <SparkleIcon />
                      {t("projectWorkspace.workspace.modeGenerate")}
                    </button>
                  </div>
                )}

                {/* View sub-tab */}
                <div style={{ display: mode === "document" && docSubTab === "view" && !showDiff ? undefined : "none" }}>
                  {mode === "document" && (
                    <div>
                      {/* Edit button for mobile (<1024px) where right panel is a drawer */}
                      {selectedVersion && (isScriptDoc || isStoryboardDoc || isWorldBibleDoc) && (
                        <div className="uw-edit-bar-mobile">
                          <button className="btn btn-secondary btn-sm" type="button" onClick={() => { openEditor(selectedVersion); handleSubTabChange("edit"); }}>
                            <EditIcon /> <span style={{ marginLeft: 4 }}>{t("projectWorkspace.workspace.startEditing")}</span>
                          </button>
                          {selectedDoc && selectedDoc.versions.length >= 2 && (
                            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setShowDiff(true)}>
                              {t("versionDiff.compareVersions")}
                            </button>
                          )}
                        </div>
                      )}
                      {isVideoDoc && selectedDoc ? (
                        <VideoDocumentViewer
                          projectId={projectId}
                          documentId={selectedDoc.id}
                          shotId={selectedDoc.shotId}
                          project={payload}
                        />
                      ) : (
                        <VersionView
                          version={selectedVersion ?? null}
                          isLoading={(projectQuery.isFetching || jobsQuery.isFetching) && !projectQuery.data}
                          projectId={projectId}
                          project={payload}
                          allowStoryboardMutations={selectedDoc?.currentVersionId === selectedVersion?.id}
                          onStoryboardChange={handleInlineStoryboardChange}
                          onSubmitForReview={(versionId) => submitVersionMutation.mutate(versionId)}
                          isSubmitting={submitVersionMutation.isPending}
                          onApprove={(versionId) => approveVersionMutation.mutate(versionId)}
                          onReject={(versionId) => rejectVersionMutation.mutate(versionId)}
                          isApproving={approveVersionMutation.isPending}
                          isRejecting={rejectVersionMutation.isPending}
                        />
                      )}
                    </div>
                  )}
                </div>

                {/* Diff view (only in view sub-tab) */}
                {mode === "document" && docSubTab === "view" && showDiff && selectedDoc && (
                  <VersionDiffView
                    versions={selectedDoc.versions}
                    onClose={() => setShowDiff(false)}
                  />
                )}

                {/* Edit sub-tab */}
                <div style={{ display: mode === "document" && docSubTab === "edit" ? undefined : "none" }}>
                  {mode === "document" && (
                    isVideoDoc && selectedDoc ? (
                      <VideoDocumentViewer
                        projectId={projectId}
                        documentId={selectedDoc.id}
                        shotId={selectedDoc.shotId}
                        project={payload}
                      />
                    ) : isStoryboardDoc ? (
                      <StoryboardEditor
                        key={`storyboard-${selectedVersionId || "new"}-${editorSessionKey}`}
                        initialContent={storyboardEditorInitialContent}
                        onSave={handleEditorSave}
                        onCancel={() => handleSubTabChange("view")}
                        isSaving={createVersionMutation.isPending}
                        projectId={projectId}
                        project={payload}
                      />
                    ) : isWorldBibleDoc ? (
                      <WorldBibleEditor
                        key={`worldbible-${selectedVersionId || "new"}-${editorSessionKey}`}
                        initialContent={worldBibleEditorInitialContent}
                        onSave={handleEditorSave}
                        onCancel={() => handleSubTabChange("view")}
                        isSaving={createVersionMutation.isPending}
                        projectId={projectId}
                      />
                    ) : isScriptDoc ? (
                      <RichScriptEditor
                        key={`script-${selectedVersionId || "new"}-${editorSessionKey}`}
                        initialContent={editorInitialContent}
                        onSave={handleEditorSave}
                        onCancel={() => handleSubTabChange("view")}
                        isSaving={createVersionMutation.isPending}
                      />
                    ) : null
                  )}
                </div>

                {/* Generate sub-tab (always mounted to preserve streaming state) */}
                <div style={{ display: mode === "document" && docSubTab === "generate" ? undefined : "none" }}>
                  <TextGeneratorPanel projectId={projectId} project={payload} selectedVersion={selectedVersion} onEditResult={handleEditResult} />
                </div>

              </div>
            </div>
          </div>

          {/* Right: Context panel (media mode only; document mode uses drawer in StoryboardWorkbench) */}
          {!isDocumentMode && (
            <div className="uw-right">
              <RightContextPanel
                projectId={projectId}
                selectedVersionId={selectedVersionId}
                selectedVersion={selectedVersion}
                currentMode={mode}
                docSubTab={docSubTab}
                isEditing={isEditing}
                onStartEdit={() => { openEditor(selectedVersion); handleSubTabChange("edit"); }}
                onFeedback={setFeedback}
                jobs={jobs}
                documents={payload.documents}
                versions={payload.versions}
              />
            </div>
          )}
        </div>
      )}
      {/* Mobile drawers (only rendered when open, visible <1024px) */}
      {leftDrawerOpen && showThreeColumnLayout && (
        <div className="uw-drawer-overlay" onClick={() => setLeftDrawerOpen(false)}>
          <div className="uw-drawer uw-drawer--left" onClick={(e) => e.stopPropagation()}>
            <div className="uw-drawer__header">
              <span className="uw-drawer__title">{t("projectWorkspace.workspace.modeDocument")}</span>
              <button className="uw-drawer__close" type="button" onClick={() => setLeftDrawerOpen(false)}>&times;</button>
            </div>
            <div className="uw-left-scroll" style={{ flex: 1 }}>
              <VersionList
                documents={documents}
                selectedDocId={selectedDocId || documents[0]?.id || ""}
                selectedVersionId={selectedVersionId}
                onSelectDoc={(id) => {
                  if (id === VIRTUAL_VIDEO_DOC_ID) {
                    handleModeChange("timeline");
                    setLeftDrawerOpen(false);
                    return;
                  }
                  setSelectedDocId(id);
                  if (isEditing) setIsEditing(false);
                  const doc = documents.find((d) => d.id === id);
                  if (doc?.versions[0]) setSelectedVersionId(doc.versions[0].id);
                  setLeftDrawerOpen(false);
                }}
                onSelectVersion={(id, docId) => {
                  setSelectedVersionId(id);
                  if (docId) setSelectedDocId(docId);
                  if (isEditing) setIsEditing(false);
                  setLeftDrawerOpen(false);
                }}
                projectId={projectId}
              />
            </div>
            <JobStatusBar jobs={jobs} />
          </div>
        </div>
      )}

      {rightDrawerOpen && showThreeColumnLayout && (
        <div className="uw-drawer-overlay" onClick={() => setRightDrawerOpen(false)}>
          <div className="uw-drawer uw-drawer--right" onClick={(e) => e.stopPropagation()}>
            <div className="uw-drawer__header">
              <span className="uw-drawer__title">{t("projectWorkspace.workspace.reviewActions")}</span>
              <button className="uw-drawer__close" type="button" onClick={() => setRightDrawerOpen(false)}>&times;</button>
            </div>
            <RightContextPanel
              projectId={projectId}
              selectedVersionId={selectedVersionId}
              selectedVersion={selectedVersion}
              currentMode={mode}
              docSubTab={docSubTab}
              isEditing={isEditing}
              onStartEdit={() => { openEditor(selectedVersion); handleSubTabChange("edit"); setRightDrawerOpen(false); }}
              onFeedback={setFeedback}
              jobs={jobs}
              documents={payload.documents}
              versions={payload.versions}
            />
          </div>
        </div>
      )}
    </div>
  );
}
