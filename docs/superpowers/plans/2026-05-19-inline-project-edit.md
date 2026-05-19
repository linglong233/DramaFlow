# 项目名称和简介内联编辑 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 ProjectInfoPanel 中为项目名称和简介添加悬停触发的内联编辑功能。

**Architecture:** 在现有 `project-info-panel.tsx` 中新增局部状态管理编辑模式，新增 `useMutation` 调用 `PATCH /projects/:id`，CSS 样式在 `globals.css` 中扩展 `pip-` 系列。纯前端改动，无后端变更。

**Tech Stack:** React 19, TanStack React Query, Next.js 15, CSS custom properties

---

### Task 1: 添加 CSS 样式

**Files:**
- Modify: `apps/web/app/globals.css`（在 `.pip-desc` 样式块之后，约 L8070）

- [ ] **Step 1: 在 `globals.css` 的 `.pip-desc` 后面添加内联编辑样式**

在 `.pip-desc` 规则（约 L8065-8070）之后插入：

```css
.pip-editable-field {
  position: relative;
  border-radius: var(--radius-sm);
  transition: background 0.15s ease;
}

.pip-editable-field:hover {
  background: color-mix(in srgb, var(--color-accent) 6%, transparent);
}

.pip-editable-field:hover .pip-edit-btn {
  opacity: 1;
}

.pip-editable-field:hover::before {
  content: "";
  position: absolute;
  inset: -3px;
  border: 1.5px dashed color-mix(in srgb, var(--color-accent) 30%, transparent);
  border-radius: var(--radius-sm);
  pointer-events: none;
}

.pip-edit-btn {
  position: absolute;
  top: 50%;
  right: 4px;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  border: none;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease, background 0.15s ease;
  white-space: nowrap;
  z-index: 1;
}

.pip-edit-btn:hover {
  background: color-mix(in srgb, var(--color-accent) 18%, transparent);
}

.pip-edit-input,
.pip-edit-textarea {
  width: 100%;
  padding: 4px 8px;
  border: 1.5px solid var(--color-accent);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  color: var(--text-primary);
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 10%, transparent);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.pip-edit-input {
  font-size: 1.75rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.2;
}

.pip-edit-textarea {
  font-size: 14px;
  line-height: 1.6;
  resize: vertical;
  min-height: 48px;
  max-width: 60ch;
}

.pip-edit-actions {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  margin-top: var(--space-2);
}

.pip-edit-actions .pip-edit-hint {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-left: auto;
}
```

- [ ] **Step 2: 运行 lint 确认无错误**

Run: `cd d:/Project/DramaFlow && npm --workspace @dramaflow/web run lint`
Expected: 无错误退出

- [ ] **Step 3: 提交**

```bash
git add apps/web/app/globals.css
git commit -m "style(web): add pip inline-edit CSS for project name/description"
```

---

### Task 2: 添加编辑状态和 mutation

**Files:**
- Modify: `apps/web/components/project-workspace/project-info-panel.tsx`

- [ ] **Step 1: 在 imports 中添加 `useCallback`**

当前文件 L10 有 `import { useState } from "react";`，改为：

```tsx
import { useCallback, useState } from "react";
```

- [ ] **Step 2: 在 `ProjectInfoPanel` 组件中添加编辑相关状态**

在现有 `const [showAddMember, setShowAddMember] = useState(false);`（约 L93）之后添加：

```tsx
const [editingField, setEditingField] = useState<"name" | "description" | null>(null);
const [draftValue, setDraftValue] = useState("");
```

- [ ] **Step 3: 添加 `updateProject` mutation**

在编辑状态之后添加：

```tsx
const updateProjectMutation = useMutation({
  mutationFn: (body: { name?: string; description?: string }) =>
    apiFetch(`/projects/${projectId}`, {
      method: "PATCH",
      body,
    }),
  onSuccess: async () => {
    setEditingField(null);
    setFeedback({ message: t("projectWorkspace.overview.updateSuccess"), error: null });
    await queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
  },
  onError: (error) => setFeedback({ message: null, error: formatApiError(error, t, "projectWorkspace.overview.updateFailed") }),
});
```

- [ ] **Step 4: 添加 `startEdit`、`saveEdit`、`cancelEdit` 回调**

在 mutation 之后添加：

```tsx
const startEdit = useCallback((field: "name" | "description") => {
  setDraftValue(field === "name" ? (project?.name ?? "") : (project?.description ?? ""));
  setEditingField(field);
}, [project?.name, project?.description]);

const saveEdit = useCallback(() => {
  const trimmed = draftValue.trim();
  if (editingField === "name") {
    if (!trimmed) return;
    if (trimmed === (project?.name ?? "").trim()) {
      setEditingField(null);
      return;
    }
    updateProjectMutation.mutate({ name: trimmed });
  } else if (editingField === "description") {
    if (trimmed === (project?.description ?? "").trim()) {
      setEditingField(null);
      return;
    }
    updateProjectMutation.mutate({ description: trimmed });
  }
}, [draftValue, editingField, project?.name, project?.description, updateProjectMutation]);

const cancelEdit = useCallback(() => {
  setEditingField(null);
}, []);
```

- [ ] **Step 5: 运行 lint 确认类型正确**

Run: `cd d:/Project/DramaFlow && npm --workspace @dramaflow/web run lint`
Expected: 无类型错误（注意：此时 mutation 被定义但未在 JSX 中使用，lint 不会因此失败）

- [ ] **Step 6: 提交**

```bash
git add apps/web/components/project-workspace/project-info-panel.tsx
git commit -m "feat(web): add inline-edit state and mutation for project name/description"
```

---

### Task 3: 更新 JSX 渲染编辑交互

**Files:**
- Modify: `apps/web/components/project-workspace/project-info-panel.tsx`（约 L127-131）

- [ ] **Step 1: 替换名称和简介的静态渲染为条件编辑 UI**

将 L128-131 的：

```tsx
<span className="kicker">{t("projectWorkspace.overview.kicker")}</span>
<h2 className="pip-title">{project?.name ?? t("common.loading")}</h2>
<p className="pip-desc">{project?.description || t("projectWorkspace.overview.noDescription")}</p>
```

替换为：

```tsx
<span className="kicker">{t("projectWorkspace.overview.kicker")}</span>
{editingField === "name" ? (
  <div>
    <input
      className="pip-edit-input"
      value={draftValue}
      onChange={(e) => setDraftValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); saveEdit(); }
        if (e.key === "Escape") cancelEdit();
      }}
      autoFocus
    />
    <div className="pip-edit-actions">
      <button
        className="btn btn-primary"
                        type="button"
        onClick={saveEdit}
        disabled={updateProjectMutation.isPending || !draftValue.trim()}
      >
        {updateProjectMutation.isPending ? t("common.submitting") : t("common.save")}
      </button>
      <button className="btn" type="button" onClick={cancelEdit}>
        {t("common.cancel")}
      </button>
    </div>
  </div>
) : (
  <div className="pip-editable-field" style={{ margin: "var(--space-2) 0 var(--space-1)" }}>
    <h2 className="pip-title">{project?.name ?? t("common.loading")}</h2>
    <button
      className="pip-edit-btn"
      type="button"
      onClick={() => startEdit("name")}
      aria-label={t("projectWorkspace.overview.editName")}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      {t("common.edit")}
    </button>
  </div>
)}
{editingField === "description" ? (
  <div>
    <textarea
      className="pip-edit-textarea"
      value={draftValue}
      onChange={(e) => setDraftValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(); }
        if (e.key === "Escape") cancelEdit();
      }}
      autoFocus
    />
    <div className="pip-edit-actions">
      <button
        className="btn btn-primary"
        type="button"
        onClick={saveEdit}
        disabled={updateProjectMutation.isPending}
      >
        {updateProjectMutation.isPending ? t("common.submitting") : t("common.save")}
      </button>
      <button className="btn" type="button" onClick={cancelEdit}>
        {t("common.cancel")}
      </button>
      <span className="pip-edit-hint">Esc {t("common.cancel")} · Shift+Enter ↵</span>
    </div>
  </div>
) : (
  <div className="pip-editable-field">
    <p className="pip-desc">{project?.description || t("projectWorkspace.overview.noDescription")}</p>
    <button
      className="pip-edit-btn"
      type="button"
      onClick={() => startEdit("description")}
      aria-label={t("projectWorkspace.overview.editDescription")}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      {t("common.edit")}
    </button>
  </div>
)}
```

- [ ] **Step 2: 运行 lint 确认类型正确**

Run: `cd d:/Project/DramaFlow && npm --workspace @dramaflow/web run lint`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add apps/web/components/project-workspace/project-info-panel.tsx
git commit -m "feat(web): wire up inline-edit JSX for project name and description"
```

---

### Task 4: 添加 i18n 翻译键

**Files:**
- Modify: `apps/web/lib/i18n.ts` 或对应翻译文件

- [ ] **Step 1: 找到 i18n 翻译文件并添加缺失的键**

搜索包含 `"projectWorkspace.overview"` 的文件，添加以下键（如果不存在）：

- `projectWorkspace.overview.updateSuccess` — 值：`"项目信息已更新"`
- `projectWorkspace.overview.updateFailed` — 值：`"更新项目信息失败"`
- `projectWorkspace.overview.editName` — 值：`"编辑项目名称"`
- `projectWorkspace.overview.editDescription` — 值：`"编辑项目简介"`

同时确认 `common.edit` 和 `common.save` 键已存在。如果不存在，也需要添加。

- [ ] **Step 2: 运行 lint 确认**

Run: `cd d:/Project/DramaFlow && npm --workspace @dramaflow/web run lint`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add apps/web/lib/i18n.ts
git commit -m "feat(web): add i18n keys for inline project editing"
```

---

### Task 5: 手动验证

- [ ] **Step 1: 启动开发服务器**

Run: `cd d:/Project/DramaFlow && npm run dev:web`

- [ ] **Step 2: 在浏览器中验证以下场景**

1. 打开项目信息面板，悬停名称 → 显示编辑按钮和虚线边框
2. 悬停简介 → 显示编辑按钮和虚线边框
3. 点击名称的编辑按钮 → 切换为 input，自动聚焦
4. 修改名称，按 Enter → 保存成功，显示成功提示
5. 按 Esc → 取消编辑，恢复原值
6. 不修改直接保存 → 不发请求，直接退出编辑
7. 清空名称 → 保存按钮禁用
8. 简介同理测试 textarea + Shift+Enter 换行
