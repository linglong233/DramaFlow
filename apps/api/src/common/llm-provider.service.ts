/**
 * @fileoverview LLM Provider 服务
 * @module api/common
 *
 * 提供 LLM 模型列表查询功能，通过 OpenAI 兼容接口获取可用模型。
 */

import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from "@nestjs/common";
import type { LlmModelSummary, LlmProviderConfig } from "@dramaflow/shared";

/** OpenAI 兼容接口的模型记录 */
interface OpenAiCompatModelRecord {
  id?: string;
  created?: number;
  owned_by?: string;
}

/** OpenAI 兼容接口的模型列表响应体 */
interface OpenAiCompatModelListPayload {
  data?: OpenAiCompatModelRecord[];
}

/** LLM Provider 服务，封装 OpenAI 兼容接口的模型查询 */
@Injectable()
export class LlmProviderService {
  private readonly defaultBaseUrl = (process.env.OPENAI_COMPAT_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");

  /**
   * 查询可用的 LLM 模型列表
   * @param config - 可选的 LLM 配置（指定自定义 Provider 地址和密钥）
   * @returns 按 ID 字母顺序排列的模型摘要列表
   */
  async listModels(config?: LlmProviderConfig): Promise<LlmModelSummary[]> {
    const provider = (config?.provider ?? "openai-completions").trim() || "openai-completions";
    if (provider !== "openai-completions") {
      throw new BadRequestException(`Unsupported LLM provider: ${provider}`);
    }

    const apiKey = config?.apiKey ?? process.env.OPENAI_COMPAT_API_KEY;
    if (!apiKey || apiKey === "replace-me") {
      throw new BadRequestException("LLM API key is required to fetch model list");
    }

    const baseUrl = (config?.baseUrl ?? this.defaultBaseUrl).trim().replace(/\/$/, "");
    if (!baseUrl) {
      throw new BadRequestException("LLM base URL is required to fetch model list");
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown model list error";
      throw new BadGatewayException(`LLM provider model list request failed: ${message}`);
    }

    const raw = await response.text();
    if (!response.ok) {
      throw new BadGatewayException(
        `LLM provider model list request failed with HTTP ${response.status}${raw ? `: ${raw}` : ""}`,
      );
    }

    let payload: OpenAiCompatModelListPayload;
    try {
      payload = raw ? JSON.parse(raw) as OpenAiCompatModelListPayload : {};
    } catch {
      throw new BadGatewayException("LLM provider model list response was not valid JSON");
    }

    if (!Array.isArray(payload.data)) {
      throw new BadGatewayException("LLM provider model list response did not include a data array");
    }

    const models = new Map<string, LlmModelSummary>();
    for (const item of payload.data) {
      const id = typeof item?.id === "string" ? item.id.trim() : "";
      if (!id) {
        continue;
      }

      models.set(id, {
        id,
        created: typeof item.created === "number" ? item.created : undefined,
        ownedBy: typeof item.owned_by === "string" ? item.owned_by : undefined,
      });
    }

    return [...models.values()].sort((left, right) => left.id.localeCompare(right.id));
  }
}