"use client";

import { useEffect, useMemo, useState } from "react";

import { apiFetch } from "../lib/api";

interface DocumentRecord {
  id: string;
  projectId: string;
  type: "script" | "storyboard" | "image" | "video";
  title: string;
  shotId?: string;
  currentVersionId?: string;
}

interface VersionRecord {
  id: string;
  documentId: string;
  versionNumber: number;
  status: string;
  title: string;
  content: unknown;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface ProjectPayload {
  project: {
    id: string;
    name: string;
    description: string;
    reviewPolicyMode: "inherit" | "required" | "bypass";
  };
  members: Array<{ id: string; role: string; userId: string }>;
  invites: Array<{ id: string; email: string; role: string; status: string }>;
  documents: DocumentRecord[];
  versions: VersionRecord[];
}

interface CommentRecord {
  id: string;
  body: string;
  anchorType: string;
  createdAt: string;
  authorId: string;
  resolved: boolean;
}

export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const [projectData, setProjectData] = useState<ProjectPayload | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [comments, setComments] = useState<CommentRecord[]>([]);
  const [manualTitle, setManualTitle] = useState("手动版本");
  const [manualContent, setManualContent] = useState('{\n  "note": "在这里贴剧本 JSON、分镜 JSON 或素材元数据"\n}');
  const [commentBody, setCommentBody] = useState("");
  const [scriptForm, setScriptForm] = useState({
    title: "夜幕追光",
    genre: "都市悬疑",
    premise: "一位导演在最后一晚重组快要流产的短剧项目。",
    episodeGoal: "完成首集核心冲突的搭建",
    tone: "高压、克制、电影化",
    audience: "18-35 都市女性与创作从业者",
  });
  const [storyboardForm, setStoryboardForm] = useState({
    cinematicStyle: "颗粒感夜景、长焦压缩、霓虹反光",
    shotDensity: "balanced" as "sparse" | "balanced" | "dense",
  });
  const [mediaForm, setMediaForm] = useState({
    shotId: "shot-1-1",
    prompt: "霓虹夜景中主角站在天台边缘回头",
    style: "现实主义、电影剧照",
    aspectRatio: "16:9",
    durationSeconds: 5,
  });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadProject() {
    try {
      const payload = await apiFetch<ProjectPayload>(`/projects/${projectId}`);
      setProjectData(payload);
      setSelectedDocumentId((current) => current || payload.documents[0]?.id || "");
      const defaultVersionId = payload.versions.find((version) => version.documentId === (selectedDocumentId || payload.documents[0]?.id))?.id || "";
      setSelectedVersionId((current) => current || defaultVersionId);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "项目载入失败");
    }
  }

  useEffect(() => {
    void loadProject();
  }, [projectId]);

  useEffect(() => {
    if (!selectedVersionId) {
      setComments([]);
      return;
    }

    void apiFetch<CommentRecord[]>(`/versions/${selectedVersionId}/comments`)
      .then(setComments)
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "评论载入失败");
      });
  }, [selectedVersionId]);

  const selectedDocument = useMemo(
    () => projectData?.documents.find((document) => document.id === selectedDocumentId),
    [projectData, selectedDocumentId],
  );

  const documentVersions = useMemo(
    () => projectData?.versions.filter((version) => version.documentId === selectedDocumentId) ?? [],
    [projectData, selectedDocumentId],
  );

  const currentVersion = useMemo(
    () => documentVersions.find((version) => version.id === selectedVersionId) ?? documentVersions[0] ?? null,
    [documentVersions, selectedVersionId],
  );

  async function createManualVersion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDocumentId) {
      return;
    }

    try {
      let parsed: unknown = manualContent;
      try {
        parsed = JSON.parse(manualContent);
      } catch {
        parsed = { raw: manualContent };
      }

      const version = await apiFetch<VersionRecord>(`/documents/${selectedDocumentId}/versions`, {
        method: "POST",
        body: {
          title: manualTitle,
          content: parsed,
          metadata: {
            source: "manual-editor",
          },
        },
      });
      setMessage(`已创建版本 V${version.versionNumber}`);
      await loadProject();
      setSelectedVersionId(version.id);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "创建版本失败");
    }
  }

  async function submitVersion() {
    if (!currentVersion) {
      return;
    }
    try {
      const version = await apiFetch<VersionRecord>(`/versions/${currentVersion.id}/submit`, { method: "POST" });
      setMessage(`版本状态已更新为 ${version.status}`);
      await loadProject();
      setSelectedVersionId(version.id);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "提交版本失败");
    }
  }

  async function reviewVersion(action: "approve" | "reject") {
    if (!currentVersion) {
      return;
    }
    try {
      const version = await apiFetch<VersionRecord>(`/versions/${currentVersion.id}/${action}`, { method: "POST" });
      setMessage(`版本状态已更新为 ${version.status}`);
      await loadProject();
      setSelectedVersionId(version.id);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : `${action} 失败`);
    }
  }

  async function addComment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedVersionId) {
      return;
    }
    try {
      await apiFetch(`/versions/${selectedVersionId}/comments`, {
        method: "POST",
        body: {
          body: commentBody,
          anchorType: "document",
        },
      });
      setCommentBody("");
      setMessage("评论已添加");
      const nextComments = await apiFetch<CommentRecord[]>(`/versions/${selectedVersionId}/comments`);
      setComments(nextComments);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "评论失败");
    }
  }

  async function queueScriptJob(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const job = await apiFetch<{ id: string }>(`/projects/${projectId}/script-jobs`, {
        method: "POST",
        body: scriptForm,
      });
      setMessage(`剧本生成任务已入队：${job.id}`);
      await loadProject();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "剧本生成失败");
    }
  }

  async function queueStoryboardJob(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const storyboardDocument = projectData?.documents.find((document) => document.type === "storyboard");
    const scriptDocument = projectData?.documents.find((document) => document.type === "script");
    const sourceVersionId = projectData?.versions.find((version) => version.documentId === scriptDocument?.id)?.id;

    if (!storyboardDocument || !sourceVersionId) {
      setError("请先生成或创建剧本版本");
      return;
    }

    try {
      const job = await apiFetch<{ id: string }>(`/projects/${projectId}/storyboard-jobs`, {
        method: "POST",
        body: {
          documentId: storyboardDocument.id,
          versionId: sourceVersionId,
          ...storyboardForm,
        },
      });
      setMessage(`分镜任务已入队：${job.id}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "分镜生成失败");
    }
  }

  async function queueMediaJob(kind: "image" | "video") {
    try {
      const job = await apiFetch<{ id: string }>(`/shots/${mediaForm.shotId}/${kind}-jobs`, {
        method: "POST",
        body: {
          projectId,
          style: mediaForm.style,
          aspectRatio: mediaForm.aspectRatio,
          prompt: mediaForm.prompt,
          durationSeconds: mediaForm.durationSeconds,
        },
      });
      setMessage(`${kind === "image" ? "生图" : "生视频"}任务已入队：${job.id}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : `${kind} 生成失败`);
    }
  }

  async function updateReviewPolicy(mode: "inherit" | "required" | "bypass") {
    try {
      await apiFetch(`/projects/${projectId}/review-policy`, {
        method: "PATCH",
        body: { reviewPolicyMode: mode },
      });
      setMessage(`审核策略已切换为 ${mode}`);
      await loadProject();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "切换审核策略失败");
    }
  }

  if (!projectData) {
    return <div className="panel">正在载入项目...</div>;
  }

  return (
    <div className="stack">
      <section className="panel">
        <span className="kicker">项目工作台</span>
        <h1 style={{ marginBottom: 10 }}>{projectData.project.name}</h1>
        <p className="subhead">{projectData.project.description || "为这个项目补一句面向导演团队的简洁说明。"}</p>
        <div className="inline-actions" style={{ gridTemplateColumns: "repeat(3, minmax(0, max-content))", marginTop: 18 }}>
          <button className="secondary-btn" type="button" onClick={() => updateReviewPolicy("inherit")}>继承团队策略</button>
          <button className="secondary-btn" type="button" onClick={() => updateReviewPolicy("required")}>强制审核</button>
          <button className="secondary-btn" type="button" onClick={() => updateReviewPolicy("bypass")}>跳过审核</button>
        </div>
      </section>

      {message ? <div className="notice">{message}</div> : null}
      {error ? <div className="notice error">{error}</div> : null}

      <section className="workspace-grid">
        <div className="workspace-card stack">
          <h2>文档与版本</h2>
          <label>
            当前文档
            <select value={selectedDocumentId} onChange={(event) => {
              setSelectedDocumentId(event.target.value);
              const nextVersion = projectData.versions.find((version) => version.documentId === event.target.value)?.id ?? "";
              setSelectedVersionId(nextVersion);
            }}>
              {projectData.documents.map((document) => (
                <option key={document.id} value={document.id}>{document.type} / {document.title}</option>
              ))}
            </select>
          </label>
          <div className="stack">
            {documentVersions.map((version) => (
              <button
                key={version.id}
                className={version.id === currentVersion?.id ? "primary-btn" : "secondary-btn"}
                type="button"
                onClick={() => setSelectedVersionId(version.id)}
              >
                V{version.versionNumber} · {version.title} · {version.status}
              </button>
            ))}
          </div>
        </div>

        <div className="workspace-card stack">
          <h2>当前版本</h2>
          {currentVersion ? (
            <>
              <div className="tag">状态：{currentVersion.status}</div>
              <pre>{JSON.stringify(currentVersion.content, null, 2)}</pre>
              <div className="inline-actions" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                <button className="primary-btn" type="button" onClick={submitVersion}>提交版本</button>
                <button className="secondary-btn" type="button" onClick={() => reviewVersion("approve")}>通过</button>
                <button className="secondary-btn" type="button" onClick={() => reviewVersion("reject")}>驳回</button>
              </div>
            </>
          ) : (
            <div className="muted">当前文档还没有版本。</div>
          )}
        </div>
      </section>

      <section className="workspace-grid">
        <form className="form-card stack" onSubmit={createManualVersion}>
          <h2>手动提交新版本</h2>
          <label>
            版本标题
            <input value={manualTitle} onChange={(event) => setManualTitle(event.target.value)} />
          </label>
          <label>
            版本内容
            <textarea value={manualContent} onChange={(event) => setManualContent(event.target.value)} />
          </label>
          <button className="primary-btn" type="submit">创建版本</button>
        </form>

        <div className="form-card stack">
          <h2>团队与讨论</h2>
          <div className="muted">成员数：{projectData.members.length}，待处理邀请：{projectData.invites.length}</div>
          <form className="stack" onSubmit={addComment}>
            <label>
              对当前版本发起讨论
              <textarea value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder="写下导演意见、镜头调整建议或审核意见" />
            </label>
            <button className="primary-btn" type="submit" disabled={!selectedVersionId}>添加评论</button>
          </form>
          <div className="stack">
            {comments.map((comment) => (
              <div key={comment.id} className="comment-card">
                <div className="tag">{comment.anchorType}</div>
                <p>{comment.body}</p>
                <div className="muted">{new Date(comment.createdAt).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="workspace-grid">
        <form className="form-card stack" onSubmit={queueScriptJob}>
          <h2>AI 生成剧本</h2>
          <label>
            标题
            <input value={scriptForm.title} onChange={(event) => setScriptForm({ ...scriptForm, title: event.target.value })} />
          </label>
          <label>
            类型
            <input value={scriptForm.genre} onChange={(event) => setScriptForm({ ...scriptForm, genre: event.target.value })} />
          </label>
          <label>
            核心 premise
            <textarea value={scriptForm.premise} onChange={(event) => setScriptForm({ ...scriptForm, premise: event.target.value })} />
          </label>
          <label>
            单集目标
            <input value={scriptForm.episodeGoal} onChange={(event) => setScriptForm({ ...scriptForm, episodeGoal: event.target.value })} />
          </label>
          <label>
            调性
            <input value={scriptForm.tone} onChange={(event) => setScriptForm({ ...scriptForm, tone: event.target.value })} />
          </label>
          <label>
            受众
            <input value={scriptForm.audience} onChange={(event) => setScriptForm({ ...scriptForm, audience: event.target.value })} />
          </label>
          <button className="primary-btn" type="submit">提交剧本任务</button>
        </form>

        <form className="form-card stack" onSubmit={queueStoryboardJob}>
          <h2>AI 生成分镜</h2>
          <label>
            影像风格
            <textarea value={storyboardForm.cinematicStyle} onChange={(event) => setStoryboardForm({ ...storyboardForm, cinematicStyle: event.target.value })} />
          </label>
          <label>
            镜头密度
            <select value={storyboardForm.shotDensity} onChange={(event) => setStoryboardForm({ ...storyboardForm, shotDensity: event.target.value as "sparse" | "balanced" | "dense" })}>
              <option value="sparse">稀疏</option>
              <option value="balanced">平衡</option>
              <option value="dense">密集</option>
            </select>
          </label>
          <button className="primary-btn" type="submit">提交分镜任务</button>
        </form>
      </section>

      <section className="workspace-grid">
        <div className="form-card stack">
          <h2>镜头生图 / 生视频</h2>
          <label>
            Shot ID
            <input value={mediaForm.shotId} onChange={(event) => setMediaForm({ ...mediaForm, shotId: event.target.value })} />
          </label>
          <label>
            Prompt
            <textarea value={mediaForm.prompt} onChange={(event) => setMediaForm({ ...mediaForm, prompt: event.target.value })} />
          </label>
          <label>
            风格
            <input value={mediaForm.style} onChange={(event) => setMediaForm({ ...mediaForm, style: event.target.value })} />
          </label>
          <label>
            宽高比
            <select value={mediaForm.aspectRatio} onChange={(event) => setMediaForm({ ...mediaForm, aspectRatio: event.target.value })}>
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
              <option value="1:1">1:1</option>
            </select>
          </label>
          <label>
            时长（视频）
            <input type="number" value={mediaForm.durationSeconds} onChange={(event) => setMediaForm({ ...mediaForm, durationSeconds: Number(event.target.value) })} />
          </label>
          <div className="inline-actions" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            <button className="primary-btn" type="button" onClick={() => queueMediaJob("image")}>提交生图任务</button>
            <button className="secondary-btn" type="button" onClick={() => queueMediaJob("video")}>提交生视频任务</button>
          </div>
        </div>

        <div className="workspace-card stack">
          <h2>资源概览</h2>
          <div className="muted">文档总数：{projectData.documents.length}</div>
          <div className="muted">历史版本：{projectData.versions.length}</div>
          <div className="muted">当前审核策略：{projectData.project.reviewPolicyMode}</div>
          <div className="tag">支持剧本、分镜、图片、视频统一版本管理</div>
          {selectedDocument ? <div className="tag">当前文档类型：{selectedDocument.type}</div> : null}
        </div>
      </section>
    </div>
  );
}

