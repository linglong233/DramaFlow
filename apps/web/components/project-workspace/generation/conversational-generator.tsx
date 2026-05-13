/**
 * @fileoverview 对话模式生成器
 * @module web/components/project-workspace/generation
 *
 * 通用对话式 AI 生成界面，从现有 ConversationGeneratorPanel 重构而来。
 * 根据 generatorId 确定目标文档类型（synopsis / script）。
 */

"use client";

import { useCallback, useRef, useState } from "react";
import type {
  ConversationBrief,
  ConversationDimension,
  ConversationDimensionStatus,
  ConversationMessage,
  LlmConfigSource,
  ProjectWorkspacePayload,
} from "@dramaflow/shared";
import { useMutation } from "@tanstack/react-query";

import { apiStreamFetch, formatApiError } from "../../../lib/api";
import { useFeedback } from "../../../lib/hooks";
import { useI18n } from "../../../lib/i18n";
import { ConversationChat } from "../conversation-chat";
import { ConversationBrief as ConversationBriefPanel } from "../conversation-brief";
import type { GeneratorConfig } from "./generator-registry";

interface Props {
  config: GeneratorConfig;
  projectId: string;
  project: ProjectWorkspacePayload;
  llmConfigSource: LlmConfigSource;
}

const DEFAULT_DIMENSION_STATUS: Record<ConversationDimension, ConversationDimensionStatus> = {
  coreConflict: "pending",
  protagonist: "pending",
  supportingChars: "pending",
  tone: "pending",
  pacing: "pending",
  constraints: "pending",
};

function countConfirmed(status: Record<ConversationDimension, ConversationDimensionStatus>): number {
  return Object.values(status).filter((s) => s === "confirmed").length;
}

export function ConversationalGenerator({ config, projectId, project, llmConfigSource }: Props) {
  const { t } = useI18n();
  const { feedback, setFeedback } = useFeedback();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [brief, setBrief] = useState<ConversationBrief>({});
  const [dimensionStatus, setDimensionStatus] = useState(DEFAULT_DIMENSION_STATUS);
  const [streamingText, setStreamingText] = useState("");
  const [generatedContent, setGeneratedContent] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Derive target doc type from generator config
  const targetDocType = config.id === "script" ? "script" : "synopsis";
  const canGenerate = countConfirmed(dimensionStatus) >= 3;

  // Send message mutation
  const messageMutation = useMutation({
    mutationFn: async (content: string) => {
      setStreamingText("");
      setFeedback({ message: null, error: null });

      const controller = new AbortController();
      abortRef.current = controller;

      let accumulated = "";
      let latestBrief = brief;
      let latestStatus = dimensionStatus;
      let latestSessionId = sessionId;

      for await (const chunk of apiStreamFetch(`/projects/${projectId}/conversation-jobs/message`, {
        method: "POST",
        signal: controller.signal,
        body: {
          sessionId: latestSessionId,
          content,
          targetDocType,
          llmConfigSource,
        },
      })) {
        if (chunk.type === "chunk" && chunk.content) {
          accumulated += chunk.content;
          setStreamingText(accumulated);
        } else if (chunk.type === "done" && chunk.result) {
          const result = chunk.result as Record<string, unknown>;

          if (result.sessionId && typeof result.sessionId === "string") {
            latestSessionId = result.sessionId;
            setSessionId(result.sessionId);
          }
          if (result.brief && typeof result.brief === "object") {
            latestBrief = { ...latestBrief, ...(result.brief as ConversationBrief) };
            setBrief(latestBrief);
          }
          if (result.dimensionStatus && typeof result.dimensionStatus === "object") {
            latestStatus = result.dimensionStatus as Record<ConversationDimension, ConversationDimensionStatus>;
            setDimensionStatus(latestStatus);
          }
          if (result.message && typeof result.message === "object") {
            const msg = result.message as ConversationMessage;
            setMessages((prev) => [...prev, msg]);
          }
        } else if (chunk.type === "error") {
          throw new Error(chunk.error);
        }
      }

      abortRef.current = null;
      setStreamingText("");

      try {
        const parsed = JSON.parse(accumulated);
        if (parsed.briefUpdates && typeof parsed.briefUpdates === "object") {
          const updates = Object.fromEntries(
            Object.entries(parsed.briefUpdates).filter(([, v]) => typeof v === "string" && v.trim()),
          );
          if (Object.keys(updates).length > 0) {
            latestBrief = { ...latestBrief, ...updates };
            setBrief(latestBrief);

            const newStatus = { ...latestStatus };
            for (const key of Object.keys(updates)) {
              if (newStatus[key as ConversationDimension] === "pending") {
                newStatus[key as ConversationDimension] = "confirmed";
              }
            }
            setDimensionStatus(newStatus);
          }
        }
        if (parsed.reply && typeof parsed.reply === "string") {
          setMessages((prev) => [...prev, { role: "ai", content: parsed.reply }]);
        }
      } catch {
        setMessages((prev) => [...prev, { role: "ai", content: accumulated }]);
      }
    },
    onError: (error) => {
      setStreamingText("");
      abortRef.current = null;
      setFeedback({ message: null, error: formatApiError(error, t, "conversation.messageFailed") });
    },
  });

  // Generate mutation
  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!sessionId) return;

      setStreamingText("");
      setFeedback({ message: null, error: null });

      const controller = new AbortController();
      abortRef.current = controller;

      let accumulated = "";

      for await (const chunk of apiStreamFetch(`/projects/${projectId}/conversation-jobs/generate`, {
        method: "POST",
        signal: controller.signal,
        body: {
          sessionId,
          targetDocType,
          llmConfigSource,
        },
      })) {
        if (chunk.type === "chunk" && chunk.content) {
          accumulated += chunk.content;
          setStreamingText(accumulated);
        } else if (chunk.type === "done" && chunk.result) {
          const result = chunk.result as Record<string, unknown>;
          if (typeof result.content === "string") {
            accumulated = result.content;
          }
        } else if (chunk.type === "error") {
          throw new Error(chunk.error);
        }
      }

      abortRef.current = null;
      setStreamingText("");
      setGeneratedContent(accumulated);
      setFeedback({ message: t("conversation.generateSuccess"), error: null });
    },
    onError: (error) => {
      setStreamingText("");
      abortRef.current = null;
      setFeedback({ message: null, error: formatApiError(error, t, "conversation.generateFailed") });
    },
  });

  const isStreaming = messageMutation.isPending || generateMutation.isPending;

  const hasInitialized = useRef(false);
  const handleSendMessage = useCallback((content: string) => {
    if (!hasInitialized.current && messages.length === 0) {
      hasInitialized.current = true;
      setMessages([{ role: "ai", content: t("conversation.greeting") }]);
    }
    setMessages((prev) => [...prev, { role: "user", content }]);
    messageMutation.mutate(content);
  }, [messageMutation, messages.length, t]);

  const handleBriefFieldChange = useCallback((field: keyof ConversationBrief, value: string) => {
    setBrief((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleDimensionClick = useCallback((dim: ConversationDimension) => {
    const question = t(`conversation.focusDimension_${dim}`);
    setMessages((prev) => [...prev, { role: "ai", content: question }]);
  }, [t]);

  const handleGenerate = useCallback(() => {
    generateMutation.mutate();
  }, [generateMutation]);

  return (
    <div className="conv-root">
      {feedback.message && <div className="gen-notice gen-notice--ok" role="status">{feedback.message}</div>}
      {feedback.error && <div className="gen-notice gen-notice--err" role="alert">{feedback.error}</div>}

      <div className="conv-layout">
        <div className="conv-layout__chat">
          <ConversationChat
            messages={messages}
            streamingText={streamingText}
            isStreaming={isStreaming}
            onSendMessage={handleSendMessage}
          />
        </div>
        <div className="conv-layout__brief">
          <ConversationBriefPanel
            brief={brief}
            dimensionStatus={dimensionStatus}
            canGenerate={canGenerate}
            isStreaming={isStreaming}
            onBriefFieldChange={handleBriefFieldChange}
            onDimensionClick={handleDimensionClick}
            onGenerate={handleGenerate}
            targetDocType={targetDocType}
            generatedContent={generatedContent}
            onContinueConversation={() => {
              setGeneratedContent(null);
            }}
          />
        </div>
      </div>
    </div>
  );
}
