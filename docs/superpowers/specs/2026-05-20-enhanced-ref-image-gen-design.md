# Enhanced Character Reference Image Generation v2

**Date:** 2026-05-20
**Status:** Approved
**Supersedes:** `2026-04-11-character-reference-image-generation-design.md`

## Context

v1 的角色参考图生成已上线（单次生成 → 预览 → 接受），但交互简陋：
- 只用 `appearance` 一个字段构建 prompt，未融合 style guide、costumes、personality
- 不支持多张候选图对比
- 不支持基于已有图片迭代优化（图生图）
- 没有 prompt 增强能力
- Dialog 窄（480px），内容多时拥挤

## Scope

- 改造现有 World Bible 参考图生成对话框为增强型双面板弹窗
- 新增 LLM prompt 增强接口
- 改造现有生成接口支持图生图和批量
- 角色（Character）、场景（Location）、风格指南（StyleGuide）均适用
- 后端不做队列改造，前端编排多请求并行

## Architecture

### 方案：前端编排 + 逐张流式返回

后端提供原子操作，前端编排工作流。后端对每张图独立响应，前端逐张展示。

### 1. API 层

#### 1.1 新增：Prompt 增强

```
POST /projects/:projectId/world-bible/enhance-reference-prompt
```

**请求体：**
```typescript
{
  prompt: string;
  type: "character" | "location" | "styleGuide";
  configSource?: "team" | "personal";  // LLM 配置来源
  providerId?: string;                  // LLM provider ID
}
```

**响应：**
```typescript
{
  enhancedPrompt: string;
  originalPrompt: string;
}
```

`type` 字段决定 LLM 的 system prompt 方向：character 侧重人物外貌/服装/表情，location 侧重场景/光影/氛围，styleGuide 侧重整体画风/色调。

#### 1.2 改造：现有生成接口

三个端点统一改造：
- `POST /projects/:projectId/world-bible/characters/:characterId/generate-reference-image`
- `POST /projects/:projectId/world-bible/locations/:locationId/generate-reference-image`
- `POST /projects/:projectId/world-bible/style-guide/generate-reference-image`

**请求体扩展：**
```typescript
{
  prompt: string;
  configSource?: "team" | "personal";
  providerId?: string;
  referenceImageAssetId?: string;   // 新增：有值走图生图
  negativePrompt?: string;          // 新增：负面 prompt
}
```

**响应扩展：**
```typescript
{
  assetUrl: string;
  assetId: string;    // 新增：用于后续图生图引用
  prompt: string;     // 新增：回传实际使用的 prompt
}
```

### 2. Prompt 构建（前端）

`buildCharacterReferencePrompt` 扩展，拼接：
- `character.appearance`（核心）
- `character.costumes` 当前 costume（如有）
- `character.personality`（辅助风格）
- 项目 `styleGuide.visualStyle` + `styleGuide.colorPalette`

仅当 prompt 框为空时自动填充。用户可随时手动编辑，或点击「AI 增强」调 LLM 重写。

Location 和 StyleGuide 的 prompt 构建同理扩展。

### 3. 前端状态机

```
idle → editing → enhancing → generating → reviewing → iterating → accepted
                ↘ generating ↗                ↗
```

| 状态 | 说明 |
|------|------|
| **idle** | Dialog 未打开 |
| **editing** | 编辑 prompt、选 provider、选生成数量（1-4）、上传参考图（可选）|
| **enhancing** | 调 LLM 增强 prompt，结果回填到 prompt 框（可选步骤）|
| **generating** | 并行发 N 个请求，逐张填入网格 |
| **reviewing** | 全部完成，网格展示。可使用/迭代/重新生成 |
| **iterating** | 基于选中图片做图生图，可编辑 prompt，回到 reviewing |
| **accepted** | 确认使用某张图，关闭 dialog |

- enhancing 可跳过，直接从 editing → generating
- 每轮生成保留在历史中（最近 3 轮），底部历史条可回看

### 4. UI 布局

**双面板增强型 Dialog，960px 宽。**

- **左面板**（380px）：Prompt 编辑 + AI 增强按钮 + 可折叠负面 Prompt + 配置区（LLM 模型下拉 + 图片模型下拉，各自有团队/个人选择）+ 数量选择 + 参考图上传 + 迭代历史条
- **右面板**（flex）：2x2 图片网格。每张图有「使用」和「迭代」按钮。选中项 cyan 高亮 + check 标记。加载中用 skeleton shimmer，排队中灰色。空状态显示引导文案
- **底部 Footer**：取消 / 重新生成 / 生成（或「使用选中」）

**设计系统匹配：**
- Accent: `#38bdf8` (sky cyan) + glow
- 背景: `#09090b` → `#18181b` → `#27272a` 三层
- Dialog: `bg-elevated`, `radius-lg: 16px`, `shadow-md`
- 按钮: `.btn-primary` (cyan + glow), `.btn-secondary` (半透明 + blur)
- 输入框: `.input` 36px 高, `border-default`, focus = cyan glow
- 标签: `.wb-form__label` 12px / 500 / `text-secondary`
- 所有图标使用 SVG（Lucide 风格），不用 emoji

### 5. 图生图（img2img）后端

Provider 适配策略：

| Provider | 图生图 | 实现方式 |
|----------|--------|----------|
| Google Gemini | ✅ | `inline_data` 传入参考图 |
| Stable Diffusion WebUI | ✅ | `/sdapi/v1/img2img` |
| ComfyUI | ✅ | workflow 接 img input 节点 |
| OpenAI Compatible | 降级 | 参考图描述拼入 prompt |
| Grok | 降级 | 参考图描述拼入 prompt |

`generateImageFromPrompt` 新增 `referenceImageAssetId` 参数。解析 provider 类型，能图生图的走原生路径，不能的降级为文字描述参考。

前端两个图生图场景：
1. **基于候选图迭代** — 选中一张生成的图，点「迭代」，该图作为 referenceImage
2. **上传外部参考图** — 上传一张图片作为风格/构图参考

### 6. 错误处理

- 无可用 Provider 时，生成按钮 disabled 并提示
- 单张生成失败时，该格显示错误状态（红色边框 + 重试按钮），不影响其他图
- 全部失败时，显示错误汇总 + 重试按钮
- LLM 增强失败时，回退到原始 prompt，显示 toast 提示
- 超时：单张 60s，超时标记该格失败

## Files to Modify

| File | Change |
|------|--------|
| `apps/api/src/jobs/jobs.controller.ts` | 新增 `enhanceReferencePrompt` 端点 |
| `apps/api/src/jobs/jobs.service.ts` | 新增 `enhanceReferencePrompt()` 方法；改造 `generateImageFromPrompt()` 支持 img2img 和 negativePrompt |
| `apps/api/src/jobs/google-gemini-image.provider.ts` | 支持 referenceImage 输入 |
| `apps/api/src/jobs/sd-webui-image.provider.ts` | 新增 img2img 路径 |
| `apps/api/src/jobs/comfyui-image.provider.ts` | 支持 referenceImage workflow 节点 |
| `packages/shared/src/api-contracts.ts` | 新增 `EnhanceReferencePromptRequest/Response`；扩展 `WorldBibleReferenceImageGenerateRequest/Response` |
| `packages/shared/src/domain.ts` | 无变更（现有类型够用）|
| `apps/web/components/project-workspace/world-bible-reference-image-dialog.tsx` | 完全重写为双面板增强型 Dialog |
| `apps/web/components/project-workspace/world-bible-editor.tsx` | 扩展 `buildCharacterReferencePrompt` / `buildLocationReferencePrompt` / `buildStyleGuideReferencePrompt` |

## Verification

1. 启动 API 和 Web 服务
2. 进入 World Bible → 编辑角色
3. 验证 prompt 框空时自动填充（融合 appearance + costumes + style guide）
4. 点击「AI 增强」，验证 LLM 重写 prompt
5. 选择生成数量 4，点击生成
6. 验证逐张填充、skeleton loading、排队状态
7. 全部完成后，选中一张，验证 cyan 高亮
8. 点击「迭代」，验证参考图传入、新一批生成
9. 验证历史条显示两轮，点击可回看
10. 点击「使用」，验证图片存入 referenceImages
11. 测试上传外部参考图 + 生成
12. 测试无 Provider 时按钮 disabled
13. 测试单张失败时的错误状态
14. Location 和 StyleGuide 同理验证
