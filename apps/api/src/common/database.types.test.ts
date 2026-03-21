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
  assert.ok(db.updatedAt.length > 10);
});
