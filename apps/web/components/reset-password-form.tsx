"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";

import { apiFetch, formatApiError } from "../lib/api";
import { useI18n } from "../lib/i18n";

export function ResetPasswordForm() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const [token, setToken] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initialToken = searchParams.get("token") ?? "";
    if (initialToken) {
      setToken(initialToken);
    }
  }, [searchParams]);

  const mutation = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>("/auth/reset-password", {
      method: "POST",
      body: {
        token,
        nextPassword,
      },
    }),
    onSuccess: () => {
      setMessage(t("authRecovery.reset.success"));
      setError(null);
      setNextPassword("");
    },
    onError: (submitError) => {
      setMessage(null);
      setError(formatApiError(submitError, t, "authRecovery.reset.requestFailed"));
    },
  });

  return (
    <div className="stack stack-gap-4">
      <div className="stack stack-gap-2">
        <span className="kicker">{t("authRecovery.reset.kicker")}</span>
        <h1 className="page-title">{t("authRecovery.reset.title")}</h1>
        <p className="page-description">{t("authRecovery.reset.description")}</p>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="reset-token">{t("authRecovery.reset.tokenLabel")}</label>
        <textarea
          id="reset-token"
          className="input"
          style={{ minHeight: 96 }}
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder={t("authRecovery.reset.tokenPlaceholder")}
        />
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="reset-password">{t("authRecovery.reset.passwordLabel")}</label>
        <input
          id="reset-password"
          className="input"
          type="password"
          autoComplete="new-password"
          value={nextPassword}
          onChange={(event) => setNextPassword(event.target.value)}
          placeholder={t("authRecovery.reset.passwordPlaceholder")}
        />
      </div>

      {message ? <div className="notice" role="status">{message}</div> : null}
      {error ? <div className="notice notice--error" role="alert">{error}</div> : null}

      <button className="btn btn-primary" type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending || !token.trim() || !nextPassword.trim()}>
        {mutation.isPending ? t("common.submitting") : t("authRecovery.reset.submit")}
      </button>

      <Link href="/login" style={{ textAlign: "center", fontSize: 13 }}>
        {t("authRecovery.backToLogin")}
      </Link>
    </div>
  );
}