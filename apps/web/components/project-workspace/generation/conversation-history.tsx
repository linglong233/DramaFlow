"use client";

import { useEffect, useRef, useState } from "react";
import type { ConversationSessionSummary } from "@dramaflow/shared";
import { useI18n } from "../../../lib/i18n";

interface Props {
  sessions: ConversationSessionSummary[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(dateStr).toLocaleDateString();
}

export function ConversationHistory({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
}: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className="conv-history" ref={dropdownRef}>
      <button
        className="conv-history__trigger"
        type="button"
        onClick={() => setOpen(!open)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span>{t("conversation.history")}</span>
        {sessions.length > 0 && (
          <span className="conv-history__badge">{sessions.length}</span>
        )}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="conv-history__dropdown">
          <div className="conv-history__header">
            <span className="conv-history__header-title">{t("conversation.historyTitle")}</span>
            <button type="button" className="conv-history__new" onClick={() => { onNewSession(); setOpen(false); }}>
              + {t("conversation.newSession")}
            </button>
          </div>
          <div className="conv-history__list">
            {sessions.length === 0 ? (
              <div className="conv-history__empty">{t("conversation.noHistory")}</div>
            ) : (
              sessions.map((s) => (
                <div
                  key={s.id}
                  className={`conv-history__item${s.id === activeSessionId ? " conv-history__item--active" : ""}`}
                  onClick={() => { onSelectSession(s.id); setOpen(false); }}
                >
                  <div className="conv-history__item-title">{s.firstUserMessage}</div>
                  <div className="conv-history__item-meta">
                    {s.messageCount} {t("conversation.messages")} · {relativeTime(s.updatedAt)}
                  </div>
                  <button
                    className="conv-history__item-delete"
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onDeleteSession(s.id); }}
                    aria-label={t("conversation.deleteSession")}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
