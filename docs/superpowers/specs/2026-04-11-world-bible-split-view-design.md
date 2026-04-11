# 世界观编辑器双栏布局设计

## Context

刚完成的 NodeView 结构化表单改造让每个块都可以内联展开编辑，但用户反馈编辑内容太割裂，缺乏全局概览。需要一个能同时看到所有实体概要的视图。

## 方案：摘要卡片 + 侧边详情面板

### 布局
- 双栏布局：左侧 ~55% TipTap 编辑器（摘要卡片列表），右侧 ~45% 详情编辑面板
- 左侧卡片只显示紧凑摘要信息，不内联展开
- 点击左侧卡片选中它，右侧面板显示完整编辑表单

### 摘要卡片
- 角色卡片：图标 + 名称 + 外貌（截断30字）+ 标签数量
- 场景卡片：图标 + 名称 + 描述（截断30字）+ 时间段
- 风格卡片：图标 + "风格指南" + 视觉风格（截断30字）
- 语音卡片：图标 + 角色名 + 语音名 + 语速
- 选中的卡片高亮显示

### 详情面板
- 显示当前选中块的完整表单
- 顶部显示类型标签 + 名称
- 无选中块时显示提示信息
- 表单修改通过 `updateAttributes()` 同步

### 实施步骤
1. 简化 4 个 NodeView 组件为只读摘要卡片（移除内联表单和展开/折叠）
2. 创建详情面板组件 `world-bible-detail-panel.tsx`
3. 修改 `world-bible-editor.tsx` 为双栏布局，添加选中状态跟踪
4. 更新 CSS 样式

### 关键文件
- `tiptap/node-views/character-block-view.tsx` — 简化为摘要卡片
- `tiptap/node-views/location-block-view.tsx` — 同上
- `tiptap/node-views/style-guide-block-view.tsx` — 同上
- `tiptap/node-views/voice-config-block-view.tsx` — 同上
- `tiptap/node-views/world-bible-detail-panel.tsx` — 新建详情面板
- `world-bible-editor.tsx` — 双栏布局
- `globals.css` — 样式更新
