"use client";

import { useEffect, useRef, useState } from "react";
import type { ConversationMessage } from "@dramaflow/shared";
import { useI18n } from "../../lib/i18n";
import { formatConversationTimestamp } from "../../lib/conversation-message";

export type ConversationStreamingPlacement =
  | "append"
  | { mode: "after" | "replace"; messageId: string };

interface Props {
  messages: ConversationMessage[];
  streamingText: string;
  isStreaming: boolean;
  streamingPlacement: ConversationStreamingPlacement;
  onSendMessage: (content: string) => void;
  onEditMessage: (messageId: string, content: string) => void;
  onRegenerateMessage: (messageId: string) => void;
}

function MessageIcon({ type }: { type: "copy" | "edit" | "regenerate" | "save" | "cancel" }) {
  if (type === "copy") {
    return (
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
    );
  }

  if (type === "edit") {
    return (
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    );
  }

  if (type === "regenerate") {
    return (
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 11a8.1 8.1 0 0 0-14.8-4L3 10" />
        <path d="M3 4v6h6" />
        <path d="M4 13a8.1 8.1 0 0 0 14.8 4L21 14" />
        <path d="M21 20v-6h-6" />
      </svg>
    );
  }

  if (type === "save") {
    return (
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function ConversationChat({
  messages,
  streamingText,
  isStreaming,
  streamingPlacement,
  onSendMessage,
  onEditMessage,
  onRegenerateMessage,
}: Props) {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const copyStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, streamingPlacement]);

  useEffect(() => () => {
    if (copyStatusTimerRef.current) clearTimeout(copyStatusTimerRef.current);
  }, []);

  function handleSubmit() {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    onSendMessage(trimmed);
    setInput("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  async function handleCopy(message: ConversationMessage) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(message.content);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = message.content;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand("copy");
        textarea.remove();
        if (!copied) throw new Error("Copy command failed");
      }
      setCopyStatus(t("conversation.copiedMessage"));
    } catch {
      setCopyStatus(t("conversation.copyFailed"));
    }

    if (copyStatusTimerRef.current) clearTimeout(copyStatusTimerRef.current);
    copyStatusTimerRef.current = setTimeout(() => setCopyStatus(""), 1800);
  }

  function startEditing(message: ConversationMessage) {
    if (isStreaming) return;
    setEditingMessageId(message.id);
    setEditDraft(message.content);
  }

  function cancelEditing() {
    setEditingMessageId(null);
    setEditDraft("");
  }

  function saveEditing(messageId: string) {
    const trimmed = editDraft.trim();
    if (!trimmed || isStreaming) return;
    onEditMessage(messageId, trimmed);
    cancelEditing();
  }

  function handleEditKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>, messageId: string) {
    if (e.key === "Escape") {
      e.preventDefault();
      cancelEditing();
      return;
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      saveEditing(messageId);
    }
  }

  function renderStreamingMessage() {
    return (
      <div className="conv-msg conv-msg--ai conv-msg--streaming" aria-live="polite">
        <div className="conv-msg__avatar">AI</div>
        <div className="conv-msg__body">
          <div className="conv-msg__content">
            {streamingText}
            <span className="conv-msg__cursor" />
          </div>
        </div>
      </div>
    );
  }

  function renderMessage(message: ConversationMessage, index: number) {
    const isEditing = editingMessageId === message.id;
    const canRegenerate = message.role === "ai"
      && messages.slice(0, index).some((item) => item.role === "user");
    const isReplacing = isStreaming
      && typeof streamingPlacement === "object"
      && streamingPlacement.mode === "replace"
      && streamingPlacement.messageId === message.id;

    return (
      <div
        key={message.id + "-" + index}
        className={["conv-msg", "conv-msg--" + message.role].join(" ")}
        tabIndex={0}
        role="group"
      >
        <div className="conv-msg__avatar">
          {message.role === "ai" ? "AI" : t("conversation.userLabel")}
        </div>
        <div className="conv-msg__body">
          {isEditing ? (
            <div className="conv-msg__editor">
              <textarea
                className="conv-msg__edit-input"
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                onKeyDown={(e) => handleEditKeyDown(e, message.id)}
                rows={3}
                autoFocus
                disabled={isStreaming}
                aria-label={t("conversation.editMessage")}
              />
              <div className="conv-msg__edit-actions">
                <button
                  type="button"
                  className="conv-msg__action conv-msg__action--primary"
                  onClick={() => saveEditing(message.id)}
                  disabled={isStreaming || !editDraft.trim()}
                  aria-label={t("conversation.saveEdit")}
                  title={t("conversation.saveEdit")}
                >
                  <MessageIcon type="save" />
                  <span>{t("conversation.saveEdit")}</span>
                </button>
                <button
                  type="button"
                  className="conv-msg__action"
                  onClick={cancelEditing}
                  disabled={isStreaming}
                  aria-label={t("conversation.cancelEdit")}
                  title={t("conversation.cancelEdit")}
                >
                  <MessageIcon type="cancel" />
                  <span>{t("conversation.cancelEdit")}</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="conv-msg__content">
                {isReplacing ? streamingText : message.content}
                {isReplacing && <span className="conv-msg__cursor" />}
              </div>
              <div className="conv-msg__meta">
                <time dateTime={message.createdAt} title={message.createdAt}>
                  {formatConversationTimestamp(message.createdAt)}
                </time>
                <div className="conv-msg__actions">
                  <button
                    type="button"
                    className="conv-msg__action"
                    onClick={() => void handleCopy(message)}
                    disabled={isStreaming}
                    aria-label={t("conversation.copyMessage")}
                    title={t("conversation.copyMessage")}
                  >
                    <MessageIcon type="copy" />
                  </button>
                  {message.role === "user" ? (
                    <button
                      type="button"
                      className="conv-msg__action"
                      onClick={() => startEditing(message)}
                      disabled={isStreaming}
                      aria-label={t("conversation.editMessage")}
                      title={t("conversation.editMessage")}
                    >
                      <MessageIcon type="edit" />
                    </button>
                  ) : canRegenerate ? (
                    <button
                      type="button"
                      className="conv-msg__action"
                      onClick={() => onRegenerateMessage(message.id)}
                      disabled={isStreaming}
                      aria-label={t("conversation.regenerateMessage")}
                      title={t("conversation.regenerateMessage")}
                    >
                      <MessageIcon type="regenerate" />
                    </button>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  const appendStreaming = isStreaming && streamingPlacement === "append";
  const afterMessageId = isStreaming && typeof streamingPlacement === "object"
    && streamingPlacement.mode === "after"
    ? streamingPlacement.messageId
    : null;

  return (
    <div className="conv-chat">
      <div className="conv-chat__messages">
        {messages.length === 0 ? (
          <div className="conv-msg conv-msg--ai" role="group">
            <div className="conv-msg__avatar">AI</div>
            <div className="conv-msg__body">
              <div className="conv-msg__content">{t("conversation.greeting")}</div>
            </div>
          </div>
        ) : messages.map((message, index) => (
          <div key={"message-slot-" + message.id + "-" + index}>
            {renderMessage(message, index)}
            {afterMessageId === message.id && renderStreamingMessage()}
          </div>
        ))}
        {appendStreaming && renderStreamingMessage()}
        <div ref={messagesEndRef} />
      </div>

      <div className="conv-chat__copy-status" role="status" aria-live="polite">
        {copyStatus}
      </div>
      <div className="conv-chat__input-bar">
        <textarea
          ref={inputRef}
          className="conv-chat__input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("conversation.inputPlaceholder")}
          rows={1}
          disabled={isStreaming}
        />
        <button
          className="conv-chat__send"
          type="button"
          onClick={handleSubmit}
          disabled={isStreaming || !input.trim()}
          aria-label={t("conversation.sendMessage")}
          title={t("conversation.sendMessage")}
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
