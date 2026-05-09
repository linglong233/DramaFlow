import assert from "node:assert/strict";

import {
  canTransitionVersionStatus,
  getSubmittedStatus,
  normalizeScriptContent,
  normalizeStoryboardContent,
  normalizeStoryboardShot,
  normalizeWorldBibleContent,
  resolveReviewRequired,
} from "../src";

assert.equal(resolveReviewRequired("required", "bypass"), false);
assert.equal(resolveReviewRequired("bypass", "required"), true);
assert.equal(resolveReviewRequired("required", "inherit"), true);
assert.equal(getSubmittedStatus(true), "submitted");
assert.equal(getSubmittedStatus(false), "approved");
assert.equal(canTransitionVersionStatus("pending_review", "approved"), true);
assert.equal(canTransitionVersionStatus("approved", "draft"), false);

const normalizedLegacyShot = normalizeStoryboardShot({
  id: "shot-1",
  sceneId: "scene-1",
  shotLabel: "1A",
  framing: "Medium Shot",
  cameraMove: "push in",
  durationSeconds: 4,
  visualDescription: "A tense reveal at the apartment door.",
  dialogue: "Open the door.",
});

assert.equal(normalizedLegacyShot.framing, "MS");
assert.equal(normalizedLegacyShot.cameraMove, "dolly-in");

const normalizedRichShot = normalizeStoryboardShot({
  shotNumber: "2B",
  sceneNumber: 3,
  shotSize: "close-up",
  cameraMovement: "tilt down",
  duration: "5",
  visualDescription: "The detective studies the blood trail.",
  actionDescription: "She kneels and traces the stain with one gloved finger.",
  soundNote: "Distant siren and dripping water.",
  notes: "Hold for the reveal beat.",
});

assert.equal(normalizedRichShot.sceneId, "scene-3");
assert.equal(normalizedRichShot.shotLabel, "2B");
assert.equal(normalizedRichShot.framing, "CU");
assert.equal(normalizedRichShot.cameraMove, "tilt-down");
assert.equal(normalizedRichShot.actionDescription, "She kneels and traces the stain with one gloved finger.");
assert.equal(normalizedRichShot.notes, "Hold for the reveal beat.");

const normalizedContent = normalizeStoryboardContent({
  overview: "Storyboard overview",
  shots: [
    {
      shotLabel: "1A",
      sceneId: "scene-1",
      framing: "MS",
      cameraMove: "static",
      durationSeconds: 3,
      visualDescription: "Legacy shot",
    },
    {
      shotNumber: "1B",
      sceneNumber: 1,
      shotSize: "wide shot",
      cameraMovement: "tracking shot",
      duration: 6,
      visualDescription: "Richer shot",
      notes: "Match the storyboard frame.",
    },
  ],
});

assert.equal(normalizedContent.overview, "Storyboard overview");
assert.equal(normalizedContent.shots.length, 2);
assert.equal(normalizedContent.shots[1].framing, "LS");
assert.equal(normalizedContent.shots[1].cameraMove, "tracking");
assert.equal(normalizedContent.shots[1].notes, "Match the storyboard frame.");

const normalizedScript = normalizeScriptContent({
  logline: 42,
  premise: "A detective returns home.",
  characters: [{ name: "Lin", profile: "Lead", worldBibleCharId: 123 }, { foo: "bar" }],
  scenes: [
    {
      heading: "INT. APARTMENT - NIGHT",
      synopsis: "She enters the dark room.",
      characters: "Lin, Mother",
      dialogue: [{ speaker: "Lin", line: "Who's there?" }, "A distant crash"],
    },
    {
      id: "scene-2",
      title: "FLASHBACK",
      description: "A broken memory flashes.",
      dialogue: { bad: true },
    },
  ],
});

assert.equal(normalizedScript.logline, "42");
assert.equal(normalizedScript.characters.length, 1);
assert.deepEqual(normalizedScript.scenes[0].characters, ["Lin", "Mother"]);
assert.equal(normalizedScript.scenes[0].dialogue[1]?.line, "A distant crash");
assert.deepEqual(normalizedScript.scenes[1].dialogue, []);

const normalizedWorldBible = normalizeWorldBibleContent({
  characters: [
    {
      id: "char-1",
      name: "Lin",
      appearance: "Short hair",
      tags: "lead, detective",
      referenceImages: "https://example.com/a.png",
      costumes: { day: "coat", empty: "" },
    },
  ],
  locations: { invalid: true },
  voiceConfigs: [
    { characterId: "char-1", voiceId: "voice-1", voiceName: "Lead Voice", settings: { speed: "1.1" } },
    { voiceId: "missing-character" },
  ],
});

assert.deepEqual(normalizedWorldBible.characters[0]?.tags, ["lead", "detective"]);
assert.deepEqual(normalizedWorldBible.characters[0]?.referenceImages, ["https://example.com/a.png"]);
assert.equal(normalizedWorldBible.locations.length, 0);
assert.equal(normalizedWorldBible.voiceConfigs?.length, 1);
assert.equal(normalizedWorldBible.voiceConfigs?.[0]?.settings?.speed, 1.1);

// --- Label-based scene grouping tests ---

// Content-level grouping: 4 shots with unique sceneIds → regrouped by label prefix
const groupedContent = normalizeStoryboardContent({
  overview: "Group test",
  shots: [
    { sceneId: "scene-1", shotLabel: "1A", framing: "MS", cameraMove: "static", durationSeconds: 3, visualDescription: "A" },
    { sceneId: "scene-2", shotLabel: "1B", framing: "CU", cameraMove: "static", durationSeconds: 3, visualDescription: "B" },
    { sceneId: "scene-3", shotLabel: "2A", framing: "LS", cameraMove: "dolly-in", durationSeconds: 4, visualDescription: "C" },
    { sceneId: "scene-4", shotLabel: "2B", framing: "CU", cameraMove: "static", durationSeconds: 3, visualDescription: "D" },
  ],
});
assert.equal(groupedContent.shots[0].sceneId, "scene-1");
assert.equal(groupedContent.shots[1].sceneId, "scene-1");
assert.equal(groupedContent.shots[2].sceneId, "scene-2");
assert.equal(groupedContent.shots[3].sceneId, "scene-2");

// Backward compat: non-standard label with custom sceneId preserved
const customScene = normalizeStoryboardShot({
  sceneId: "kitchen-scene",
  framing: "MS",
  cameraMove: "static",
  durationSeconds: 3,
  visualDescription: "Custom scene",
}, 5);
assert.equal(customScene.sceneId, "kitchen-scene");

console.log("shared tests passed");