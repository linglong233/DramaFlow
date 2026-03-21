"use client";

import { useEffect, useState } from "react";

import { NavigationShell } from "../../../components/navigation-shell";
import { apiFetch } from "../../../lib/api";

interface PlatformOverview {
  metrics: {
    users: number;
    teams: number;
    projects: number;
    queuedJobs: number;
    pendingReviewVersions: number;
  };
  recentJobs: Array<{ id: string; type: string; status: string; updatedAt: string }>;
  tenants: Array<{ id: string; name: string; slug: string }>;
  storageDriver: string;
}

export default function PlatformAdminPage() {
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiFetch<PlatformOverview>("/admin/platform/overview")
      .then(setOverview)
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "平台后台载入失败");
      });
  }, []);

  return (
    <NavigationShell>
      <div className="stack">
        <section className="panel">
          <span className="kicker">平台后台</span>
          <h1>租户、队列与审核全景</h1>
          <p className="subhead">这里用于查看平台级指标、近期任务和所有 Team 的托管情况。</p>
        </section>
        {error ? <div className="notice error">{error}</div> : null}
        {overview ? (
          <>
            <section className="stats-grid">
              <div className="stat-tile"><div className="muted">用户</div><div className="metric">{overview.metrics.users}</div></div>
              <div className="stat-tile"><div className="muted">团队</div><div className="metric">{overview.metrics.teams}</div></div>
              <div className="stat-tile"><div className="muted">项目</div><div className="metric">{overview.metrics.projects}</div></div>
              <div className="stat-tile"><div className="muted">排队任务</div><div className="metric">{overview.metrics.queuedJobs}</div></div>
            </section>
            <section className="workspace-grid">
              <div className="list-card stack">
                <h2>近期任务</h2>
                {overview.recentJobs.map((job) => (
                  <div key={job.id} className="job-card">
                    <strong>{job.type}</strong>
                    <div className="muted">{job.id}</div>
                    <div className="tag">{job.status}</div>
                  </div>
                ))}
              </div>
              <div className="list-card stack">
                <h2>租户列表</h2>
                <div className="tag">当前存储驱动：{overview.storageDriver}</div>
                {overview.tenants.map((tenant) => (
                  <div key={tenant.id} className="workspace-card">
                    <strong>{tenant.name}</strong>
                    <div className="muted">{tenant.slug}</div>
                  </div>
                ))}
              </div>
            </section>
          </>
        ) : (
          <div className="panel">正在载入平台后台...</div>
        )}
      </div>
    </NavigationShell>
  );
}

