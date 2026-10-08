/**
 * @fileoverview 语言切换器
 * @module web/components
 *
 * 界面语言切换下拉组件。
 */

"use client";

import { useId, type CSSProperties } from "react";
import { LOCALE_LABELS, type Locale, useI18n } from "../lib/i18n";

export function LanguageSwitcher({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  const { locale, setLocale, t } = useI18n();
  const selectId = useId();

  return (
    <div className={`language-switcher${className ? ` ${className}` : ""}`} style={style}>
      <svg className="language-switcher__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a17 17 0 0 1 0 18 17 17 0 0 1 0-18Z" />
      </svg>
      <label className="shared-ui-sr-only" htmlFor={selectId}>{t("common.language")}</label>
      <select
        id={selectId}
        className="language-switcher__select"
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
      >
        {(Object.entries(LOCALE_LABELS) as Array<[Locale, string]>).map(([value, label]) => (
          <option key={value} value={value} lang={value}>{label}</option>
        ))}
      </select>
      <svg className="language-switcher__chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m3 4.5 3 3 3-3" />
      </svg>
    </div>
  );
}
