# 对话生成 UI/UX 优化设计

**日期**: 2026-05-23
**状态**: 待实施

## 问题

1. **输入框被推到视口下方** — 对话生成器嵌入 Workspace 中心列的滚动容器内，`conv-layout` 使用 `min-height: 500px` 但无视口高度约束，导致输入框需要滚动才能看到
2. **无历史会话** — `ConversationalGenerator` 只用 `useState` 管理状态，刷新或切换页面后会话丢失。后端已有 `GET/:sessionId` 和 `DELETE/:sessionId`，但前端从未列出或恢复历史会话

## 设计决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 整体布局 | 留在 Workspace 三栏中心列内 | 保持左侧文档列表可见，切换其他子标签即可退出对话 |
| 输入框定位 | 使用视口高度计算让聊天区填满剩余空间 | 输入框自然固定在聊天区底部，无需滚动 |
| 历史会话放置 | gen-mode-bar 右侧下拉浮层 | 不占用布局空间，按项目隔离，会话数量可控 |
| Brief 面板 | 只显示已有内容的字段，空的隐藏 | 空字段无信息量且浪费空间，逐步显现提供进度感 |
| Brief 面板宽度 | 从 380px 缩减到 320px | 聊天区获得更多空间（~560px vs ~500px） |

## 实施细节

### 1. 布局修复：输入框固定底部

**当前问题**: `.conv-root` 在 `.uw-center-scroll`（`overflow-y: auto`）内使用 `min-height: 500px`，没有视口高度约束。

**改动**:

- `.conv-root` — 添加 `height: calc(100vh - <顶部元素高度>)` 使其占满视口剩余空间。具体偏移量需要计算：顶部导航栏 + mode 栏 + 子标签栏 + gen-mode-bar + padding。实际实现中可以通过 CSS 变量或 `flex: 1; min-height: 0` 在 flex 容器内实现
- `.uw-center` 在 `mode === "document" && docSubTab === "generate"` 时，改为 `display: flex; flex-direction: column; overflow: hidden`（而非 `overflow-y: auto`），让 `conv-root` 通过 flex 撑满
- `.conv-layout` — `height: 100%` 替代 `min-height: 500px`
- `.conv-chat` — 保持 `height: 100%; display: flex; flex-direction: column` 不变
- `.conv-chat__messages` — 保持 `flex: 1; overflow-y: auto`（消息多了自动滚动）
- `.conv-chat__input-bar` — 自然固定在底部（flex 末尾元素）
- `.conv-layout__brief` — 宽度从 `380px` 改为 `320px`

**涉及文件**:
- `apps/web/app/globals.css` — `.conv-root`, `.conv-layout`, `.conv-chat`, `.conv-layout__brief` 样式
- `apps/web/components/unified-workspace.tsx` — `uw-center-scroll` 在 generate 子标签时的样式调整

### 2. 会话历史

#### 2.1 API 端点

新增 `GET /projects/:id/conversation-jobs` 端点，返回当前项目的所有会话列表。

**响应格式**:
```typescript
interface ConversationSessionSummary {
  id: string;
  firstUserMessage: string;    // 第一条用户消息（前 20 字），用作会话标题
  messageCount: number;        // 消息总数
  dimensionStatus: Record<ConversationDimension, ConversationDimensionStatus>;
  targetDocType: "synopsis" | "script";
  createdAt: string;
  updatedAt: string;
}
```

**涉及文件**:
- `packages/shared/src/api-contracts.ts` — 新增 `ConversationSessionListResponse` 类型
- `apps/api/src/jobs/jobs.controller.ts` — 新增 `GET` 端点
- `apps/api/src/jobs/conversation.service.ts` — 新增 `listSessions(projectId)` 方法

#### 2.2 前端组件

在 `gen-mode-bar` 右侧添加"历史会话"按钮 + 下拉浮层。

**下拉内容**:
- 每个会话项显示：标题（firstUserMessage）、消息数、相对时间、维度进度标签
- 当前活跃会话高亮
- 底部"开始新会话"按钮
- 每个会话项右侧有删除图标

**交互**:
- 点击会话 → 调用 `GET /:sessionId` 恢复 messages/brief/dimensionStatus 到界面
- 点击"新会话" → 清空当前状态，创建新会话
- 点击删除 → 调用 `DELETE /:sessionId`，从列表移除

**涉及文件**:
- `apps/web/components/project-workspace/generation/conversation-history.tsx` — 新建，历史会话下拉组件
- `apps/web/components/project-workspace/generation/conversational-generator.tsx` — 集成历史组件，添加会话加载/切换逻辑
- `apps/web/components/project-workspace/generation/generator-host.tsx` — 在 mode-bar 中添加历史按钮
- `apps/web/app/globals.css` — 下拉浮层样式

### 3. Brief 面板优化

**当前问题**: 6 个 textarea 始终全部展开，空的也占 48px min-height，总计 ~400px+。

**改动**:
- 只渲染 `brief[key]` 非空的字段为可编辑 textarea
- 空字段不渲染 textarea，仅在 DimensionTracker 中以 pending 标签呈现
- 用户点击 pending 维度标签时，可展开一个内联 textarea 手动输入（或引导 AI 讨论该维度）
- Brief 面板初始高度降至 ~80px（只有 DimensionTracker + 生成按钮），随对话进展动态增长

**涉及文件**:
- `apps/web/components/project-workspace/conversation-brief.tsx` — 条件渲染 Brief 字段
- `apps/web/app/globals.css` — Brief 相关样式微调

## 响应式

- `@media (max-width: 900px)`: 单栏布局，Brief 面板移到聊天区下方，可折叠
- `@media (max-width: 768px)`: 保持单栏，Brief 默认折叠，点击展开

## 不在范围内

- 会话重命名（使用第一条用户消息作为标题即可）
- 会话搜索/过滤（每个项目会话数量有限，不需要）
- 会话导出
- Brief 字段的富文本编辑
