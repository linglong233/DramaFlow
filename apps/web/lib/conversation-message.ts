import type {
  ConversationBrief,
  ConversationDimension,
  ConversationDimensionStatus,
  ConversationMessage,
} from "@dramaflow/shared";

const DIMENSIONS: ConversationDimension[] = [
  "coreConflict",
  "protagonist",
  "supportingChars",
  "tone",
  "pacing",
  "constraints",
];

const DEFAULT_DIMENSION_STATUS: Record<ConversationDimension, ConversationDimensionStatus> = {
  coreConflict: "pending",
  protagonist: "pending",
  supportingChars: "pending",
  tone: "pending",
  pacing: "pending",
  constraints: "pending",
};

function normalizeBrief(value: unknown): ConversationBrief {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => DIMENSIONS.includes(key as ConversationDimension))
      .filter(([, item]) => typeof item === "string" && item.trim())
      .map(([key, item]) => [key, String(item).trim()]),
  ) as ConversationBrief;
}

function normalizeDimensionStatus(value: unknown): Record<ConversationDimension, ConversationDimensionStatus> {
  const result = { ...DEFAULT_DIMENSION_STATUS };
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const dimension of DIMENSIONS) {
    const status = (value as Record<string, unknown>)[dimension];
    if (status === "pending" || status === "discussing" || status === "confirmed") {
      result[dimension] = status;
    }
  }
  return result;
}

/** Normalize old JSON messages before rendering or submitting message actions. */
export function normalizeConversationMessages(
  value: unknown,
  sessionId: string,
  fallbackCreatedAt: string,
): ConversationMessage[] {
  if (!Array.isArray(value)) return [];

  return value.map((item, index) => {
    const raw = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const stateAfterValue = raw.stateAfter;
    const stateAfter = stateAfterValue
      && typeof stateAfterValue === "object"
      && !Array.isArray(stateAfterValue)
      ? {
          brief: normalizeBrief((stateAfterValue as Record<string, unknown>).brief),
          dimensionStatus: normalizeDimensionStatus(
            (stateAfterValue as Record<string, unknown>).dimensionStatus,
          ),
        }
      : undefined;
    const focusDimension = DIMENSIONS.includes(raw.focusDimension as ConversationDimension)
      ? raw.focusDimension as ConversationDimension
      : undefined;

    return {
      id: typeof raw.id === "string" && raw.id.length > 0
        ? raw.id
        : `legacy-${sessionId}-${index}`,
      role: raw.role === "user" ? "user" : "ai",
      content: typeof raw.content === "string" ? raw.content : "",
      createdAt: typeof raw.createdAt === "string" && raw.createdAt.length > 0
        ? raw.createdAt
        : fallbackCreatedAt,
      ...(stateAfter ? { stateAfter } : {}),
      ...(focusDimension ? { focusDimension } : {}),
    };
  });
}

/** Format an ISO timestamp in the browser's local timezone. */
export function formatConversationTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const pad = (part: number) => String(part).padStart(2, "0");
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  ].join(" ");
}

/** Build a local optimistic message that will be replaced by the server session. */
export function createOptimisticConversationMessage(
  role: ConversationMessage["role"],
  content: string,
): ConversationMessage {
  const randomPart = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    id: `local-${randomPart}`,
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}
