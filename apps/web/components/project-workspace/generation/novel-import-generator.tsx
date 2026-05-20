"use client";

import { useState, useCallback, useRef } from "react";
import type { LlmConfigSource, ProjectWorkspacePayload, WorldBibleContent } from "@dramaflow/shared";

import { apiStreamFetch } from "../../../lib/api";
import { useFeedback } from "../../../lib/hooks";
import { useI18n } from "../../../lib/i18n";
import type { GeneratorConfig } from "./generator-registry";

interface Props {
  config: GeneratorConfig;
  projectId: string;
  project: ProjectWorkspacePayload;
  llmConfigSource: LlmConfigSource;
}

type Phase = "idle" | "chunking" | "worldBible" | "script" | "done";

export function NovelImportGenerator({ projectId, llmConfigSource }: Props) {
  const { t } = useI18n();
  const { feedback, setFeedback } = useFeedback();
  const [inputText, setInputText] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [totalChunks, setTotalChunks] = useState(0);
  const [currentChunk, setCurrentChunk] = useState(0);
  const [extractedWb, setExtractedWb] = useState<WorldBibleContent | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canStart = inputText.trim().length > 0 && phase === "idle";

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      setInputText(evt.target?.result as string);
    };
    reader.readAsText(file, "utf-8");
  }, []);

  const handleStart = useCallback(async () => {
    if (!canStart) return;
    setPhase("chunking");
    setFeedback({ message: null, error: null });

    try {
      for await (const chunk of apiStreamFetch(
        `/projects/${projectId}/novel-import/stream`,
        {
          method: "POST",
          body: JSON.stringify({ text: inputText, llmConfigSource }),
        },
      )) {
        const data = (chunk as { result?: unknown }).result ?? chunk;

        if (chunk.type === "error" || data.type === "error") {
          const errMsg = (data as { error?: string }).error ?? (chunk as { error?: string }).error ?? "导入失败";
          setFeedback({ message: null, error: errMsg });
          setPhase("idle");
          return;
        }

        if (data.type === "progress") {
          const p = data as { phase: string; totalChunks?: number; chunkIndex?: number };
          if (p.phase === "chunking" && p.totalChunks) {
            setTotalChunks(p.totalChunks);
            setPhase("worldBible");
          } else if (p.phase === "script" && p.chunkIndex !== undefined) {
            setPhase("script");
            setCurrentChunk(p.chunkIndex + 1);
          }
        } else if (data.type === "worldBible") {
          setExtractedWb((data as { content: WorldBibleContent }).content);
        }
      }

      setPhase("done");
      setFeedback({ message: "导入完成！已生成世界观、大纲和剧本", error: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "导入失败";
      setFeedback({ message: null, error: msg });
      setPhase("idle");
    }
  }, [canStart, inputText, llmConfigSource, projectId, setFeedback]);

  return (
    <div className="novel-import">
      <div className="novel-import__input-area">
        <textarea
          className="input novel-import__textarea"
          rows={10}
          placeholder="粘贴小说文本到此处..."
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          disabled={phase !== "idle"}
        />
        <div className="novel-import__actions">
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={phase !== "idle"}
          >
            上传 TXT
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt"
            onChange={handleFileUpload}
            hidden
          />
          <button
            className="btn btn-primary btn-sm"
            type="button"
            onClick={handleStart}
            disabled={!canStart}
          >
            开始导入
          </button>
        </div>
      </div>

      {feedback.message && <div className="gen-notice gen-notice--ok" role="status">{feedback.message}</div>}
      {feedback.error && <div className="gen-notice gen-notice--err" role="alert">{feedback.error}</div>}

      {phase !== "idle" && phase !== "done" && (
        <div className="novel-import__progress">
          <div className="novel-import__progress-bar">
            <div
              className="novel-import__progress-fill"
              style={{ width: totalChunks > 0 && phase === "script" ? `${(currentChunk / totalChunks) * 100}%` : phase === "worldBible" ? "20%" : "5%" }}
            />
          </div>
          <div className="novel-import__progress-text">
            {phase === "chunking" && "正在分块..."}
            {phase === "worldBible" && "正在提取世界观和大纲..."}
            {phase === "script" && `正在生成剧本... (${currentChunk}/${totalChunks})`}
          </div>
        </div>
      )}

      {extractedWb && phase !== "idle" && (
        <div className="novel-import__preview">
          <span>已提取 {extractedWb.characters.length} 个角色，{extractedWb.locations.length} 个场景</span>
        </div>
      )}

      {phase === "done" && (
        <div className="novel-import__done">
          导入完成！世界观、大纲和剧本已自动写入对应文档
        </div>
      )}
    </div>
  );
}
