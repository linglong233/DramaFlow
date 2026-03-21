"use client";

import { useEffect, useState } from "react";

import { NavigationShell } from "../../../components/navigation-shell";
import { apiFetch } from "../../../lib/api";

interface TeamRecord {
  id: string;
  name: string;
  slug: string;
}

interface TeamOverview {
  team: { id: string; name: string; defaultReviewPolicy: string };
  members: Array<{ id: string; role: string; userId: string }>;
  projects: Array<{ id: string; name: string; reviewPolicyMode: string }>;
  projectInvites: Array<{ id: string; email: string; role: string; status: string }>;
  pendingReviews: Array<{ id: string; title: string; status: string }>;
}

export default function TeamAdminPage() {
  const [teams, setTeams] = useState<TeamRecord[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [overview, setOverview] = useState<TeamOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiFetch<TeamRecord[]>("/teams")
      .then((result) => {
        setTeams(result);
        setSelectedTeamId(result[0]?.id ?? "");
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "团队列表载入失败");
      });
  }, []);

  useEffect(() => {
    if (!selectedTeamId) {
      return;
    }
    void apiFetch<TeamOverview>(`/admin/teams/${selectedTeamId}/overview`)
      .then(setOverview)
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "团队后台载入失败");
      });
  }, [selectedTeamId]);

  return (
    <NavigationShell>
      <div className="stack">
        <section className="panel">
          <span className="kicker">团队后台</span>
          <h1>成员、项目与审核队列</h1>
          <p className="subhead">按 Team 查看成员角色、项目列表、邀请记录和待审版本。</p>
        </section>
        {error ? <div className="notice error">{error}</div> : null}
        <section className="form-card stack">
          <label>
            选择 Team
            <select value={selectedTeamId} onChange={(event) => setSelectedTeamId(event.target.value)}>
              <option value="">请选择</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>{team.name}</option>
              ))}
            </select>
          </label>
        </section>
        {overview ? (
          <section className="workspace-grid">
            <div className="list-card stack">
              <h2>{overview.team.name}</h2>
              <div className="tag">默认审核：{overview.team.defaultReviewPolicy}</div>
              <div className="muted">成员 {overview.members.length} 人</div>
              {overview.members.map((member) => (
                <div key={member.id} className="workspace-card">
                  <strong>{member.userId}</strong>
                  <div className="muted">{member.role}</div>
                </div>
              ))}
            </div>
            <div className="list-card stack">
              <h2>项目与待审</h2>
              {overview.projects.map((project) => (
                <div key={project.id} className="workspace-card">
                  <strong>{project.name}</strong>
                  <div className="muted">审核策略：{project.reviewPolicyMode}</div>
                </div>
              ))}
              <h3>待审版本</h3>
              {overview.pendingReviews.map((version) => (
                <div key={version.id} className="comment-card">
                  <strong>{version.title}</strong>
                  <div className="tag">{version.status}</div>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <div className="panel">选择一个 Team 查看详情。</div>
        )}
      </div>
    </NavigationShell>
  );
}

