/**
 * @fileoverview 语言切换器
 * @module web/components
 *
 * 界面语言切换下拉组件。
 */

"use client";

import { useState, useRef, useEffect } from "react";
import { LOCALE_LABELS, type Locale, useI18n } from "../lib/i18n";

export function LanguageSwitcher({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} style={{ position: "relative", display: "inline-block", ...style }} className={className}>
      <button 
        className="btn btn-secondary btn-sm"
        onClick={() => setOpen(!open)}
        aria-label={t("common.language")}
        style={{ display: "flex", alignItems: "center", gap: "6px", height: "30px" }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
        {LOCALE_LABELS[locale]}
      </button>

      {open && (
        <div 
          style={{ 
            position: "absolute", 
            top: "calc(100% + 4px)", 
            right: 0, 
            background: "var(--bg-surface)", 
            border: "1px solid var(--border-subtle)", 
            borderRadius: "var(--radius-md)", 
            boxShadow: "var(--shadow-md)", 
            padding: "4px", 
            zIndex: 100,
            minWidth: "120px"
          }}
        >
          {(Object.entries(LOCALE_LABELS) as Array<[Locale, string]>).map(([value, label]) => (
            <button
              key={value}
              onClick={() => {
                setLocale(value);
                setOpen(false);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "6px 12px",
                fontSize: "13px",
                background: locale === value ? "var(--bg-elevated)" : "transparent",
                color: locale === value ? "var(--accent)" : "var(--text-secondary)",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontWeight: locale === value ? 600 : 400
              }}
              onMouseOver={(e) => {
                 if (locale !== value) {
                   e.currentTarget.style.background = "var(--bg-elevated)";
                   e.currentTarget.style.color = "var(--text-primary)";
                 }
              }}
              onMouseOut={(e) => {
                 if (locale !== value) {
                   e.currentTarget.style.background = "transparent";
                   e.currentTarget.style.color = "var(--text-secondary)";
                 }
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
