# 世界观编辑器重新设计

## Context

当前世界观编辑器使用 TipTap 富文本编辑器，通过自定义 Node 类型（characterBlock、locationBlock、styleGuideBlock、voiceConfigBlock）来管理角色、场景、风格和语音配置。存在两个核心问题：

1. **工具栏按钮文字溢出**：基础 `.tiptap-toolbar__btn` 固定 `width: 28px; height: 28px`，WB 按钮覆盖了 `width: auto` 但 `height` 和 `justify-content: center` 仍冲突，导致文字被截断
2. **工具栏与编辑区风格割裂**：工具栏看起来和编辑器内容是两个独立模块拼接，缺乏整体感

用户决定从布局层面重新设计世界观页面，放弃 TipTap 方案，改为分类列表式 + 结构化表单的方式。

## 方案：Tab 切换 + 卡片列表 + 侧边表单

### 整体布局

页面分为 3 个区域：

```
┌─────────────────────────────────────────────────┐
│  Header: 版本标题 + 保存/取消按钮                    │
├─────────────────────────────────────────────────┤
│  Tabs: [角色(3)] [场景(2)] [风格指南] [语音配置(2)]  │
├──────────────────┬──────────────────────────────┤
│  左侧: 实体列表    │  右侧: 编辑表单                   │
│  (55%)           │  (45%)                       │
└──────────────────┴──────────────────────────────┘
```

- **Header**：复用现有 se-header 样式，版本标题输入框 + 保存/取消按钮
- **Tabs**：紧贴 Header 下方，4 个 Tab 带 count badge，选中态 indigo 高亮
- **左侧**：当前 Tab 分类的实体卡片列表，顶部有「+ 添加」按钮
- **右侧**：选中实体的完整结构化编辑表单；无选中时显示空状态提示
- **风格指南 Tab** 特殊：只有一份，直接全宽展示表单，无左右分栏

### 角色 Tab

**卡片列表项：**
- 左侧：人物图标（圆形占位）
- 中间：角色名称 + 标签（最多 3 个，溢出 `+N`）
- 右侧：删除按钮（hover 显示）
- 选中态：左边框 indigo 高亮

**编辑表单字段：**

| 字段 | 控件 | 必填 |
|------|------|------|
| 名称 | 文本输入 | 是 |
| 外貌描述 | 多行文本框 | 是 |
| 性格特征 | 多行文本框 | 否 |
| 标签 | 标签输入（回车添加，× 删除） | 否 |
| 参考图 | 图片上传区域（多张，缩略图网格） | 否 |
| 服装设定 | 键值对列表（场景名 → 服装描述） | 否 |

### 场景 Tab

**卡片列表项：**
- 左侧：位置图标
- 中间：场景名称 + 描述截断（20 字）
- 右侧：时间段标签

**编辑表单字段：**

| 字段 | 控件 | 必填 |
|------|------|------|
| 名称 | 文本输入 | 是 |
| 描述 | 多行文本框 | 是 |
| 光照 | 文本输入 | 否 |
| 时间段 | 下拉选择（白天/黄昏/夜晚/清晨/不限） | 否 |
| 参考图 | 图片上传区域 | 否 |

### 风格指南 Tab

- 无列表，直接全宽展示编辑表单
- 顶部显示「风格指南」标题 + 说明文字

**编辑表单字段：**

| 字段 | 控件 | 必填 |
|------|------|------|
| 视觉风格 | 多行文本框 | 是 |
| 色彩方案 | 文本输入 | 否 |
| 构图说明 | 多行文本框 | 否 |
| 反向提示词 | 多行文本框 | 否 |
| 参考图 | 图片上传区域 | 否 |

### 语音配置 Tab

**卡片列表项：**
- 显示：角色名（关联 characterId）+ 语音名称
- 副标题：TTS 提供商 + 语速

**编辑表单字段：**

| 字段 | 控件 | 必填 |
|------|------|------|
| 角色 | 下拉选择（从角色列表中选） | 是 |
| TTS 提供商 | 文本输入 | 是 |
| 语音 ID | 文本输入 | 是 |
| 语音名称 | 文本输入 | 否 |
| 语速 | 滑块 0.5–2.0 | 否 |
| 情感 | 文本输入 | 否 |
| 音量 | 滑块 0–100 | 否 |

**空状态**：未创建角色时显示"请先在角色 Tab 中添加角色"。

### 技术实现

1. **移除 TipTap 依赖**：世界观编辑器不再使用 TipTap，可删除 4 个自定义扩展（character-block.ts、location-block.ts、style-guide-block.ts、voice-config-block.ts）和对应的 NodeView 组件、world-bible converter
2. **数据格式不变**：底层仍是 `WorldBibleContent`（characters/locations/styleGuide/voiceConfigs），只改 UI 层，保存逻辑不变
3. **状态管理**：React useState 管理 activeTab 和 selectedEntityId，表单修改直接更新 state，保存时整体提交 WorldBibleContent
4. **图片上传**：复用现有 reference-image-uploader 组件的逻辑，在表单内使用
5. **CSS 变量**：复用项目已有的 design token（--space-*、--border-*、--radius-*、--text-*）

### 关键文件

**需要修改：**
- `apps/web/components/project-workspace/world-bible-editor.tsx` — 重写为 Tab + 列表 + 表单布局
- `apps/web/app/globals.css` — 新增 WB editor 样式，移除旧的 TipTap WB 样式

**可以复用：**
- `apps/web/components/project-workspace/tiptap/node-views/reference-image-uploader.tsx` — 图片上传逻辑
- `apps/web/components/project-workspace/tiptap/node-views/tag-input.tsx` — 标签输入组件

**可以删除：**
- `apps/web/components/project-workspace/tiptap/extensions/character-block.ts`
- `apps/web/components/project-workspace/tiptap/extensions/location-block.ts`
- `apps/web/components/project-workspace/tiptap/extensions/style-guide-block.ts`
- `apps/web/components/project-workspace/tiptap/extensions/voice-config-block.ts`
- `apps/web/components/project-workspace/tiptap/node-views/character-block-view.tsx`
- `apps/web/components/project-workspace/tiptap/node-views/location-block-view.tsx`
- `apps/web/components/project-workspace/tiptap/node-views/style-guide-block-view.tsx`
- `apps/web/components/project-workspace/tiptap/node-views/voice-config-block-view.tsx`
- `apps/web/components/project-workspace/tiptap/node-views/world-bible-detail-panel.tsx`
- `apps/web/components/project-workspace/tiptap/node-views/world-bible-context.tsx`
- `apps/web/components/project-workspace/tiptap/converters/world-bible.ts`

**数据模型不变（只读参考）：**
- `packages/shared/src/domain.ts` — WorldBibleContent 及各 Profile 类型
- `packages/shared/src/document-content.ts` — normalizeWorldBibleContent
