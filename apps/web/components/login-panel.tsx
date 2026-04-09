"use client";

import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import type { SessionPayload } from "@dramaflow/shared";

import { apiFetch, formatApiError, saveSession } from "../lib/api";
import { useI18n } from "../lib/i18n";

export function LoginPanel() {
  const forgotPasswordRoute = "/forgot-password" as Route;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isRegister = mode === "register";

  const authMutation = useMutation({
    mutationFn: async () => apiFetch<SessionPayload>(isRegister ? "/auth/register" : "/auth/login", {
      method: "POST",
      body: {
        email,
        password,
        displayName: displayName || t("login.defaultDisplayName"),
      },
    }),
    onSuccess: (payload) => {
      saveSession(payload);
      setMessage(isRegister ? t("login.registerSuccess") : t("login.loginSuccess"));
      setError(null);
      const returnUrl = searchParams.get("returnUrl");
      router.push((returnUrl || "/dashboard") as Route);
    },
    onError: (submitError) => {
      setMessage(null);
      setError(formatApiError(submitError, t, "login.requestFailed"));
    },
  });

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    authMutation.mutate();
  }

  return (
    <form onSubmit={handleSubmit} className="stack stack-gap-4">
      {isRegister && (
        <div className="form-group">
          <label className="form-label" htmlFor="displayName">
            {t("login.displayNameLabel")}
          </label>
          <input
            id="displayName"
            className="input"
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder={t("login.displayNamePlaceholder")}
          />
        </div>
      )}

      <div className="form-group">
        <label className="form-label" htmlFor="email">
          {t("login.emailLabel")}
        </label>
        <input
          id="email"
          className="input"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={t("login.emailPlaceholder")}
          autoComplete="email"
        />
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="password">
          {t("login.passwordLabel")}
        </label>
        <input
          id="password"
          className="input"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={t("login.passwordPlaceholder")}
          autoComplete={isRegister ? "new-password" : "current-password"}
        />
      </div>

      {message ? <p style={{ color: "var(--success-text)", fontSize: "13px" }} role="status">{message}</p> : null}
      {error ? <p style={{ color: "var(--danger-text)", fontSize: "13px" }} role="alert">{error}</p> : null}

      <button
        className="btn btn-primary"
        type="submit"
        style={{ width: "100%" }}
        disabled={authMutation.isPending || !email.trim() || !password.trim()}
      >
        {authMutation.isPending
          ? t("common.submitting")
          : isRegister
            ? t("login.registerSubmit")
            : t("login.loginSubmit")}
      </button>

      {!isRegister ? (
        <Link href={forgotPasswordRoute} style={{ fontSize: "13px", color: "var(--accent)", textAlign: "center" }}>
          {t("login.forgotPasswordAction")}
        </Link>
      ) : null}

      <p style={{ textAlign: "center", fontSize: "13px", color: "var(--text-secondary)" }}>
        {isRegister ? t("login.hasAccountPrompt") : t("login.noAccountPrompt")}{" "}
        <button
          type="button"
          onClick={() => setMode(isRegister ? "login" : "register")}
          style={{
            background: "none",
            border: "none",
            color: "var(--accent)",
            cursor: "pointer",
            fontSize: "13px",
            fontWeight: 500,
            padding: 0,
          }}
        >
          {isRegister ? t("login.modeLogin") : t("login.modeRegister")}
        </button>
      </p>
    </form>
  );
}