/**
 * @fileoverview 结构化输出校验、JSON 提取与修复提示词构建
 * @module api/jobs/prompting
 *
 * 提供 PromptJsonSchema 校验、从模型输出的 Markdown 围栏中提取 JSON、
 * 以及构建 JSON 修复提示词的工具函数。
 */

import type { PromptJsonSchema } from "./prompt-contracts";

export interface PromptSchemaValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * 校验 value 是否符合 PromptJsonSchema 定义的结构。
 * 递归检查 object / array / string / number / boolean 类型的
 * required 字段、嵌套属性和 enum 约束。
 */
export function validatePromptSchema(value: unknown, schema: PromptJsonSchema, path = "$"): PromptSchemaValidationResult {
  const errors: string[] = [];
  validateValue(value, schema, path, errors);
  return { ok: errors.length === 0, errors };
}

function validateValue(value: unknown, schema: PromptJsonSchema, path: string, errors: string[]): void {
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`${path} must be an object`);
      return;
    }
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in record)) {
        errors.push(`${path}.${key} is required`);
      }
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (key in record) validateValue(record[key], childSchema, `${path}.${key}`, errors);
    }
    return;
  }

  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      errors.push(`${path} must be an array`);
      return;
    }
    if (schema.items) {
      value.forEach((item, index) => validateValue(item, schema.items!, `${path}[${index}]`, errors));
    }
    return;
  }

  if (schema.type === "string") {
    if (typeof value !== "string") {
      errors.push(`${path} must be a string`);
      return;
    }
    if (schema.enum && !schema.enum.includes(value)) {
      errors.push(`${path} must be one of: ${schema.enum.join(", ")}`);
    }
    return;
  }

  if (schema.type === "number" && typeof value !== "number") {
    errors.push(`${path} must be a number`);
    return;
  }

  if (schema.type === "boolean" && typeof value !== "boolean") {
    errors.push(`${path} must be a boolean`);
  }
}

/**
 * 从模型原始输出文本中提取 JSON 对象。
 * 支持 Markdown 围栏包裹（```json ... ```）和裸 JSON 两种格式。
 * 如果解析失败则尝试从文本中定位第一个 { 到最后一个 } 之间的子串。
 */
export function extractJsonObject<T>(raw: string | undefined): T | undefined {
  if (!raw) return undefined;
  let cleaned = raw.trim();

  // 尝试匹配 Markdown 围栏
  const fenceMatch = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // 回退：定位最外层花括号
    const objStart = cleaned.indexOf("{");
    const objEnd = cleaned.lastIndexOf("}");
    if (objStart === -1 || objEnd === -1 || objEnd <= objStart) return undefined;
    try {
      return JSON.parse(cleaned.slice(objStart, objEnd + 1)) as T;
    } catch {
      return undefined;
    }
  }
}

/**
 * 构建 JSON 修复提示词。
 * 仅要求模型修复 JSON 格式，不重写、不扩展、不编造内容。
 */
export function buildJsonRepairPrompt(input: {
  schemaName: string;
  schemaText: string;
  rawOutput: string;
  errors: string[];
}): string {
  return [
    "Repair the JSON only.",
    "Do not rewrite, expand, summarize, or invent story content.",
    "Return only strict JSON with no markdown fences.",
    "",
    `<schema name="${input.schemaName}">`,
    input.schemaText,
    "</schema>",
    "",
    "<validation_errors>",
    input.errors.map((error) => `- ${error}`).join("\n"),
    "</validation_errors>",
    "",
    "<raw_output>",
    input.rawOutput,
    "</raw_output>",
  ].join("\n");
}
