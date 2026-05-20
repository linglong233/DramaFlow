"use client";

import { useReducer, useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";
import type { LlmConfigSource, ProjectWorkspacePayload, ScriptContent, ScriptScene, WorldBibleContent } from "@dramaflow/shared";
import { normalizeScriptContent, normalizeWorldBibleContent } from "@dramaflow/shared";

import { apiStreamFetch } from "../../../lib/api";
import { useFeedback } from "../../../lib/hooks";
import { useI18n } from "../../../lib/i18n";
import type { GeneratorConfig } from "./generator-registry";
import { ScriptView, WorldBibleView } from "../version-view";

interface Props {
  config: GeneratorConfig;
  project: ProjectWorkspacePayload;
  projectId: string;
  llmConfigSource: LlmConfigSource;
}

type Phase = "idle" | "chunking" | "worldBible" | "script" | "done" | "error";
type PreviewTab = "worldBible" | "synopsis" | "script";

interface State {
  inputText: string;
  phase: Phase;
  totalChunks: number;
  currentChunk: number;
  worldBible: WorldBibleContent | null;
  synopsis: string | null;
  scenes: ScriptScene[];
  errorMsg: string | null;
  previewTab: PreviewTab;
  isReadingFile: boolean;
}

type Action =
  | { type: "SET_INPUT"; text: string }
  | { type: "SET_READING_FILE"; reading: boolean }
  | { type: "START_IMPORT" }
  | { type: "PROGRESS"; phase: Phase; totalChunks?: number; chunkIndex?: number }
  | { type: "SET_WORLD_BIBLE"; content: WorldBibleContent }
  | { type: "SET_SYNOPSIS"; content: string }
  | { type: "ADD_SCENES"; scenes: ScriptScene[] }
  | { type: "DONE" }
  | { type: "ERROR"; error: string }
  | { type: "SET_PREVIEW_TAB"; tab: PreviewTab };

const initialState: State = {
  inputText: "",
  phase: "idle",
  totalChunks: 0,
  currentChunk: 0,
  worldBible: null,
  synopsis: null,
  scenes: [],
  errorMsg: null,
  previewTab: "worldBible",
  isReadingFile: false,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_INPUT":
      return { ...state, inputText: action.text };
    case "SET_READING_FILE":
      return { ...state, isReadingFile: action.reading };
    case "START_IMPORT":
      return {
        ...state,
        phase: "chunking",
        totalChunks: 0,
        currentChunk: 0,
        worldBible: null,
        synopsis: null,
        scenes: [],
        errorMsg: null,
      };
    case "PROGRESS":
      return {
        ...state,
        phase: action.phase,
        ...(action.totalChunks !== undefined ? { totalChunks: action.totalChunks } : {}),
        ...(action.chunkIndex !== undefined ? { currentChunk: action.chunkIndex + 1 } : {}),
      };
    case "SET_WORLD_BIBLE":
      return { ...state, worldBible: action.content };
    case "SET_SYNOPSIS":
      return { ...state, synopsis: action.content };
    case "ADD_SCENES":
      return { ...state, scenes: [...state.scenes, ...action.scenes] };
    case "DONE":
      return { ...state, phase: "done" };
    case "ERROR":
      return { ...state, phase: "error", errorMsg: action.error };
    case "SET_PREVIEW_TAB":
      return { ...state, previewTab: action.tab };
    default:
      return state;
  }
}

export function NovelImportGenerator({ projectId, llmConfigSource }: Props) {
  const { t } = useI18n();
  const { feedback, setFeedback } = useFeedback();
  const [state, dispatch] = useReducer(reducer, initialState);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const isIdle = state.phase === "idle" || state.phase === "error";
  const isImporting = state.phase !== "idle" && state.phase !== "done" && state.phase !== "error";
  const canStart = state.inputText.trim().length > 0 && isIdle;

  // Derived: final script built from accumulated scenes + world bible
  const extractedScript: ScriptContent | null =
    (state.phase === "done" || state.phase === "error") && state.worldBible && state.scenes.length > 0
      ? {
          logline: "",
          premise: "",
          characters: state.worldBible.characters.map((c) => ({ name: c.name, profile: c.appearance })),
          scenes: state.scenes,
        }
      : null;

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    dispatch({ type: "SET_READING_FILE", reading: true });
    const reader = new FileReader();
    reader.onload = (evt) => {
      dispatch({ type: "SET_INPUT", text: evt.target?.result as string });
      dispatch({ type: "SET_READING_FILE", reading: false });
    };
    reader.onerror = () => {
      dispatch({ type: "SET_READING_FILE", reading: false });
    };
    reader.readAsText(file, "utf-8");
    // Reset file input so re-uploading the same file works
    e.target.value = "";
  }, []);

  const handleStart = useCallback(async () => {
    if (!state.inputText.trim()) {
      dispatch({ type: "ERROR", error: "请输入小说文本" });
      return;
    }
    if (state.inputText.length > 500_000) {
      dispatch({ type: "ERROR", error: "文本较长（超过50万字），导入可能需要较长时间" });
      // Don't return — just warn, let user proceed
    }

    const controller = new AbortController();
    abortRef.current = controller;
    dispatch({ type: "START_IMPORT" });
    setFeedback({ message: null, error: null });

    try {
      for await (const chunk of apiStreamFetch(
        `/projects/${projectId}/novel-import/stream`,
        {
          method: "POST",
          body: JSON.stringify({ text: state.inputText, llmConfigSource }),
          signal: controller.signal,
        },
      )) {
        const data = (chunk as { result?: unknown }).result ?? chunk;

        if (chunk.type === "error" || (data as { type?: string }).type === "error") {
          const errMsg =
            (data as { error?: string }).error ??
            (chunk as { error?: string }).error ??
            "导入失败";
          dispatch({ type: "ERROR", error: errMsg });
          setFeedback({ message: null, error: errMsg });
          return;
        }

        const dtype = (data as { type?: string }).type;
        if (dtype === "progress") {
          const p = data as { phase: string; totalChunks?: number; chunkIndex?: number };
          if (p.phase === "chunking" && p.totalChunks) {
            dispatch({ type: "PROGRESS", phase: "worldBible", totalChunks: p.totalChunks });
          } else if (p.phase === "worldBible") {
            // stay in worldBible phase
          } else if (p.phase === "script" && p.chunkIndex !== undefined) {
            dispatch({ type: "PROGRESS", phase: "script", chunkIndex: p.chunkIndex });
          }
        } else if (dtype === "worldBible") {
          dispatch({ type: "SET_WORLD_BIBLE", content: (data as { content: WorldBibleContent }).content });
        } else if (dtype === "synopsis") {
          dispatch({ type: "SET_SYNOPSIS", content: (data as { content: string }).content });
        } else if (dtype === "scenes") {
          dispatch({ type: "ADD_SCENES", scenes: (data as { scenes: ScriptScene[] }).scenes ?? [] });
        } else if (dtype === "done") {
          dispatch({ type: "DONE" });
          setFeedback({ message: "导入完成！已生成世界观、大纲和剧本", error: null });
          return;
        }
      }
    } catch (err) {
      if (controller.signal.aborted) {
        dispatch({ type: "ERROR", error: "已取消导入" });
        setFeedback({ message: null, error: "已取消导入" });
      } else {
        const msg = err instanceof Error ? err.message : "导入失败";
        dispatch({ type: "ERROR", error: msg });
        setFeedback({ message: null, error: msg });
      }
    } finally {
      abortRef.current = null;
    }
  }, [projectId, llmConfigSource, state.inputText, setFeedback]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const charCount = state.inputText.length;

  return (
    <div className="novel-import">
      <div className="novel-import__input-area">
        <textarea
          className="input novel-import__textarea"
          rows={10}
          placeholder="粘贴小说文本到此处..."
          value={state.inputText}
          onChange={(e) => dispatch({ type: "SET_INPUT", text: e.target.value })}
          disabled={!isIdle}
        />
        <div className="novel-import__input-footer">
          <span className="novel-import__char-count">
            {charCount > 0 ? `${charCount.toLocaleString()} 字` : ""}
          </span>
          <div className="novel-import__actions">
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!isIdle || state.isReadingFile}
            >
              {state.isReadingFile ? "读取中..." : "上传 TXT"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt"
              onChange={handleFileUpload}
              hidden
            />
            {isImporting ? (
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                onClick={handleCancel}
              >
                取消导入
              </button>
            ) : (
              <button
                className="btn btn-primary btn-sm"
                type="button"
                onClick={handleStart}
                disabled={!canStart}
              >
                开始导入
              </button>
            )}
          </div>
        </div>
      </div>

      {feedback.message && <div className="gen-notice gen-notice--ok" role="status">{feedback.message}</div>}
      {feedback.error && <div className="gen-notice gen-notice--err" role="alert">{feedback.error}</div>}

      {isImporting && (
        <div className="novel-import__progress">
          <div className="novel-import__progress-bar">
            <div
              className="novel-import__progress-fill"
              style={{
                width:
                  state.totalChunks > 0 && state.phase === "script"
                    ? `${(state.currentChunk / state.totalChunks) * 100}%`
                    : state.phase === "worldBible"
                      ? "20%"
                      : "5%",
              }}
            />
          </div>
          <div className="novel-import__progress-text">
            {state.phase === "chunking" && "正在分块..."}
            {state.phase === "worldBible" && "正在提取世界观和大纲..."}
            {state.phase === "script" && `正在生成剧本... (${state.currentChunk}/${state.totalChunks})`}
          </div>
        </div>
      )}

      {state.worldBible && isImporting && (
        <div className="novel-import__preview">
          <span>
            已提取 {state.worldBible.characters.length} 个角色，{state.worldBible.locations.length} 个场景
          </span>
        </div>
      )}

      {state.phase === "done" && (
        <>
          <div className="novel-import__done">
            导入完成！世界观、大纲和剧本已自动写入对应文档
          </div>

          <div className="novel-import__preview-tabs">
            <button
              className={`novel-import__tab${state.previewTab === "worldBible" ? " novel-import__tab--on" : ""}`}
              type="button"
              onClick={() => dispatch({ type: "SET_PREVIEW_TAB", tab: "worldBible" })}
            >
              世界观{state.worldBible ? ` (${state.worldBible.characters.length} 角色)` : ""}
            </button>
            <button
              className={`novel-import__tab${state.previewTab === "synopsis" ? " novel-import__tab--on" : ""}`}
              type="button"
              onClick={() => dispatch({ type: "SET_PREVIEW_TAB", tab: "synopsis" })}
            >
              大纲
            </button>
            <button
              className={`novel-import__tab${state.previewTab === "script" ? " novel-import__tab--on" : ""}`}
              type="button"
              onClick={() => dispatch({ type: "SET_PREVIEW_TAB", tab: "script" })}
            >
              剧本{extractedScript ? ` (${extractedScript.scenes.length} 场景)` : ""}
            </button>
          </div>

          <div className="novel-import__preview-content">
            {state.previewTab === "worldBible" && state.worldBible && (
              <WorldBibleView content={normalizeWorldBibleContent(state.worldBible)} />
            )}
            {state.previewTab === "synopsis" && state.synopsis && (
              <div className="vv-markdown">
                <ReactMarkdown>{state.synopsis}</ReactMarkdown>
              </div>
            )}
            {state.previewTab === "script" && extractedScript && (
              <ScriptView content={normalizeScriptContent(extractedScript)} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
