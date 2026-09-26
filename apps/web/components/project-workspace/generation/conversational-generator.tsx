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
  ConversationSession,
  ConversationSessionSummary,
  LlmConfigSource,
  ProjectWorkspacePayload,
} from "@dramaflow/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch, apiStreamFetch, formatApiError } from "../../../lib/api";
import { useFeedback } from "../../../lib/hooks";
import { useI18n } from "../../../lib/i18n";
import { queryKeys } from "../../../lib/query-keys";
import { ConversationChat } from "../conversation-chat";
import type { ConversationStreamingPlacement } from "../conversation-chat";
import { ConversationBrief as ConversationBriefPanel } from "../conversation-brief";
import type { GeneratorConfig } from "./generator-registry";
import { ConversationHistory } from "./conversation-history";
import { WorldBibleIndicator } from "./world-bible-indicator";
import {
  createOptimisticConversationMessage,
  normalizeConversationMessages,
} from "../../../lib/conversation-message";

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

interface ConversationStateSnapshot {
  sessionId: string | null;
  messages: ConversationMessage[];
  brief: ConversationBrief;
  dimensionStatus: Record<ConversationDimension, ConversationDimensionStatus>;
  generatedContent: string | null;
  pendingFocusDimension: ConversationDimension | null;
  hasInitialized: boolean;
}

interface ConversationActionInput {
  path: string;
  body: Record<string, unknown>;
  placement: ConversationStreamingPlacement;
  previous: ConversationStateSnapshot;
}

export function ConversationalGenerator({ config, projectId, project, llmConfigSource }: Props) {
  const { t } = useI18n();
  const { feedback, setFeedback } = useFeedback();
  const queryClient = useQueryClient();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [brief, setBrief] = useState<ConversationBrief>({});
  const [dimensionStatus, setDimensionStatus] = useState(DEFAULT_DIMENSION_STATUS);
  const [streamingText, setStreamingText] = useState("");
  const [streamingPlacement, setStreamingPlacement] = useState<ConversationStreamingPlacement>("append");
  const [generatedContent, setGeneratedContent] = useState<string | null>(null);
  const [pendingFocusDimension, setPendingFocusDimension] = useState<ConversationDimension | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hasInitialized = useRef(false);

  const { data: sessionList } = useQuery({
    queryKey: queryKeys.conversationSessions(projectId),
    queryFn: () =>
      apiFetch<{ sessions: ConversationSessionSummary[] }>(
        `/projects/${projectId}/conversation-jobs`,
      ).then((r) => r.sessions),
  });

  async function invalidateWorkspace() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectVersions(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectJobs(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.conversationSessions(projectId) }),
    ]);
  }

  // Derive target doc type from generator config
  const targetDocType = config.id === "script" ? "script" : "synopsis";
  const canGenerate = countConfirmed(dimensionStatus) >= 3;

  function applyConversationSession(session: ConversationSession) {
    setSessionId(session.id);
    setMessages(normalizeConversationMessages(session.messages, session.id, session.createdAt));
    setBrief(session.brief);
    setDimensionStatus(session.dimensionStatus);
    hasInitialized.current = true;
  }

  function snapshotConversationState(): ConversationStateSnapshot {
    return {
      sessionId,
      messages,
      brief,
      dimensionStatus,
      generatedContent,
      pendingFocusDimension,
      hasInitialized: hasInitialized.current,
    };
  }

  function restoreConversationState(snapshot: ConversationStateSnapshot) {
    setSessionId(snapshot.sessionId);
    setMessages(snapshot.messages);
    setBrief(snapshot.brief);
    setDimensionStatus(snapshot.dimensionStatus);
    setGeneratedContent(snapshot.generatedContent);
    setPendingFocusDimension(snapshot.pendingFocusDimension);
    hasInitialized.current = snapshot.hasInitialized;
  }

  // 普通发送、编辑重发和 AI 重新生成共用同一条流式状态链路。
  const conversationMutation = useMutation({
    mutationFn: async (input: ConversationActionInput) => {
      setStreamingText("");
      setStreamingPlacement(input.placement);
      setGeneratedContent(null);
      setFeedback({ message: null, error: null });

      const controller = new AbortController();
      abortRef.current = controller;
      let completedSession: ConversationSession | null = null;

      for await (const chunk of apiStreamFetch(`/projects/${projectId}${input.path}`, {
        method: "POST",
        signal: controller.signal,
        body: input.body,
      })) {
        if (chunk.type === "chunk" && chunk.content) {
          setStreamingText((current) => current + chunk.content);
        } else if (chunk.type === "done" && chunk.result) {
          const result = chunk.result as Record<string, unknown>;
          if (result.session && typeof result.session === "object") {
            completedSession = result.session as ConversationSession;
          }
        } else if (chunk.type === "error") {
          throw new Error(chunk.error);
        }
      }

      if (!completedSession) {
        throw new Error("Conversation response did not include a session");
      }
      return completedSession;
    },
    onSuccess: (session) => {
      applyConversationSession(session);
      setStreamingText("");
      setStreamingPlacement("append");
      setPendingFocusDimension(null);
    },
    onError: (error, input) => {
      restoreConversationState(input.previous);
      setStreamingText("");
      setStreamingPlacement("append");
      setFeedback({ message: null, error: formatApiError(error, t, "conversation.messageFailed") });
    },
    onSettled: () => {
      abortRef.current = null;
      queryClient.invalidateQueries({ queryKey: queryKeys.conversationSessions(projectId) });
    },
  });

  // Generate mutation
  const generateMutation = useMutation({
    mutationFn: async (overrideTargetDocType?: "synopsis" | "script") => {
      if (!sessionId) return;

      setStreamingText("");
      setStreamingPlacement("append");
      setFeedback({ message: null, error: null });

      const controller = new AbortController();
      abortRef.current = controller;

      let accumulated = "";
      const requestedTargetDocType = overrideTargetDocType ?? targetDocType;

      for await (const chunk of apiStreamFetch(`/projects/${projectId}/conversation-jobs/generate`, {
        method: "POST",
        signal: controller.signal,
        body: {
          sessionId,
          targetDocType: requestedTargetDocType,
          brief,
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
          } else if (result.content) {
            accumulated = JSON.stringify(result.content, null, 2);
          }
        } else if (chunk.type === "error") {
          throw new Error(chunk.error);
        }
      }

      abortRef.current = null;
      setStreamingText("");
      setStreamingPlacement("append");
      setGeneratedContent(accumulated);
      setFeedback({ message: t("conversation.generateSuccess"), error: null });
      await invalidateWorkspace();
    },
    onError: (error) => {
      setStreamingText("");
      setStreamingPlacement("append");
      abortRef.current = null;
      setFeedback({ message: null, error: formatApiError(error, t, "conversation.generateFailed") });
    },
  });

  const loadSessionMutation = useMutation({
    mutationFn: async (targetSessionId: string) => {
      const session = await apiFetch<ConversationSession>(
        `/projects/${projectId}/conversation-jobs/${targetSessionId}`,
      );
      return session;
    },
    onSuccess: (session) => {
      setSessionId(session.id);
      setMessages(normalizeConversationMessages(session.messages, session.id, session.createdAt));
      setBrief(session.brief);
      setDimensionStatus(session.dimensionStatus);
      setGeneratedContent(null);
      setStreamingText("");
      setStreamingPlacement("append");
      setPendingFocusDimension(null);
      hasInitialized.current = true;
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: async (targetSessionId: string) => {
      await apiFetch(`/projects/${projectId}/conversation-jobs/${targetSessionId}/delete`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.conversationSessions(projectId) });
    },
  });

  const isStreaming = conversationMutation.isPending || generateMutation.isPending;

  const handleSendMessage = useCallback((content: string) => {
    if (isStreaming) return;
    const previous = snapshotConversationState();
    const nextMessages = [...messages];
    if (messages.length === 0) {
      hasInitialized.current = true;
      nextMessages.push(createOptimisticConversationMessage("ai", t("conversation.greeting")));
    }
    nextMessages.push(createOptimisticConversationMessage("user", content));
    setMessages(nextMessages);

    const focusDimension = pendingFocusDimension;
    conversationMutation.mutate({
      path: "/conversation-jobs/message",
      body: {
        ...(sessionId ? { sessionId } : {}),
        content,
        targetDocType,
        llmConfigSource,
        ...(focusDimension ? { focusDimension } : {}),
      },
      placement: "append",
      previous,
    });
  }, [conversationMutation, isStreaming, messages, pendingFocusDimension, sessionId, targetDocType, llmConfigSource, t]);

  const getBranchState = useCallback((messageIndex: number) => {
    const previousMessage = messages[messageIndex - 1];
    return {
      brief: previousMessage?.stateAfter?.brief ?? {},
      dimensionStatus: previousMessage?.stateAfter?.dimensionStatus ?? { ...DEFAULT_DIMENSION_STATUS },
    };
  }, [messages]);

  const handleEditMessage = useCallback((messageId: string, content: string) => {
    if (isStreaming || !sessionId) return;
    const messageIndex = messages.findIndex((message) => message.id === messageId);
    const target = messages[messageIndex];
    if (!target || target.role !== "user") return;

    const previous = snapshotConversationState();
    const state = getBranchState(messageIndex);
    const editedMessage: ConversationMessage = {
      ...target,
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages([...messages.slice(0, messageIndex), editedMessage]);
    setBrief(state.brief);
    setDimensionStatus(state.dimensionStatus);
    conversationMutation.mutate({
      path: "/conversation-jobs/message/edit",
      body: {
        sessionId,
        messageId,
        content,
        targetDocType,
        llmConfigSource,
        ...(target.focusDimension ? { focusDimension: target.focusDimension } : {}),
      },
      placement: { mode: "after", messageId },
      previous,
    });
  }, [conversationMutation, getBranchState, isStreaming, llmConfigSource, messages, sessionId, targetDocType]);

  const handleRegenerateMessage = useCallback((messageId: string) => {
    if (isStreaming || !sessionId) return;
    const messageIndex = messages.findIndex((message) => message.id === messageId);
    const target = messages[messageIndex];
    if (!target || target.role !== "ai") return;

    const previous = snapshotConversationState();
    const state = getBranchState(messageIndex);
    setMessages(messages.slice(0, messageIndex + 1));
    setBrief(state.brief);
    setDimensionStatus(state.dimensionStatus);
    conversationMutation.mutate({
      path: "/conversation-jobs/message/regenerate",
      body: {
        sessionId,
        messageId,
        targetDocType,
        llmConfigSource,
      },
      placement: { mode: "replace", messageId },
      previous,
    });
  }, [conversationMutation, getBranchState, isStreaming, llmConfigSource, messages, sessionId, targetDocType]);

  const handleBriefFieldChange = useCallback((field: keyof ConversationBrief, value: string) => {
    setBrief((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleDimensionClick = useCallback((dim: ConversationDimension) => {
    setPendingFocusDimension(dim);
    setDimensionStatus((prev) => ({
      ...prev,
      [dim]: prev[dim] === "confirmed" ? "confirmed" : "discussing",
    }));
  }, []);

  const handleGenerate = useCallback(() => {
    generateMutation.mutate(targetDocType);
  }, [generateMutation, targetDocType]);

  const handleNewSession = useCallback(() => {
    setSessionId(null);
    setMessages([]);
    setBrief({});
    setDimensionStatus(DEFAULT_DIMENSION_STATUS);
    setStreamingText("");
    setStreamingPlacement("append");
    setGeneratedContent(null);
    setPendingFocusDimension(null);
    hasInitialized.current = false;
  }, []);

  const handleDeleteSession = useCallback(
    (targetSessionId: string) => {
      if (targetSessionId === sessionId) {
        handleNewSession();
      }
      deleteSessionMutation.mutate(targetSessionId);
    },
    [deleteSessionMutation, sessionId, handleNewSession],
  );

  return (
    <div className="conv-root">
      {feedback.message && <div className="gen-notice gen-notice--ok" role="status">{feedback.message}</div>}
      {feedback.error && <div className="gen-notice gen-notice--err" role="alert">{feedback.error}</div>}
      <WorldBibleIndicator project={project} />
      <div className="conv-mode-bar">
        <ConversationHistory
          sessions={sessionList ?? []}
          activeSessionId={sessionId}
          onSelectSession={(id) => loadSessionMutation.mutate(id)}
          onNewSession={handleNewSession}
          onDeleteSession={handleDeleteSession}
        />
      </div>
      <div className="conv-layout">
        <div className="conv-layout__chat">
          <ConversationChat
            messages={messages}
            streamingText={streamingText}
            isStreaming={isStreaming}
            streamingPlacement={streamingPlacement}
            onSendMessage={handleSendMessage}
            onEditMessage={handleEditMessage}
            onRegenerateMessage={handleRegenerateMessage}
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
              generateMutation.mutate("script");
            }}
          />
        </div>
      </div>
    </div>
  );
}
