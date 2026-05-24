"use client";

import { useEffect, useRef, useState } from "react";
import type { ConversationMessage } from "@dramaflow/shared";
import { useI18n } from "../../lib/i18n";

interface Props {
  messages: ConversationMessage[];
  streamingText: string;
  isStreaming: boolean;
  onSendMessage: (content: string) => void;
}

export function ConversationChat({ messages, streamingText, isStreaming, onSendMessage }: Props) {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

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

  return (
    <div className="conv-chat">
      <div className="conv-chat__messages">
        {messages.map((msg, i) => (
          <div key={i} className={`conv-msg conv-msg--${msg.role}`}>
            <div className="conv-msg__avatar">
              {msg.role === "ai" ? "AI" : t("conversation.userLabel")}
            </div>
            <div className="conv-msg__content">
              {msg.content}
            </div>
          </div>
        ))}
        {isStreaming && streamingText && (
          <div className="conv-msg conv-msg--ai">
            <div className="conv-msg__avatar">AI</div>
            <div className="conv-msg__content">
              {streamingText}
              <span className="conv-msg__cursor" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
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
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
