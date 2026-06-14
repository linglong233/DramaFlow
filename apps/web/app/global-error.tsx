/**
 * @fileoverview 全局错误边界
 * @module web/app
 *
 * 捕获根 layout 与 Provider 级别的渲染异常，避免白屏。
 * 注意：Next.js 要求该文件自带 <html>/<body>，并重新引入全局样式，
 * 且不能依赖 AppProviders（因为 Provider 自身可能就是异常源）。
 */

"use client";

import { useEffect } from "react";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    // 便于在控制台快速定位根级异常。
    // eslint-disable-next-line no-console
    console.error("[DramaFlow] global error:", error);
  }, [error]);

  return (
    <html lang="zh">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          background: "#09090b",
          color: "#fafafa",
          fontFamily:
            'Geist, "Noto Sans SC", "Segoe UI", -apple-system, sans-serif',
        }}
      >
        <div style={{ maxWidth: 440, textAlign: "center" }}>
          <div
            style={{
              width: 56,
              height: 56,
              margin: "0 auto 20px",
              borderRadius: 16,
              background: "rgba(239, 68, 68, 0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 28,
            }}
            aria-hidden="true"
          >
            ⚠️
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
            页面出错了 / Something went wrong
          </h1>
          <p style={{ color: "#a1a1aa", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
            应用遇到了未预期的错误。可以尝试重新加载；如果持续出现，请回到登录页重新进入。
            <br />
            The app hit an unexpected error. Try reloading, or return to the login page.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                padding: "10px 20px",
                borderRadius: 10,
                border: "none",
                background: "#38bdf8",
                color: "#09090b",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              重新加载 / Reload
            </button>
            <a
              href="/login"
              style={{
                padding: "10px 20px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.15)",
                background: "transparent",
                color: "#fafafa",
                textDecoration: "none",
                fontWeight: 500,
              }}
            >
              返回登录 / Back to login
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
