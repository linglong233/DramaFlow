/**
 * @fileoverview 业务规则单元测试
 * @module shared/business-rules.test
 *
 * 验证审核策略解析、版本状态流转等核心业务规则的正确性。
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  canTransitionVersionStatus,
  getSubmittedStatus,
  resolveReviewRequired,
} from "./business-rules";

test("resolveReviewRequired respects project override", () => {
  assert.equal(resolveReviewRequired("required", "bypass"), false);
  assert.equal(resolveReviewRequired("bypass", "required"), true);
  assert.equal(resolveReviewRequired("required", "inherit"), true);
});

test("getSubmittedStatus derives approval path", () => {
  assert.equal(getSubmittedStatus(true), "pending_review");
  assert.equal(getSubmittedStatus(false), "approved");
});

test("version transition matrix blocks invalid hops", () => {
  assert.equal(canTransitionVersionStatus("pending_review", "approved"), true);
  assert.equal(canTransitionVersionStatus("approved", "draft"), false);
});
