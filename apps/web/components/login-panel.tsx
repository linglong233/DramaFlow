"use client";

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { SessionPayload } from "@dramaflow/shared";

import { apiFetch, formatApiError, saveSession } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { InlineFeedback } from "./inline-feedback";

export function LoginPanel() {
  const router = useRouter();
  const { t } = useI18n();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isRegister = useMemo(() => mode === "register", [mode]);

  const authMutation = useMutation({
    mutationFn: async () => {
      return apiFetch<SessionPayload>(isRegister ? "/auth/register" : "/auth/login", {
        method: "POST",
        body: {
          email,
          password,
          displayName: displayName || t("login.defaultDisplayName"),
        },
      });
    },
    onSuccess: (payload) => {
      saveSession(payload);
      setMessage(isRegister ? t("login.registerSuccess") : t("login.loginSuccess"));
      setError(null);
      router.push("/dashboard");
    },
    onError: (submitError) => {
      setMessage(null);
      setError(formatApiError(submitError, t, "login.requestFailed"));
    },
  });

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    authMutation.mutate();
  }

  return (
    <div className="panel panel--auth">
      <div className="inline-actions inline-actions--equal">
        <button className={mode === "login" ? "primary-btn" : "secondary-btn"} type="button" onClick={() => setMode("login")}>
          {t("login.modeLogin")}
        </button>
        <button className={mode === "register" ? "primary-btn" : "secondary-btn"} type="button" onClick={() => setMode("register")}>
          {t("login.modeRegister")}
        </button>
      </div>

      <form className="stack" onSubmit={handleSubmit}>
        {isRegister ? (
          <label>
            {t("login.displayNameLabel")}
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder={t("login.displayNamePlaceholder")}
            />
          </label>
        ) : null}

        <label>
          {t("login.emailLabel")}
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={t("login.emailPlaceholder")}
          />
        </label>

        <label>
          {t("login.passwordLabel")}
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={t("login.passwordPlaceholder")}
          />
        </label>

        <button className="primary-btn" type="submit" disabled={authMutation.isPending || !email.trim() || !password.trim()}>
          {authMutation.isPending
            ? t("common.submitting")
            : isRegister
              ? t("login.registerSubmit")
              : t("login.loginSubmit")}
        </button>
      </form>

      <InlineFeedback message={message} error={error} />
    </div>
  );
}
