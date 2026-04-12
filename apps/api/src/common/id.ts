/**
 * @fileoverview ID 生成工具
 * @module api/common
 *
 * 提供带业务前缀的唯一 ID 生成函数，基于 UUID v4。
 */

import { randomUUID } from "node:crypto";

/**
 * 生成带业务前缀的唯一 ID
 * @param prefix - 业务前缀（如 "usr"、"prj"、"doc"）
 * @returns 格式为 "{prefix}_{uuid}" 的唯一标识
 */
export function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}
