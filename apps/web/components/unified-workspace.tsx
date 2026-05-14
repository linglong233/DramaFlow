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
  type ProjectWorkspacePayload,
  type ScriptContent,
  type StoryboardContent,
  type WorldBibleContent,
  type TimelineResponse,
  type VersionRecord,
} from "@dramaflow/shared";

import { useI18n } from "../lib/i18n";
import { apiFetch, formatApiError } from "../lib/api";
import { queryKeys } from "../lib/query-keys";
import { useFeedback, useProject, useProjectVersions, useVersionMutations, useActiveJobs, useWorkspaceRealtime } from "../lib/hooks";
import { ErrorState } from "./error-state";
import { InlineFeedback } from "./inline-feedback";
import { LoadingSkeleton } from "./loading-skeleton";
import { VersionList } from "./project-workspace/version-list";
import { VersionView } from "./project-workspace/version-view";
import { VideoDocumentViewer } from "./project-workspace/video-document-viewer";
import { VersionDiffView } from "./project-workspace/version-diff-view";
import { VersionManagementPanel } from "./project-workspace/version-management-panel";
import { RichScriptEditor } from "./project-workspace/rich-script-editor";
import { StoryboardEditor } from "./project-workspace/storyboard-editor";
import { GeneratorHost } from "./project-workspace/generation/generator-host";
import { JobStatusBar } from "./project-workspace/job-status-bar";
import { RightContextPanel } from "./project-workspace/right-context-panel";
import { ReviewPolicySwitcher } from "./review-policy-switcher";
import { ProjectInfoPanel } from "./project-workspace/project-info-panel";
import { WorldBibleEditor } from "./project-workspace/world-bible-editor";
import { SynopsisEditor } from "./project-workspace/synopsis-editor";
import { TaskPanel } from "./project-workspace/task-panel";
import { TimelineEditor } from "./project-workspace/timeline-editor";
import { useRealtime } from "./realtime-provider";

// Workspace modes: document (with sub-tabs: view/edit/generate/versions), info, tasks, timeline
type WorkspaceMode = "document" | "info" | "tasks" | "timeline";

// Sub-tabs within document mode
type DocSubTab = "view" | "edit" | "generate" | "versions";

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
  draftVersionId?: string;
  versions: Array<Pick<VersionRecord, "id" | "title" | "versionNumber" | "status" | "content" | "createdAt">>;
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

function VersionManagementIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M7 3.5v4l2.5 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function UnifiedWorkspace({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { connected } = useRealtime();

  useWorkspaceRealtime(projectId);

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
  const { feedback, setFeedback } = useFeedback();
  const [editorInitialContent, setEditorInitialContent] = useState<ScriptContent | null>(null);
  const [storyboardEditorInitialContent, setStoryboardEditorInitialContent] = useState<StoryboardContent | null>(null);
  const [worldBibleEditorInitialContent, setWorldBibleEditorInitialContent] = useState<WorldBibleContent | null>(null);
  const [synopsisEditorInitialContent, setSynopsisEditorInitialContent] = useState<string | null>(null);
  const [editorSessionKey, setEditorSessionKey] = useState(0);
  const [showDiff, setShowDiff] = useState(false);

  const projectQuery = useProject(projectId);

  const versionsQuery = useProjectVersions(projectId, Boolean(projectQuery.data));

  const jobsQuery = useActiveJobs({ projectId, enabled: Boolean(projectQuery.data) });

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
  const previousCompletedIds = useRef(new Set<string>());

  useEffect(() => {
    if (!hasActiveJobs) return;
    const interval = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectJobs(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectVersions(projectId) });
    }, 5000);
    return () => clearInterval(interval);
  }, [hasActiveJobs, projectId, queryClient]);

  useEffect(() => {
    const completed = jobs.filter((j) => j.status === "completed" || j.status === "failed");
    const currentIds = new Set(completed.map((j) => j.id));
    const newCompletions = completed.some((j) => !previousCompletedIds.current.has(j.id));
    previousCompletedIds.current = currentIds;

    if (newCompletions) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectVersions(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.timeline(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.exports(projectId) });
    }
  }, [jobs, projectId, queryClient]);

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
        draftVersionId: doc.draftVersionId,
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
        draftVersionId: undefined,
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
      draftVersionId: undefined,
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
    const docParam = searchParams.get("doc");
    const urlDoc = docParam ? documents.find((d) => d.id === docParam && d.id !== VIRTUAL_VIDEO_DOC_ID) : undefined;
    const activeDoc = selectedDocId
      ? documents.find((d) => d.id === selectedDocId) ?? urlDoc ?? defaultDoc
      : urlDoc ?? defaultDoc;
    if (!activeDoc || activeDoc.id === VIRTUAL_VIDEO_DOC_ID) return;
    if (!selectedDocId || activeDoc.id !== selectedDocId) setSelectedDocId(activeDoc.id);
    if (selectedVersionId && !activeDoc.versions.some((version) => version.id === selectedVersionId)) {
      setSelectedVersionId(activeDoc.versions[0]?.id ?? "");
      return;
    }
    if (!selectedVersionId && activeDoc.versions[0]) setSelectedVersionId(activeDoc.versions[0].id);
  }, [documents, selectedDocId, selectedVersionId, searchParams]);

  useEffect(() => {
    if (!selectedDocId || selectedDocId.startsWith("__")) return;
    const params = new URLSearchParams(searchParams.toString());
    if (params.get("doc") === selectedDocId) return;
    params.set("doc", selectedDocId);
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [selectedDocId]); // eslint-disable-line react-hooks/exhaustive-deps -- searchParams read guarded by idempotency check

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

  // Version mutations
  const versionMutations = useVersionMutations(projectId);

  function handleEditorSave(title: string, content: ScriptContent | StoryboardContent | WorldBibleContent) {
    setFeedback({ message: null, error: null });
    const targetDocId = selectedDoc?.id;
    if (!targetDocId || targetDocId === VIRTUAL_SYNOPSIS_DOC_ID || targetDocId === VIRTUAL_VIDEO_DOC_ID) {
      setFeedback({ message: null, error: t("projectWorkspace.manualVersion.noDocumentError") });
      return;
    }
    versionMutations.create.mutate(
      { documentId: targetDocId, title, content, metadata: { source: "unified-workspace" } },
      {
        onSuccess: (version) => {
          setFeedback({ message: t("projectWorkspace.feedback.createVersionSuccess", { versionNumber: version.versionNumber }), error: null });
          setIsEditing(false);
          setSelectedVersionId(version.id);
        },
        onError: (error) => setFeedback({ message: null, error: formatApiError(error, t, "projectWorkspace.feedback.createVersionFailed") }),
      },
    );
  }

  function handleSynopsisEditorSave(title: string, content: string) {
    setFeedback({ message: null, error: null });
    const targetDocId = selectedDoc?.id;
    if (!targetDocId || targetDocId === VIRTUAL_SYNOPSIS_DOC_ID || targetDocId === VIRTUAL_VIDEO_DOC_ID) {
      setFeedback({ message: null, error: t("projectWorkspace.manualVersion.noDocumentError") });
      return;
    }
    versionMutations.create.mutate(
      { documentId: targetDocId, title, content, metadata: { source: "unified-workspace" } },
      {
        onSuccess: (version) => {
          setFeedback({ message: t("projectWorkspace.feedback.createVersionSuccess", { versionNumber: version.versionNumber }), error: null });
          setIsEditing(false);
          setSelectedVersionId(version.id);
        },
        onError: (error) => setFeedback({ message: null, error: formatApiError(error, t, "projectWorkspace.feedback.createVersionFailed") }),
      },
    );
  }

  function handleInlineStoryboardChange(content: StoryboardContent) {
    setFeedback({ message: null, error: null });
    // If the current version is already a draft, update it in-place
    if (selectedVersion && selectedVersion.status === "draft") {
      versionMutations.update.mutate(
        { versionId: selectedVersion.id, content },
        {
          onSuccess: () => setFeedback({ message: t("projectWorkspace.feedback.updateDraftSuccess"), error: null }),
          onError: (error) => setFeedback({ message: null, error: formatApiError(error, t, "projectWorkspace.feedback.updateDraftFailed") }),
        },
      );
      return;
    }
    // Otherwise create a new draft version
    const targetDocId = selectedDoc?.id;
    if (targetDocId) {
      versionMutations.create.mutate(
        { documentId: targetDocId, title: "Inline edit", content, metadata: { source: "unified-workspace" } },
        {
          onSuccess: () => setFeedback({ message: t("projectWorkspace.feedback.updateDraftSuccess"), error: null }),
          onError: (error) => setFeedback({ message: null, error: formatApiError(error, t, "projectWorkspace.feedback.createVersionFailed") }),
        },
      );
    }
  }

  function openEditor(fromVersion?: typeof selectedVersion) {
    if (isSynopsisDoc) {
      setSynopsisEditorInitialContent(
        fromVersion ? String(fromVersion.content ?? "") : null,
      );
      setEditorSessionKey((k) => k + 1);
      setIsEditing(true);
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
    params.delete("doc");
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  function handleSubTabChange(sub: DocSubTab) {
    const nextSub = sub;
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
                onSelectDoc={(id) => {
                  if (id === VIRTUAL_VIDEO_DOC_ID) {
                    handleModeChange("timeline");
                    return;
                  }
                  const doc = documents.find((d) => d.id === id);
                  setSelectedDocId(id);
                  if (docSubTab === "edit") {
                    setDocSubTab("view");
                  }
                  setSelectedVersionId(doc?.versions[0]?.id ?? "");
                }}
                isCollapsed={!leftPanelOpen}
                onToggleCollapse={() => {
                  const next = !leftPanelOpen;
                  setLeftPanelOpen(next);
                  localStorage.setItem("uw-left-panel", String(next));
                }}
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
                    <button
                      className={`uw-sub-tab${docSubTab === "versions" ? " uw-sub-tab--active" : ""}`}
                      role="tab"
                      aria-selected={docSubTab === "versions"}
                      onClick={() => handleSubTabChange("versions")}
                      type="button"
                    >
                      <VersionManagementIcon />
                      {t("projectWorkspace.workspace.modeVersions")}
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
                          allowStoryboardMutations={
                            !selectedDoc || selectedDoc.versions[0]?.id === selectedVersion?.id
                          }
                          onStoryboardChange={handleInlineStoryboardChange}
                          onSubmitForReview={(versionId) => versionMutations.submit.mutate(versionId)}
                          isSubmitting={versionMutations.submit.isPending}
                          onApprove={(versionId) => versionMutations.approve.mutate({ versionId })}
                          onReject={(versionId) => versionMutations.reject.mutate({ versionId })}
                          isApproving={versionMutations.approve.isPending}
                          isRejecting={versionMutations.reject.isPending}
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
                        isSaving={versionMutations.create.isPending}
                        projectId={projectId}
                        project={payload}
                      />
                    ) : isWorldBibleDoc ? (
                      <WorldBibleEditor
                        key={`worldbible-${selectedVersionId || "new"}-${editorSessionKey}`}
                        initialContent={worldBibleEditorInitialContent}
                        onSave={handleEditorSave}
                        onCancel={() => handleSubTabChange("view")}
                        isSaving={versionMutations.create.isPending}
                        projectId={projectId}
                      />
                    ) : isScriptDoc ? (
                      <RichScriptEditor
                        key={`script-${selectedVersionId || "new"}-${editorSessionKey}`}
                        initialContent={editorInitialContent}
                        onSave={handleEditorSave}
                        onCancel={() => handleSubTabChange("view")}
                        isSaving={versionMutations.create.isPending}
                      />
                    ) : isSynopsisDoc ? (
                      <SynopsisEditor
                        key={`synopsis-${selectedVersionId || "new"}-${editorSessionKey}`}
                        initialContent={synopsisEditorInitialContent}
                        onSave={handleSynopsisEditorSave}
                        onCancel={() => handleSubTabChange("view")}
                        isSaving={versionMutations.create.isPending}
                      />
                    ) : null
                  )}
                </div>

                {/* Generate sub-tab */}
                <div style={{ display: mode === "document" && docSubTab === "generate" ? undefined : "none" }}>
                  {mode === "document" && docSubTab === "generate" && (() => {
                    if (isWorldBibleDoc) {
                      return (
                        <div className="gen-empty">
                          <div className="gen-empty__icon">
                            <svg width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden="true">
                              <path d="M28 6l5.25 12.25L46 23.5l-12.75 5.25L28 41l-5.25-12.25L10 23.5l12.75-5.25L28 6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" opacity="0.5" />
                            </svg>
                          </div>
                          <div className="gen-empty__title">{t("projectWorkspace.generate.outputEmpty")}</div>
                          <div className="gen-empty__hint">{t("projectWorkspace.generate.noWorldBibleGeneration")}</div>
                        </div>
                      );
                    }
                    const generatorId = isSynopsisDoc ? "synopsis"
                      : isStoryboardDoc ? "storyboard"
                      : "script";
                    return (
                      <GeneratorHost
                        generatorId={generatorId}
                        projectId={projectId}
                        project={payload}
                      />
                    );
                  })()}
                </div>

                {/* Versions management sub-tab */}
                <div style={{ display: mode === "document" && docSubTab === "versions" ? undefined : "none" }}>
                  {mode === "document" && selectedDoc && (
                    <VersionManagementPanel
                      key={selectedDoc.id}
                      documentId={selectedDoc.id}
                      documentTitle={selectedDoc.title}
                      documentType={selectedDoc.type}
                      versions={selectedDoc.versions}
                      currentVersionId={selectedDoc.currentVersionId}
                      projectId={projectId}
                      allVersions={rawVersions}
                      allDocuments={documents.map((d) => ({ id: d.id, title: d.title }))}
                    />
                  )}
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
