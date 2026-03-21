export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  globalRole: "platform_super_admin" | "user";
}

export interface SessionPayload {
  user: SessionUser;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

type ApiBody = BodyInit | Record<string, unknown> | unknown[] | null | undefined;

export interface ApiFetchInit extends Omit<RequestInit, "body"> {
  body?: ApiBody;
}

const SESSION_KEY = "dramaflow.session";

export function getApiBaseUrl() {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
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
    return null;
  }
}

export function saveSession(payload: SessionPayload) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
}

export function clearSession() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(SESSION_KEY);
}

function isSerializableBody(body: ApiBody): body is Record<string, unknown> | unknown[] {
  return Boolean(body) && typeof body === "object" && !(body instanceof FormData) && !(body instanceof Blob) && !(body instanceof ArrayBuffer) && !(ArrayBuffer.isView(body)) && !(body instanceof URLSearchParams) && !(body instanceof ReadableStream);
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

  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers,
    body: isSerializableBody(init.body) ? JSON.stringify(init.body) : init.body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

