/** @fileoverview 提示词确定性评估工具 */
import {
  NOVEL_CHUNK_SCENES_CONTRACT,
  SCRIPT_GENERATION_CONTRACT,
  STORYBOARD_GENERATION_CONTRACT,
  WORLD_BIBLE_EXTRACTION_CONTRACT,
} from "./text-contracts";
import { buildMediaVideoPrompt } from "./media-prompt-builder";

export interface PromptEvalResult {
  ok: boolean;
  errors: string[];
}

export function runPromptEvals(): PromptEvalResult {
  const errors: string[] = [];

  const script = SCRIPT_GENERATION_CONTRACT.render({
    title: "Eval Pilot",
    genre: "Suspense",
    premise: "A lead discovers a hidden betrayal.",
    episodeGoal: "Reveal the betrayal.",
    tone: "tense",
    audience: "mobile viewers",
  });
  requireIncludes(script.user, ["<task>", "<output_schema>", "logline"], "script", errors);

  const storyboard = STORYBOARD_GENERATION_CONTRACT.render({
    cinematicStyle: "grounded handheld",
    shotDensity: "balanced",
    script: {
      logline: "Eval",
      premise: "Eval",
      characters: [{ name: "Lin", profile: "lead" }],
      scenes: [{ id: "scene-1", heading: "INT. ROOM - NIGHT", synopsis: "A clue.", characters: ["Lin"], dialogue: [], directorNote: "tense" }],
    },
  });
  requireIncludes(storyboard.user, ["Multiple shots in the same scene MUST share the same sceneId.", "imagePrompt", "videoPrompt"], "storyboard", errors);

  const worldBible = WORLD_BIBLE_EXTRACTION_CONTRACT.render({
    adaptationPlan: "Keep it intimate.",
    sourceText: "Lin walks into a rainy office.",
  });
  requireIncludes(worldBible.user, ["characters", "locations", "<source_content>"], "world bible", errors);

  const chunk = NOVEL_CHUNK_SCENES_CONTRACT.render({
    adaptationPlan: "Fast suspense.",
    worldBibleContext: "Lin: lead",
    chunkText: "Lin opens the door.",
    chunkIndex: 0,
  });
  requireIncludes(chunk.user, ["continuityNotes", "dialogue", "<quality_bar>"], "novel chunk", errors);

  const video = buildMediaVideoPrompt({
    videoReferenceMode: "first_last",
    shot: {
      id: "shot-1",
      sceneId: "scene-1",
      shotLabel: "1A",
      framing: "MS",
      cameraMove: "dolly-in",
      durationSeconds: 5,
      visualDescription: "Lin crosses a hallway.",
    },
    characters: [],
  });
  requireIncludes(video.positivePrompt, ["Bridge motion from the first frame to the last frame"], "video prompt", errors);

  return { ok: errors.length === 0, errors };
}

function requireIncludes(value: string, needles: string[], label: string, errors: string[]): void {
  for (const needle of needles) {
    if (!value.includes(needle)) {
      errors.push(`${label} prompt missing ${needle}`);
    }
  }
}
