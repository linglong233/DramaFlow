/**
 * @fileoverview 国际化 Provider
 * @module web/lib/i18n
 *
 * 国际化上下文 Provider 和翻译 Hook。
 */

"use client";

import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
  LOCALE_STORAGE_KEY,
  normalizeLocale,
  type Locale,
} from "./config";
import {
  messages,
  type Messages,
  type TranslateFn,
  type TranslationKey,
  type TranslationParams,
} from "./messages";

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TranslateFn;
  formatDate: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function resolveTemplate(locale: Locale, key: TranslationKey): string {
  const parts = key.split(".");
  let current: unknown = messages[locale] as Messages;

  for (const part of parts) {
    if (!current || typeof current !== "object" || !(part in current)) {
      return key;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return typeof current === "string" ? current : key;
}

function interpolate(template: string, params?: TranslationParams) {
  if (!params) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (_, token: string) => {
    const value = params[token];
    return value === undefined ? `{${token}}` : String(value);
  });
}

function persistLocale(locale: Locale) {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return;
  }

  document.cookie = `${LOCALE_COOKIE_NAME}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
  window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  document.documentElement.lang = locale;
}

function readStoredLocale() {
  if (typeof window === "undefined") {
    return DEFAULT_LOCALE;
  }

  return normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
}

export function I18nProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(normalizeLocale(initialLocale));

  useEffect(() => {
    const storedLocale = readStoredLocale();
    if (storedLocale !== locale) {
      setLocaleState(storedLocale);
      return;
    }

    persistLocale(locale);
  }, []);

  useEffect(() => {
    persistLocale(locale);
  }, [locale]);

  useEffect(() => {
    function syncLocale(event: StorageEvent) {
      if (event.key !== LOCALE_STORAGE_KEY) {
        return;
      }

      setLocaleState(normalizeLocale(event.newValue));
    }

    window.addEventListener("storage", syncLocale);
    return () => window.removeEventListener("storage", syncLocale);
  }, []);

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(normalizeLocale(nextLocale));
  }, []);

  const t = useCallback<TranslateFn>((key, params) => {
    const template = resolveTemplate(locale, key);
    return interpolate(template, params);
  }, [locale]);

  const formatDate = useCallback<I18nContextValue["formatDate"]>((value, options) => {
    const date = value instanceof Date ? value : new Date(value);
    const formatterLocale = locale === "en" ? "en-US" : locale;

    return new Intl.DateTimeFormat(formatterLocale, options ?? {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }, [locale]);

  const contextValue = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale,
    t,
    formatDate,
  }), [formatDate, locale, setLocale, t]);

  return <I18nContext.Provider value={contextValue}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used inside I18nProvider");
  }

  return context;
}
