/**
 * @fileoverview 版本差异比较工具单元测试
 * @module shared/version-diff.test
 */

import test from "node:test";
import assert from "node:assert/strict";

import type { ScriptContent, StoryboardContent, WorldBibleContent } from "./domain";
import {
  diffContents,
  diffScriptContents,
  diffStoryboardContents,
  diffWorldBibleContents,
} from "./version-diff";

// =============================================
// diffScriptContents
// =============================================

test("diffScriptContents: detects logline change", () => {
  const base: ScriptContent = { logline: "old", premise: "same", characters: [], scenes: [] };
  const compare: ScriptContent = { logline: "new", premise: "same", characters: [], scenes: [] };
  const result = diffScriptContents(base, compare);
  assert.equal(result.length, 1);
  assert.equal(result[0].type, "modified");
  assert.equal(result[0].label, "Logline");
});

test("diffScriptContents: detects added/removed characters", () => {
  const base: ScriptContent = {
    logline: "", premise: "",
    characters: [{ name: "Alice", profile: "" }],
    scenes: [],
  };
  const compare: ScriptContent = {
    logline: "", premise: "",
    characters: [{ name: "Alice", profile: "" }, { name: "Bob", profile: "" }],
    scenes: [],
  };
  const result = diffScriptContents(base, compare);
  assert.equal(result.length, 1);
  assert.equal(result[0].type, "modified");
  assert.ok(result[0].details[0].includes("Bob"));
});

test("diffScriptContents: detects added and removed scenes", () => {
  const base: ScriptContent = {
    logline: "", premise: "", characters: [],
    scenes: [{ id: "s1", heading: "Scene 1", synopsis: "A", characters: [], dialogue: [] }],
  };
  const compare: ScriptContent = {
    logline: "", premise: "", characters: [],
    scenes: [{ id: "s2", heading: "Scene 2", synopsis: "B", characters: [], dialogue: [] }],
  };
  const result = diffScriptContents(base, compare);
  assert.equal(result.length, 2);
  const removed = result.find((e) => e.type === "removed");
  const added = result.find((e) => e.type === "added");
  assert.ok(removed);
  assert.ok(added);
});

test("diffScriptContents: detects modified scene", () => {
  const base: ScriptContent = {
    logline: "", premise: "", characters: [],
    scenes: [{ id: "s1", heading: "Old Heading", synopsis: "A", characters: [], dialogue: [] }],
  };
  const compare: ScriptContent = {
    logline: "", premise: "", characters: [],
    scenes: [{ id: "s1", heading: "New Heading", synopsis: "A", characters: [], dialogue: [] }],
  };
  const result = diffScriptContents(base, compare);
  assert.equal(result.length, 1);
  assert.equal(result[0].type, "modified");
  assert.ok(result[0].details.some((d) => d.includes("Heading")));
});

test("diffScriptContents: returns empty for identical content", () => {
  const content: ScriptContent = {
    logline: "same", premise: "same", characters: [],
    scenes: [{ id: "s1", heading: "H", synopsis: "S", characters: [], dialogue: [] }],
  };
  assert.deepEqual(diffScriptContents(content, content), []);
});

// =============================================
// diffStoryboardContents
// =============================================

test("diffStoryboardContents: detects overview change", () => {
  const base: StoryboardContent = { overview: "old", shots: [], mediaBindings: {} };
  const compare: StoryboardContent = { overview: "new", shots: [], mediaBindings: {} };
  const result = diffStoryboardContents(base, compare);
  assert.equal(result.length, 1);
  assert.equal(result[0].label, "Overview");
});

test("diffStoryboardContents: detects added/removed shots", () => {
  const base: StoryboardContent = {
    overview: "",
    shots: [{
      id: "shot-1", sceneId: "scene-1", shotLabel: "1A", framing: "CU",
      cameraMove: "static", durationSeconds: 3, visualDescription: "test",
    }],
    mediaBindings: {},
  };
  const compare: StoryboardContent = {
    overview: "",
    shots: [{
      id: "shot-2", sceneId: "scene-1", shotLabel: "1B", framing: "LS",
      cameraMove: "dolly-in", durationSeconds: 5, visualDescription: "new",
    }],
    mediaBindings: {},
  };
  const result = diffStoryboardContents(base, compare);
  assert.equal(result.length, 2);
  assert.ok(result.find((e) => e.type === "removed"));
  assert.ok(result.find((e) => e.type === "added"));
});

test("diffStoryboardContents: detects modified shot fields", () => {
  const baseShot = {
    id: "shot-1", sceneId: "scene-1", shotLabel: "1A", framing: "CU",
    cameraMove: "static", durationSeconds: 3, visualDescription: "old desc",
  };
  const base: StoryboardContent = { overview: "", shots: [baseShot], mediaBindings: {} };
  const compare: StoryboardContent = {
    overview: "",
    shots: [{ ...baseShot, framing: "LS", visualDescription: "new desc" }],
    mediaBindings: {},
  };
  const result = diffStoryboardContents(base, compare);
  assert.equal(result.length, 1);
  assert.equal(result[0].type, "modified");
  assert.ok(result[0].details.some((d) => d.includes("Framing")));
  assert.ok(result[0].details.some((d) => d.includes("Visual description")));
});

test("diffStoryboardContents: detects media binding changes", () => {
  const shot = {
    id: "shot-1", sceneId: "scene-1", shotLabel: "1A", framing: "CU",
    cameraMove: "static", durationSeconds: 3, visualDescription: "test",
  };
  const base: StoryboardContent = {
    overview: "", shots: [shot],
    mediaBindings: { "shot-1": { imageVersionId: "v1" } },
  };
  const compare: StoryboardContent = {
    overview: "", shots: [shot],
    mediaBindings: { "shot-1": { imageVersionId: "v2" } },
  };
  const result = diffStoryboardContents(base, compare);
  assert.equal(result.length, 1);
  assert.ok(result[0].details.some((d) => d.includes("Image version")));
});

// =============================================
// diffWorldBibleContents
// =============================================

test("diffWorldBibleContents: detects added/removed characters", () => {
  const base: WorldBibleContent = {
    characters: [{ id: "c1", name: "Alice", appearance: "tall", tags: [], referenceImages: [], sortOrder: 0 }],
    locations: [],
  };
  const compare: WorldBibleContent = {
    characters: [
      { id: "c1", name: "Alice", appearance: "tall", tags: [], referenceImages: [], sortOrder: 0 },
      { id: "c2", name: "Bob", appearance: "short", tags: [], referenceImages: [], sortOrder: 1 },
    ],
    locations: [],
  };
  const result = diffWorldBibleContents(base, compare);
  assert.ok(result.some((e) => e.type === "added" && e.label === "Characters"));
});

test("diffWorldBibleContents: detects character modification", () => {
  const base: WorldBibleContent = {
    characters: [{ id: "c1", name: "Alice", appearance: "tall", tags: [], referenceImages: [], sortOrder: 0 }],
    locations: [],
  };
  const compare: WorldBibleContent = {
    characters: [{ id: "c1", name: "Alice", appearance: "short", tags: [], referenceImages: [], sortOrder: 0 }],
    locations: [],
  };
  const result = diffWorldBibleContents(base, compare);
  assert.ok(result.some((e) => e.type === "modified" && e.label === "Character: Alice"));
});

test("diffWorldBibleContents: detects location changes", () => {
  const base: WorldBibleContent = {
    characters: [],
    locations: [{ id: "l1", name: "Office", description: "old", referenceImages: [], sortOrder: 0 }],
  };
  const compare: WorldBibleContent = {
    characters: [],
    locations: [{ id: "l1", name: "Office", description: "new", referenceImages: [], sortOrder: 0 }],
  };
  const result = diffWorldBibleContents(base, compare);
  assert.ok(result.some((e) => e.type === "modified" && e.label === "Location: Office"));
});

// =============================================
// diffContents dispatcher
// =============================================

test("diffContents: returns null for null inputs", () => {
  assert.equal(diffContents(null, { scenes: [] }), null);
  assert.equal(diffContents({ scenes: [] }, null), null);
});

test("diffContents: dispatches to script diff", () => {
  const base = { logline: "a", premise: "b", characters: [], scenes: [] };
  const compare = { logline: "c", premise: "b", characters: [], scenes: [] };
  const result = diffContents(base, compare);
  assert.ok(result !== null);
  assert.equal(result.length, 1);
});

test("diffContents: dispatches to storyboard diff", () => {
  const base = { overview: "a", shots: [], mediaBindings: {} };
  const compare = { overview: "b", shots: [], mediaBindings: {} };
  const result = diffContents(base, compare);
  assert.ok(result !== null);
  assert.equal(result.length, 1);
});

test("diffContents: returns empty for identical content", () => {
  const content = { logline: "a", premise: "b", characters: [], scenes: [] };
  assert.deepEqual(diffContents(content, content), []);
});

test("diffContents: returns generic entry for unknown content types", () => {
  const result = diffContents({ foo: "a" }, { foo: "b" });
  assert.ok(result !== null);
  assert.equal(result.length, 1);
  assert.equal(result[0].label, "Content");
});
