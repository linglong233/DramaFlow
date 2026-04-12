/**
 * @fileoverview 忘记密码表单
 * @module web/components
 *
 * 忘记密码的邮箱输入和提交表单。
 */

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { apiFetch, formatApiError } from "../lib/api";
import { useI18n } from "../lib/i18n";

interface ForgotPasswordResponse {
  ok: boolean;
  message: string;
  token?: string;
}

export function ForgotPasswordForm() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<ForgotPasswordResponse | null>(null);

  const mutation = useMutation({
    mutationFn: () => apiFetch<ForgotPasswordResponse>("/auth/forgot-password", {
      method: "POST",
      body: { email },
    }),
    onSuccess: (payload) => {
      setResponse(payload);
      setError(null);
    },
    onError: (submitError) => {
      setResponse(null);
      setError(formatApiError(submitError, t, "authRecovery.forgot.requestFailed"));
    },
  });

  const resetHref = useMemo(() => {
    if (!response?.token) {
      return null;
    }
    return `/reset-password?token=${encodeURIComponent(response.token)}`;
  }, [response?.token]);

  return (
    <div className="stack stack-gap-4">
      <div className="stack stack-gap-2">
        <span className="kicker">{t("authRecovery.forgot.kicker")}</span>
        <h1 className="page-title">{t("authRecovery.forgot.title")}</h1>
        <p className="page-description">{t("authRecovery.forgot.description")}</p>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="recovery-email">{t("authRecovery.forgot.emailLabel")}</label>
        <input
          id="recovery-email"
          className="input"
          type="email"
          autoComplete="email"
          placeholder={t("authRecovery.forgot.emailPlaceholder")}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      {response ? <div className="notice" role="status">{response.message}</div> : null}
      {error ? <div className="notice notice--error" role="alert">{error}</div> : null}

      {response?.token ? (
        <div className="stack stack-gap-2">
          <span className="form-label">{t("authRecovery.forgot.tokenLabel")}</span>
          <code className="json-preview" style={{ minHeight: 0, padding: "var(--space-4)", fontSize: 12 }}>{response.token}</code>
          <p className="muted text-sm">{t("authRecovery.forgot.tokenHint")}</p>
          {resetHref ? (
            <a href={resetHref} className="btn btn-secondary" style={{ width: "100%" }}>
              {t("authRecovery.forgot.openResetAction")}
            </a>
          ) : null}
        </div>
      ) : null}

      <button className="btn btn-primary" type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending || !email.trim()}>
        {mutation.isPending ? t("common.submitting") : t("authRecovery.forgot.submit")}
      </button>

      <Link href={"/login" as const} style={{ textAlign: "center", fontSize: 13 }}>
        {t("authRecovery.backToLogin")}
      </Link>
    </div>
  );
}