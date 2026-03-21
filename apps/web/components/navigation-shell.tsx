"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { clearSession, readSession } from "../lib/api";

export function NavigationShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const session = readSession();

  return (
    <main className="page-shell">
      <div className="nav-shell">
        <div className="brand">
          <div className="brand-mark">DF</div>
          <div>
            <strong>DramaFlow</strong>
            <div className="muted">导演短剧生成平台</div>
          </div>
        </div>
        <div className="nav-links">
          <Link href="/dashboard">工作台</Link>
          <Link href="/admin/platform">平台后台</Link>
          <Link href="/admin/team">团队后台</Link>
          {session ? (
            <button
              type="button"
              onClick={() => {
                clearSession();
                router.push("/login");
              }}
            >
              退出登录
            </button>
          ) : (
            <Link href="/login">登录</Link>
          )}
        </div>
      </div>
      {children}
    </main>
  );
}

