# Video Reference Modes and Provider Adapters

**Date:** 2026-05-24
**Status:** Awaiting review

## Context

DramaFlow 当前视频生成只支持一个 `referenceImageAssetId`。前端单镜头视频生成会默认传当前镜头已采纳图片，批量视频不传参考图；后端只把该资产解析为一个 `referenceImageUrl`，再交给 Grok 或 OpenAI-compatible 路径处理。

AI 火宝的生成链路更强调短剧生产：视频生成支持单参考图、首尾帧、多参考图，并且为 MiniMax、火山 / Seedance、Vidu、阿里等厂商分别做 adapter。DramaFlow 应参考这种 adapter 思路，但不能复制 AI 火宝的 SQLite 写库方式；实现需要继续走现有 `ProviderEntry -> JobsService -> MediaContent` 链路。

## Goals

- 将视频参考图从单图字段升级为明确的参考模式。
- 新增 `minimax`、`volcengine`、`vidu`、`ali` 视频 Provider 类型。
- 为新增厂商建立后端视频 adapter 层，参考 AI 火宝的字段映射、轮询和状态归一化方式。
- 保持旧调用兼容：只传 `referenceImageAssetId` 时自动视为 `single`。
- 批量视频生成默认使用每个镜头当前已采纳图片；无图片时自动降级为纯文生视频。

## Non-Goals

- 不做 Vidu Webhook 回调。Vidu 本次只走 create + query / poll；如果没有查询端点，任务保持 running 并写入 note。
- 不做宫格图生成、切分和分配。
- 不做单镜头 FFmpeg 合成。
- 不引入新的队列框架。
- 不把运行时数据层迁移到 Prisma。

## Contract Changes

新增共享类型：

```typescript
export type VideoReferenceMode = "none" | "single" | "first_last" | "multiple";
```

扩展 `GenerateMediaInput`：

```typescript
export interface GenerateMediaInput {
  shotId: string;
  style: string;
  aspectRatio: string;
  durationSeconds?: number;
  referenceImageAssetId?: string;
  providerId?: string;
  videoReferenceMode?: VideoReferenceMode;
  firstFrameAssetId?: string;
  lastFrameAssetId?: string;
  referenceImageAssetIds?: string[];
}
```

扩展视频任务请求体，使 `POST /shots/:id/video-jobs` 和 `POST /projects/:id/batch-video-jobs` 能传入相同参考模式字段。

扩展视频 Provider 类型：

```typescript
export type VideoGenerationProvider =
  | "grok"
  | "openai-compatible"
  | "minimax"
  | "volcengine"
  | "vidu"
  | "ali";
```

兼容规则：

- 有 `referenceImageAssetId` 且没有 `videoReferenceMode`：按 `single` 处理。
- 没有任何参考图字段且没有 `videoReferenceMode`：按 `none` 处理。
- `multiple` 最多使用 6 张参考图；超过的资产 ID 在后端截断到前 6 张。

## Backend Architecture

新增视频 adapter 目录：

```text
apps/api/src/jobs/video-providers/
  types.ts
  registry.ts
  minimax-video.provider.ts
  volcengine-video.provider.ts
  vidu-video.provider.ts
  ali-video.provider.ts
```

统一接口：

```typescript
export interface VideoProviderAdapter {
  provider: VideoGenerationProvider;
  createJob(input: VideoProviderCreateInput): Promise<VideoProviderJobState>;
  pollJob?(
    providerVideoId: string,
    input: VideoProviderPollInput,
  ): Promise<VideoProviderJobState>;
}
```

统一内部参考图结构：

```typescript
export interface ResolvedVideoReferences {
  mode: VideoReferenceMode;
  imageUrl?: string;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  referenceImageUrls: string[];
}
```

`JobsService` 保持任务编排权威：

- 解析用户或团队的 `ProviderEntry`。
- 校验 `apiKey`、`baseUrl`、`model`。
- 将 asset ID 解析为可访问 URL。
- 组装 `ResolvedVideoReferences`。
- 调用 `video-providers/registry.ts` 获取 adapter。
- 将 adapter 状态归一化为现有 `VideoJobState`。
- 复用 `finalizeMediaJob` 保存视频文档版本和资产。

Grok 和 OpenAI-compatible 继续保留现有 provider 类，但接入统一参考图解析层，避免 `JobsService` 内出现两套参考图逻辑。

## Provider Mapping

### MiniMax

参考 AI 火宝的 MiniMax adapter。支持 `single` 和可行的首尾帧输入；如果当前配置或模型不支持 `multiple`，返回明确错误。

### VolcEngine / Seedance

Provider 名称使用 `volcengine`，用于承载火山和 Seedance 风格接口。支持 `single`、`first_last`、`multiple` 的字段映射，具体字段参考 AI 火宝 adapter 的请求构建方式，并保持 `baseUrl` 可配置。

### Vidu

支持 create + query / poll。若配置中没有可用查询路径或 adapter 无法构造 poll 请求，返回 `running` 状态并写入 note：

```text
Provider is waiting for callback; webhook is not enabled in this build.
```

本次不新增公开 webhook endpoint。

### Ali

按阿里视频生成接口映射可用字段。若某个模型不支持 `first_last` 或 `multiple`，adapter 返回 `BadRequestException` 风格的错误信息，不静默伪装成功。

### OpenAI-Compatible

继续走现有异步 `/videos` 路径，同时扩展请求体：

```typescript
{
  reference_mode?: VideoReferenceMode;
  image_url?: string;
  first_frame_url?: string;
  last_frame_url?: string;
  reference_image_urls?: string[];
}
```

### Grok

`single` 使用现有 image URL content。`first_last` 和 `multiple` 使用多个 `image_url` content part，并在 prompt 中标注 `first frame`、`last frame`、`reference image N`。

## Frontend Design

在 `ShotDetailModal` 的视频生成区域增加参考模式选择：

- `无参考` -> `none`
- `当前图片` -> `single`
- `首帧 + 尾帧` -> `first_last`
- `多参考图` -> `multiple`

默认行为：

- 当前镜头有已采纳图片时，默认 `当前图片`。
- 当前镜头没有已采纳图片时，默认 `无参考`。
- 首帧默认当前已采纳图片。
- 尾帧和多参考图从该镜头图片候选中选择。
- 多参考图最多选择 6 张。

Provider 配置 UI：

- `ProviderEntryForm` 的视频 Provider 下拉新增 MiniMax、VolcEngine / Seedance、Vidu、Ali。
- 本次只使用现有 `apiKey`、`baseUrl`、`model` 字段，不新增厂商高级参数表单。

批量视频：

- 默认 `single`。
- 每个镜头有当前已采纳图片时传 `referenceImageAssetId`。
- 没有当前已采纳图片时传 `videoReferenceMode: "none"`。
- 单个镜头失败不阻塞批次中其他任务，继续复用现有 batch job 机制。

## Error Handling

- 参考模式与厂商不兼容：创建或处理任务时返回明确错误。
- 缺少 `apiKey`、`baseUrl`、`model`：沿用现有 Provider 校验风格。
- asset ID 无法解析：该任务失败，错误说明具体缺失的参考图字段。
- 厂商任务未完成：job 保持 `running`，写入 `providerVideoId`、`providerStatus`、`progress`。
- 厂商任务失败：抛出带厂商错误摘要的异常，由现有 retry / failed 流程处理。
- Vidu 无 query 能力：保持 `running`，写入 note，不伪造完成。

## Testing

测试不依赖真实厂商 API。新增或扩展包内 TS 测试脚本，覆盖：

- 旧 `referenceImageAssetId` 自动识别为 `single`。
- `none`、`single`、`first_last`、`multiple` 四种模式进入 job input 和最终 `parameters`。
- asset ID 到 URL 的解析和最多 6 张多参考图截断。
- MiniMax、VolcEngine、Vidu、Ali adapter 的请求体构造。
- adapter 状态归一化：queued、running、completed、failed。
- 不支持模式时返回明确错误。
- Vidu 无 query endpoint 时保持 running + note。
- 前端 Provider 列表包含新增视频厂商。

收尾验证：

```bash
npm run lint
npm test
npm run build
```

## Implementation Order

1. 更新 shared 类型和 API contract。
2. 新增后端视频 adapter 类型、registry 和厂商 adapter。
3. 改造 `JobsService` 的视频参考图解析和 Provider 调用。
4. 改造 Grok / OpenAI-compatible 视频路径以使用统一参考图结构。
5. 更新前端 Provider 配置和单镜头视频参考模式 UI。
6. 更新批量视频生成，让每个镜头默认使用当前图或降级到 `none`。
7. 补测试并运行验证命令。

## Acceptance Criteria

- 旧单参考图调用不破坏。
- 单镜头视频生成支持 `none`、`single`、`first_last`、`multiple`。
- 批量视频能按镜头自动选择 `single` 或 `none`。
- 新增视频厂商能在个人和团队 Provider 配置中选择。
- 后端新增厂商 adapter 不把厂商逻辑继续堆进 `JobsService`。
- Vidu 不新增 webhook，但等待回调状态可被清楚识别。
- `npm run lint`、`npm test`、`npm run build` 通过，或记录无法通过的具体原因。
