/**
 * @fileoverview 影响依赖状态规则
 * @module shared/impact-rules
 *
 * 定义影响依赖问题（Impact Issue）的状态转换规则和活跃状态判断。
 * 影响依赖系统用于追踪文档版本变更对下游依赖的级联影响。
 */

import type { ImpactIssueStatus } from "./domain";

/** 活跃状态列表：需要人工关注的影响问题状态 */
export const ACTIVE_IMPACT_ISSUE_STATUSES: ImpactIssueStatus[] = [
  "open",
  "suggested",
  "accepted",
];

/** 状态转换映射表：定义各状态允许的目标状态 */
const IMPACT_STATUS_TRANSITIONS: Record<ImpactIssueStatus, ImpactIssueStatus[]> = {
  open: ["suggested", "ignored", "resolved"],
  suggested: ["accepted", "ignored", "resolved", "open"],
  accepted: ["resolved", "suggested", "open"],
  ignored: ["open"],
  resolved: ["open"],
};

/**
 * 判断影响问题状态是否可以从 currentStatus 转换到 nextStatus
 * @param currentStatus 当前状态
 * @param nextStatus 目标状态
 * @returns 是否允许转换
 */
export function canTransitionImpactIssueStatus(
  currentStatus: ImpactIssueStatus,
  nextStatus: ImpactIssueStatus,
): boolean {
  return IMPACT_STATUS_TRANSITIONS[currentStatus].includes(nextStatus);
}

/**
 * 判断影响问题状态是否为活跃状态（需要人工关注）
 * @param status 影响问题状态
 * @returns 是否为活跃状态
 */
export function isActiveImpactIssueStatus(status: ImpactIssueStatus): boolean {
  return ACTIVE_IMPACT_ISSUE_STATUSES.includes(status);
}
