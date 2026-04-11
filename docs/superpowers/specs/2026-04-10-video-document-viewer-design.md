# Video Document Viewer Design

## Context

DramaFlow 的文档工作区支持 `script` 和 `storyboard` 两种文档类型的查看与编辑，但 `DocumentType` 中定义的 `"video"` 类型没有对应的查看器。用户需要：
- 在文档模式下查看和管理视频
- 上传外部生成的视频文件
- 通过 AI 生成视频
- 将视频与对应分镜头对照查看

## Architecture

### Navigation

复用现有文档模式左侧版本列表。`project.documents` 中已有 `type: "video"` 的文档（AI 生成视频时自动创建）。用户选中 video 文档后，中心区域渲染 `VideoDocumentViewer` 替代 `VersionView`。

### Component Structure

```
unified-workspace.tsx (document mode, view sub-tab)
  ├─ VersionView           (script/storyboard 文档，现有逻辑不变)
  └─ VideoDocumentViewer   (video 文档，新增)
       ├─ ShotReferencePanel   (左侧：分镜头信息)
       └─ VideoPanel           (右侧：视频管理)
```

### Data Flow

1. 用户选中 video 文档 → workspace 传入 `document` + `project` 数据
2. `VideoDocumentViewer` 通过 `document.shotId` 从 storyboard content 查找 `StoryboardShot`
3. 通过 `document.currentVersionId` 找到当前采纳的视频版本
4. 通过 `versionsByDocument` 获取所有候选版本（含上传和 AI 生成的）

## Components

### VideoDocumentViewer

主组件，左右分屏布局。接收 props：`document`, `project`（含 documents, versions, jobs 等）。

- 左侧 40% 宽度：`ShotReferencePanel`
- 右侧 60% 宽度：`VideoPanel`

### ShotReferencePanel

从 storyboard content 中通过 `shotId` 查找 `StoryboardShot`，显示：

- 顶部：已采纳图片缩略图（如有）
- shotLabel + framing + cameraMove + durationSeconds
- visualDescription（主要文本）
- actionDescription
- dialogue
- soundDesign
- notes

无 shotId 或找不到对应 shot 时显示提示信息。

### VideoPanel

**播放器区域**（顶部，16:9）：
- 当前采纳视频 → `<video controls playsInline>`
- 无视频 → 空状态：上传图标 + 提示文字

**操作栏**（播放器下方）：
- "上传视频" 按钮 → `<input type="file" accept="video/*">`
- "生成视频" 按钮 → `POST /shots/{id}/video-jobs`
- 生成中显示进度条

**任务状态区**：
- 复用 `StatusDot` + 进度条模式
- 显示当前 video job 状态（queued/running/completed/failed）

**候选版本列表**（底部）：
- 所有版本按时间倒序排列
- 每项显示：缩略图、来源标签（"上传" / "AI - {model}"）、创建时间
- "采纳" / "已采纳" 按钮
- 点击候选 → 播放器切换预览该版本

### Upload Flow

1. 用户点击"上传视频" → 文件选择器打开
2. 选择文件 → `POST /uploads` 获取上传目标（presigned URL 或 direct key）
3. 上传文件 → `PUT` presigned URL 或 `PUT /uploads/direct/{key}`
4. 创建版本 → `POST /documents/{id}/versions`，content 格式：
   ```json
   {
     "assetId": "...",
     "assetUrl": "...",
     "mimeType": "video/mp4",
     "provider": "upload",
     "mode": "upload",
     "note": "用户上传",
     "prompt": ""
   }
   ```

## Files

### New Files

| File | Purpose |
|------|---------|
| `apps/web/components/project-workspace/video-document-viewer.tsx` | 主组件，左右分屏布局 |
| `apps/web/components/project-workspace/shot-reference-panel.tsx` | 左侧分镜头信息面板 |
| `apps/web/components/project-workspace/video-panel.tsx` | 右侧视频管理面板（播放/上传/生成/候选） |

### Modified Files

| File | Change |
|------|--------|
| `apps/web/components/unified-workspace.tsx` | document mode view sub-tab：新增 `selectedDoc.type === "video"` 条件渲染 `VideoDocumentViewer` |
| `apps/api/src/storage/storage.service.ts` | `getAssetBuffer()` 移除 `image/*` 限制，支持 `video/*` |

### Reused Patterns

- 视频播放：`<video controls>` 模式来自 media-canvas-panel.tsx
- 候选采纳：`adoptVersion` mutation 来自 shot-detail-drawer.tsx
- 任务状态：`StatusDot` 组件和 job 状态查询来自 shot-card.tsx
- Shot 状态计算：`ShotProjectState` 模式来自 storyboard-workbench.tsx
- 上传 API：`POST /uploads` 现有端点

## Verification

1. **基本查看**：项目含 storyboard + AI 生成视频 → 文档模式选中 video 文档 → 确认左右分屏正确展示分镜头信息和视频播放
2. **上传**：在 VideoDocumentViewer 上传外部视频 → 确认上传成功、版本创建、播放正常
3. **生成**：点击"生成视频" → 确认 job 创建、进度显示、生成完成后候选版本出现
4. **采纳**：采纳候选版本 → 确认切换成功、播放器更新
5. **无 shot 关联**：选中无 shotId 的 video 文档 → 确认左侧显示提示而非崩溃
