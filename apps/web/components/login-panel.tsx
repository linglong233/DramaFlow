"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiFetch, saveSession, type SessionPayload } from "../lib/api";

export function LoginPanel() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isRegister = useMemo(() => mode === "register", [mode]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const payload = await apiFetch<SessionPayload>(isRegister ? "/auth/register" : "/auth/login", {
        method: "POST",
        body: {
          email,
          password,
          displayName: displayName || "导演用户",
        },
      });
      saveSession(payload);
      setMessage(isRegister ? "注册成功，正在进入工作台。" : "登录成功，正在进入工作台。");
      router.push("/dashboard");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "请求失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="panel" style={{ maxWidth: 560, margin: "0 auto" }}>
      <div className="inline-actions" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <button className={mode === "login" ? "primary-btn" : "secondary-btn"} type="button" onClick={() => setMode("login")}>
          登录
        </button>
        <button className={mode === "register" ? "primary-btn" : "secondary-btn"} type="button" onClick={() => setMode("register")}>
          注册
        </button>
      </div>
      <form className="stack" style={{ marginTop: 20 }} onSubmit={handleSubmit}>
        {isRegister ? (
          <label>
            显示名称
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="例如：张导" />
          </label>
        ) : null}
        <label>
          邮箱
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="director@dramaflow.ai" />
        </label>
        <label>
          密码
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少输入一个开发密码" />
        </label>
        <button className="primary-btn" type="submit" disabled={submitting}>
          {submitting ? "提交中..." : isRegister ? "创建账号" : "进入工作台"}
        </button>
      </form>
      {message ? <div className="notice" style={{ marginTop: 16 }}>{message}</div> : null}
      {error ? <div className="notice error" style={{ marginTop: 16 }}>{error}</div> : null}
    </div>
  );
}

