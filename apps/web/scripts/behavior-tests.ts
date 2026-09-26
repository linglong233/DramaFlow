/**
 * @fileoverview Web 行为测试（纯函数边界）
 * @module web/scripts/behavior-tests
 *
 * 测试 normalizeStoryboardContent / normalizeScriptContent / buildProductionOverviewModel
 * 在最小/空/非法输入下不崩溃的行为。
 *
 * 注意：buildProductionOverviewModel 实际签名为 (payload, t: TranslateFn)，需要 2 个参数，
 * 因此测试提供一个最小合法 TranslateFn，而非计划模板假设的 3 参数形式。
 */

import test from "node:test";
import assert from "node:assert/strict";

import { normalizeStoryboardContent, normalizeScriptContent } from "@dramaflow/shared";
import type { ProjectWorkspacePayload } from "@dramaflow/shared";
import { buildProductionOverviewModel } from "../lib/hooks/use-production-overview";
import type { TranslateFn } from "../lib/i18n";
import {
  formatConversationTimestamp,
  normalizeConversationMessages,
} from "../lib/conversation-message";

/** 最小合法 TranslateFn：直接返回 key 文本，参数插值后回退。 */
const noopT: TranslateFn = ((key: unknown, params?: Record<string, unknown>) => {
  let text = String(key);
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}) as TranslateFn;

test("normalizeStoryboardContent: 空输入不崩溃", () => {
  // normalizeStoryboardContent(value: unknown, previousShots?) 接受任意输入
  const empty = normalizeStoryboardContent({});
  assert.ok(empty, "空对象应返回标准化结果");
  assert.ok(Array.isArray(empty.shots));
  assert.ok(empty.mediaBindings && typeof empty.mediaBindings === "object");

  const nullish = normalizeStoryboardContent(null);
  assert.ok(nullish, "null 输入不应崩溃");

  const malformed = normalizeStoryboardContent({ shots: "not-an-array", mediaBindings: 42 });
  assert.ok(malformed, "畸形输入不应崩溃");
  assert.ok(Array.isArray(malformed.shots));
});

test("normalizeScriptContent: 非法输入不崩溃", () => {
  // normalizeScriptContent(value: unknown) 接受任意输入
  const empty = normalizeScriptContent({ logline: "", premise: "", characters: [], scenes: [] });
  assert.ok(empty, "空字段输入应返回标准化结果");
  assert.equal(empty.logline, "");
  assert.ok(Array.isArray(empty.characters));
  assert.ok(Array.isArray(empty.scenes));

  const nullish = normalizeScriptContent(null);
  assert.ok(nullish, "null 输入不应崩溃");

  const malformed = normalizeScriptContent({ characters: "x", scenes: 123 });
  assert.ok(malformed, "畸形输入不应崩溃");
  assert.ok(Array.isArray(malformed.scenes));
});

test("conversation message helpers: 时间按本地时区格式化并兼容旧消息", () => {
  const timestamp = "2026-01-02T03:04:05.000Z";
  const date = new Date(timestamp);
  const pad = (part: number) => String(part).padStart(2, "0");
  const expected = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  assert.equal(formatConversationTimestamp(timestamp), expected);

  const messages = normalizeConversationMessages(
    [
      { role: "user", content: "旧消息" },
      { id: "known-message", role: "ai", content: "新格式消息", createdAt: timestamp },
    ],
    "session-1",
    timestamp,
  );
  assert.equal(messages[0].id, "legacy-session-1-0");
  assert.equal(messages[0].createdAt, timestamp);
  assert.equal(messages[1].id, "known-message");
  assert.equal(messages[1].createdAt, timestamp);
});

test("buildProductionOverviewModel: 空数据不崩溃", () => {
  // buildProductionOverviewModel(payload, t: TranslateFn) —— 2 个参数
  const minimalPayload = {
    team: { id: "team-1", name: "x", defaultReviewPolicy: "required" },
    project: { id: "p1", name: "x", status: "draft" },
    members: [],
    invites: [],
    pendingReviews: [],
    documents: [],
    versions: [],
    jobs: [],
    currentUserPermissions: [],
  } as unknown as ProjectWorkspacePayload;

  const result = buildProductionOverviewModel(minimalPayload, noopT);
  assert.ok(result, "空项目数据应返回模型而不崩溃");
  assert.ok(Array.isArray(result.stages));
  assert.ok(result.health);
  assert.ok(Array.isArray(result.shotRows));
});
