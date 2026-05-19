# 项目名称和简介内联编辑

## 概述

在项目信息面板（ProjectInfoPanel）中为项目名称和简介添加内联编辑功能。用户悬停时显示编辑按钮，点击后进入编辑模式，修改后保存到后端。

## 范围

- **可编辑字段**：项目名称（name）、项目简介（description）
- **不涉及**：类型（genre）、封面图（coverUrl）、状态（status）、审核策略等其他字段
- **涉及文件**：`apps/web/components/project-workspace/project-info-panel.tsx`

## 后端依赖

已有的 `PATCH /projects/:id` 端点支持 `{ name?, description? }`，无需后端改动。

## 交互设计

### 触发方式

- 悬停名称或简介区域 → 显示虚线边框 + 编辑按钮（铅笔图标 + "编辑"文字）
- 名称和简介各自独立触发，互不影响

### 编辑模式

点击编辑按钮后：

- 文本切换为对应的输入框（名称 → `<input>`，简介 → `<textarea>`）
- 输入框自动聚焦并选中当前文本
- 显示「保存」和「取消」按钮

### 保存与取消

| 操作 | 结果 |
|------|------|
| 点击「保存」 | trim 后调用 `PATCH /projects/:id` |
| 按 Enter | 保存（在 textarea 中 Shift+Enter 换行） |
| 点击「取消」 | 恢复原值，退出编辑 |
| 按 Esc | 恢复原值，退出编辑 |

### 校验

- 名称不能为空：trim 后为空时禁用保存按钮
- 简介可以为空
- 值未改变时不触发 API 请求，直接退出编辑

### 反馈

- 保存中：保存按钮显示 loading 状态并禁用
- 成功：使用现有 InlineFeedback 组件显示成功提示
- 失败：使用现有 InlineFeedback 组件显示错误信息
- 保存成功后 invalidate 项目 query 以刷新数据

## 技术实现

### 状态管理

在 `ProjectInfoPanel` 组件内新增局部状态：

```
editingField: 'name' | 'description' | null
draftName: string
draftDescription: string
hoveredField: 'name' | 'description' | null
```

### Mutation

新增一个 `useMutation`，调用 `PATCH /projects/:id`，body 为 `{ name: draftName.trim() }` 或 `{ description: draftDescription.trim() }`（只发送被编辑的字段）。

### CSS 样式

在 `globals.css` 中新增 `.pip-editable-*` 系列样式：

- `.pip-editable-field` — 悬停容器，控制编辑按钮和虚线边框的显示
- `.pip-edit-btn` — 编辑按钮样式（半透明背景，indigo 色调）
- `.pip-edit-input` / `.pip-edit-textarea` — 输入框样式（indigo 边框 + focus ring）
- `.pip-edit-actions` — 保存/取消按钮行

### 权限

使用当前 `ProjectInfoPanel` 已有的 projectId 和 payload，后续可根据用户角色决定是否显示编辑按钮（本次不涉及角色判断，所有有权限访问面板的用户均可编辑）。
