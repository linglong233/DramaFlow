import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const globalsCss = readFileSync(join(scriptDir, "../app/globals.css"), "utf8");

function assertRuleContains(selector: string, declarations: string[]) {
  const selectorStart = globalsCss.indexOf(`${selector} {`);
  assert.notEqual(selectorStart, -1, `Expected CSS rule for ${selector}`);

  const bodyStart = globalsCss.indexOf("{", selectorStart) + 1;
  const bodyEnd = globalsCss.indexOf("}", bodyStart);
  assert.notEqual(bodyStart, 0, `Expected CSS body start for ${selector}`);
  assert.notEqual(bodyEnd, -1, `Expected CSS body end for ${selector}`);

  const body = globalsCss.slice(bodyStart, bodyEnd).replace(/\s+/g, " ");
  for (const declaration of declarations) {
    assert.ok(
      body.includes(declaration),
      `Expected ${selector} to include "${declaration}"`,
    );
  }
}

assertRuleContains(".app-main:has(.gen-root--conversational)", [
  "height: 100dvh;",
  "min-height: 0;",
  "overflow: hidden;",
]);

assertRuleContains(".gen-root--conversational .conv-layout", [
  "grid-template-rows: minmax(0, 1fr);",
  "overflow: hidden;",
]);

console.log("web tests passed");
