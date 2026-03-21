"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { apiFetch, readSession } from "../lib/api";

interface Team {
  id: string;
  name: string;
  slug: string;
  defaultReviewPolicy: string;
}

interface Project {
  id: string;
  teamId: string;
  name: string;
  description: string;
  reviewPolicyMode: string;
}

interface PlatformOverview {
  metrics: {
    users: number;
    teams: number;
    projects: number;
    queuedJobs: number;
    pendingReviewVersions: number;
  };
}

export function DashboardOverview() {
  const session = readSession();
  const [teams, setTeams] = useState<Team[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [platformOverview, setPlatformOverview] = useState<PlatformOverview | null>(null);
  const [teamName, setTeamName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadData() {
    try {
      setError(null);
      const [teamData, projectData] = await Promise.all([
        apiFetch<Team[]>("/teams"),
        apiFetch<Project[]>("/projects"),
      ]);
      setTeams(teamData);
      setProjects(projectData);
      setSelectedTeamId((current) => current || teamData[0]?.id || "");

      if (session?.user.globalRole === "platform_super_admin") {
        const overview = await apiFetch<PlatformOverview>("/admin/platform/overview");
        setPlatformOverview(overview);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "载入失败");
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  const stats = useMemo(() => {
    return {
      teams: teams.length,
      projects: projects.length,
      queuedJobs: platformOverview?.metrics.queuedJobs ?? 0,
      pendingReview: platformOverview?.metrics.pendingReviewVersions ?? 0,
    };
  }, [platformOverview, projects.length, teams.length]);

  async function createTeam(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const team = await apiFetch<Team>("/teams", {
        method: "POST",
        body: {
          name: teamName,
          defaultReviewPolicy: "required",
        },
      });
      setMessage(`团队 ${team.name} 创建成功`);
      setTeamName("");
      await loadData();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "创建团队失败");
    }
  }

  async function createProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const project = await apiFetch<Project>("/projects", {
        method: "POST",
        body: {
          teamId: selectedTeamId,
          name: projectName,
          description: projectDescription,
          reviewPolicyMode: "inherit",
        },
      });
      setMessage(`项目 ${project.name} 已创建`);
      setProjectName("");
      setProjectDescription("");
      await loadData();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "创建项目失败");
    }
  }

  return (
    <div className="stack">
      <section className="panel">
        <span className="kicker">导演工作台</span>
        <h1 style={{ marginBottom: 10 }}>欢迎回来，{session?.user.displayName ?? "导演"}</h1>
        <p className="subhead">
          从这里创建团队、搭建项目、进入版本协作面板，并跳转到平台后台或团队后台查看审批和任务运行状态。
        </p>
      </section>

      <section className="stats-grid">
        <div className="stat-tile">
          <div className="muted">团队数</div>
          <div className="metric">{stats.teams}</div>
        </div>
        <div className="stat-tile">
          <div className="muted">项目数</div>
          <div className="metric">{stats.projects}</div>
        </div>
        <div className="stat-tile">
          <div className="muted">排队任务</div>
          <div className="metric">{stats.queuedJobs}</div>
        </div>
        <div className="stat-tile">
          <div className="muted">待审版本</div>
          <div className="metric">{stats.pendingReview}</div>
        </div>
      </section>

      {message ? <div className="notice">{message}</div> : null}
      {error ? <div className="notice error">{error}</div> : null}

      <section className="workspace-grid">
        <form className="form-card stack" onSubmit={createTeam}>
          <h2>创建 Team</h2>
          <label>
            团队名称
            <input value={teamName} onChange={(event) => setTeamName(event.target.value)} placeholder="例如：流光短剧工作室" />
          </label>
          <button className="primary-btn" type="submit">创建团队</button>
        </form>

        <form className="form-card stack" onSubmit={createProject}>
          <h2>创建项目</h2>
          <label>
            所属团队
            <select value={selectedTeamId} onChange={(event) => setSelectedTeamId(event.target.value)}>
              <option value="">请选择团队</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>{team.name}</option>
              ))}
            </select>
          </label>
          <label>
            项目名称
            <input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="例如：雾都追光" />
          </label>
          <label>
            项目描述
            <textarea value={projectDescription} onChange={(event) => setProjectDescription(event.target.value)} placeholder="一句话写清题材、目标受众和核心矛盾" />
          </label>
          <button className="primary-btn" type="submit" disabled={!selectedTeamId}>创建项目</button>
        </form>
      </section>

      <section className="card-grid">
        <div className="list-card stack">
          <div className="inline-actions" style={{ gridTemplateColumns: "1fr auto" }}>
            <h2>我的 Teams</h2>
            <Link className="secondary-btn" href="/admin/team">团队后台</Link>
          </div>
          {teams.length === 0 ? <div className="muted">还没有团队，先创建一个。</div> : null}
          {teams.map((team) => (
            <div key={team.id} className="workspace-card">
              <strong>{team.name}</strong>
              <div className="muted">Slug: {team.slug}</div>
              <div className="tag" style={{ marginTop: 12 }}>默认审核：{team.defaultReviewPolicy}</div>
            </div>
          ))}
        </div>

        <div className="list-card stack">
          <div className="inline-actions" style={{ gridTemplateColumns: "1fr auto" }}>
            <h2>我的项目</h2>
            {session?.user.globalRole === "platform_super_admin" ? (
              <Link className="secondary-btn" href="/admin/platform">平台后台</Link>
            ) : null}
          </div>
          {projects.length === 0 ? <div className="muted">还没有项目，创建一个导演工作台试试。</div> : null}
          {projects.map((project) => (
            <Link key={project.id} href={`/projects/${project.id}`} className="workspace-card">
              <strong>{project.name}</strong>
              <p className="muted">{project.description || "暂无描述"}</p>
              <div className="tag">审核策略：{project.reviewPolicyMode}</div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

