import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from "@nestjs/common";
import type { LlmModelSummary, LlmProviderConfig } from "@dramaflow/shared";

interface OpenAiCompatModelRecord {
  id?: string;
  created?: number;
  owned_by?: string;
}

interface OpenAiCompatModelListPayload {
  data?: OpenAiCompatModelRecord[];
}

@Injectable()
export class LlmProviderService {
  private readonly defaultBaseUrl = (process.env.OPENAI_COMPAT_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");

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