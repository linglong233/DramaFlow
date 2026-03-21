import assert from "node:assert/strict";

import {
  canTransitionVersionStatus,
  getSubmittedStatus,
  resolveReviewRequired,
} from "../src/business-rules";

assert.equal(resolveReviewRequired("required", "bypass"), false);
assert.equal(resolveReviewRequired("bypass", "required"), true);
assert.equal(resolveReviewRequired("required", "inherit"), true);
assert.equal(getSubmittedStatus(true), "pending_review");
assert.equal(getSubmittedStatus(false), "approved");
assert.equal(canTransitionVersionStatus("pending_review", "approved"), true);
assert.equal(canTransitionVersionStatus("approved", "draft"), false);

console.log("shared tests passed");
