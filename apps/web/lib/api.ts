import type { SessionPayload } from "@dramaflow/shared";

import type { TranslateFn, TranslationKey, TranslationParams } from "./i18n";

export interface SessionSnapshot {
  session: SessionPayload | null;
  ready: boolean;
}

export type ApiBody = BodyInit | object | null | undefined;

export interface ApiFetchInit extends Omit<RequestInit, "body"> {
  body?: ApiBody;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: string,
    public readonly messageKey?: TranslationKey,
    public readonly messageParams?: TranslationParams,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const SESSION_KEY = "dramaflow.session";
export const SESSION_EVENT_NAME = "dramaflow:session";

export function getApiBaseUrl() {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
}

function dispatchSessionChange() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(SESSION_EVENT_NAME));
}

export function readSession(): SessionPayload | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as SessionPayload;
  } catch {
    window.localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function saveSession(payload: SessionPayload) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
  dispatchSessionChange();
}

export function clearSession() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(SESSION_KEY);
  dispatchSessionChange();
}

function isSerializableBody(body: ApiBody): body is object {
  return Boolean(body)
    && typeof body === "object"
    && !(body instanceof FormData)
    && !(body instanceof Blob)
    && !(body instanceof ArrayBuffer)
    && !(ArrayBuffer.isView(body))
    && !(body instanceof URLSearchParams)
    && !(body instanceof ReadableStream);
}

function redirectToLogin() {
  if (typeof window === "undefined") {
    return;
  }

  if (window.location.pathname !== "/login") {
    window.location.replace("/login");
  }
}

function extractMessage(status: number, payload: string) {
  if (!payload) {
    return status === 401
      ? { message: "", messageKey: "errors.authExpired" as const }
      : {
          message: "",
          messageKey: "errors.requestFailedStatus" as const,
          messageParams: { status },
        };
  }

  try {
    const parsed = JSON.parse(payload) as {
      message?: string | string[];
      error?: string;
    };

    if (Array.isArray(parsed.message) && parsed.message.length > 0) {
      return { message: parsed.message.join(", ") };
    }

    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return { message: parsed.message };
    }

    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return { message: parsed.error };
    }
  } catch {
    // Keep the original response text as a fallback.
  }

  return { message: payload };
}

export async function apiFetch<T>(path: string, init: ApiFetchInit = {}): Promise<T> {
  const session = readSession();
  const headers = new Headers(init.headers ?? {});

  if (!headers.has("content-type") && isSerializableBody(init.body)) {
    headers.set("content-type", "application/json");
  }

  if (session?.accessToken) {
    headers.set("authorization", `Bearer ${session.accessToken}`);
  }

  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, {
      ...init,
      headers,
      body: isSerializableBody(init.body) ? JSON.stringify(init.body) : init.body,
    });
  } catch (error) {
    throw new ApiError(
      error instanceof Error ? error.message : "",
      0,
      undefined,
      "errors.networkFailed",
    );
  }

  if (!response.ok) {
    const details = await response.text();
    const extracted = extractMessage(response.status, details);

    if (response.status === 401 && !path.startsWith("/auth/")) {
      clearSession();
      redirectToLogin();
    }

    throw new ApiError(
      extracted.message,
      response.status,
      details,
      extracted.messageKey,
      extracted.messageParams,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json() as Promise<T>;
  }

  return response.text() as Promise<T>;
}

export function formatApiError(
  error: unknown,
  t: TranslateFn,
  fallbackKey: TranslationKey = "errors.requestFailed",
  fallbackParams?: TranslationParams,
) {
  if (error instanceof ApiError) {
    if (error.messageKey) {
      return t(error.messageKey, error.messageParams);
    }

    if (error.message.trim()) {
      return error.message;
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return t(fallbackKey, fallbackParams);
}

// ===== SSE Streaming =====

export interface StreamChunk {
  type: "chunk" | "done" | "error";
  content?: string;
  result?: Record<string, unknown>;
  error?: string;
}

export async function* apiStreamFetch(
  path: string,
  init: ApiFetchInit = {},
): AsyncGenerator<StreamChunk> {
  const session = readSession();
  const headers = new Headers(init.headers ?? {});

  if (!headers.has("content-type") && isSerializableBody(init.body)) {
    headers.set("content-type", "application/json");
  }

  if (session?.accessToken) {
    headers.set("authorization", `Bearer ${session.accessToken}`);
  }

  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, {
      ...init,
      headers,
      body: isSerializableBody(init.body) ? JSON.stringify(init.body) : init.body,
    });
  } catch (error) {
    yield { type: "error", error: error instanceof Error ? error.message : "Network error" };
    return;
  }

  if (!response.ok) {
    const details = await response.text();
    const extracted = extractMessage(response.status, details);

    if (response.status === 401 && !path.startsWith("/auth/")) {
      clearSession();
      redirectToLogin();
    }

    yield { type: "error", error: extracted.message || `HTTP ${response.status}` };
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    yield { type: "error", error: "Response body is not readable" };
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;

        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        try {
          const parsed = JSON.parse(payload) as StreamChunk;
          yield parsed;
        } catch {
          // skip unparseable events
        }
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith("data:")) {
        const payload = trimmed.slice(5).trim();
        if (payload && payload !== "[DONE]") {
          try {
            yield JSON.parse(payload) as StreamChunk;
          } catch {
            // skip
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}