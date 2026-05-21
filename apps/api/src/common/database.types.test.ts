/**
 * @fileoverview 数据库类型单元测试
 * @module api/common
 *
 * 验证数据库类型定义和初始化函数的正确性。
 */

import test from "node:test";
import assert from "node:assert/strict";

import { createEmptyDatabase } from "./database.types";

test("createEmptyDatabase starts with every collection empty", () => {
  const db = createEmptyDatabase();

  assert.equal(db.users.length, 0);
  assert.equal(db.teams.length, 0);
  assert.equal(db.projects.length, 0);
  assert.equal(db.documents.length, 0);
  assert.equal(db.jobs.length, 0);
  assert.equal(Array.isArray(db.novelImportSessions), true);
  assert.equal(db.novelImportSessions.length, 0);
  assert.ok(db.updatedAt.length > 10);
});

test("createEmptyDatabase is compatible with permission fields being absent", () => {
  const db = createEmptyDatabase();

  assert.deepEqual(db.teams.map((team) => team.projectRolePermissionTemplates), []);
  assert.deepEqual(db.projectMembers.map((member) => member.permissionOverride), []);
});
