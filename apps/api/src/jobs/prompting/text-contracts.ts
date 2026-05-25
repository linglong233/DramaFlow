/** @fileoverview 脚本与分镜提示词契约 */
import type {
  GenerateScriptInput,
  GenerateStoryboardInput,
  ScriptContent,
  StoryboardContent,
} from "@dramaflow/shared";
import { normalizeScriptContent, normalizeStoryboardContent, normalizeWorldBibleContent } from "@dramaflow/shared";
import type { PromptContract, PromptJsonSchema } from "./prompt-contracts";
import { renderPromptSections, summarizePromptInput } from "./prompt-renderer";

export interface ScriptPromptInput extends GenerateScriptInput {
  worldBibleContext?: string;
}

export interface StoryboardPromptInput {
  cinematicStyle: string;
  shotDensity: "sparse" | "balanced" | "dense";
  script: ScriptContent;
  worldBibleContext?: string;
}

const scriptSchema: PromptJsonSchema = {
  id: "script.v1",
  type: "object",
  required: ["logline", "premise", "characters", "scenes"],
  properties: {
    logline: { id: "logline", type: "string" },
    premise: { id: "premise", type: "string" },
    characters: {
      id: "characters",
      type: "array",
      items: {
        id: "character",
        type: "object",
        required: ["name", "profile"],
        properties: {
          name: { id: "character.name", type: "string" },
          profile: { id: "character.profile", type: "string" },
        },
      },
    },
    scenes: {
      id: "scenes",
      type: "array",
      items: {
        id: "scene",
        type: "object",
        required: ["id", "heading", "synopsis", "characters", "dialogue"],
        properties: {
          id: { id: "scene.id", type: "string" },
          heading: { id: "scene.heading", type: "string" },
          synopsis: { id: "scene.synopsis", type: "string" },
          characters: { id: "scene.characters", type: "array", items: { id: "scene.character", type: "string" } },
          dialogue: {
            id: "scene.dialogue",
            type: "array",
            items: {
              id: "dialogue",
              type: "object",
              required: ["speaker", "line"],
              properties: {
                speaker: { id: "dialogue.speaker", type: "string" },
                line: { id: "dialogue.line", type: "string" },
              },
            },
          },
          directorNote: { id: "scene.directorNote", type: "string" },
        },
      },
    },
  },
};

const storyboardSchema: PromptJsonSchema = {
  id: "storyboard.v1",
  type: "object",
  required: ["overview", "shots"],
  properties: {
    overview: { id: "overview", type: "string" },
    shots: {
      id: "shots",
      type: "array",
      items: {
        id: "shot",
        type: "object",
        required: ["id", "sceneId", "shotLabel", "framing", "cameraMove", "durationSeconds", "visualDescription"],
        properties: {
          id: { id: "shot.id", type: "string" },
          sceneId: { id: "shot.sceneId", type: "string" },
          shotLabel: { id: "shot.shotLabel", type: "string" },
          framing: {
            id: "shot.framing",
            type: "string",
            enum: ["ECU", "CU", "MCU", "MS", "MLS", "LS", "ELS", "OTS", "POV", "bird-eye", "low-angle", "dutch-angle"],
          },
          cameraMove: {
            id: "shot.cameraMove",
            type: "string",
            enum: ["static", "pan-left", "pan-right", "tilt-up", "tilt-down", "dolly-in", "dolly-out", "tracking", "crane-up", "crane-down", "handheld", "steadicam", "whip-pan", "zoom-in", "zoom-out"],
          },
          durationSeconds: { id: "shot.durationSeconds", type: "number" },
          visualDescription: { id: "shot.visualDescription", type: "string" },
        },
      },
    },
  },
};

export const SCRIPT_GENERATION_CONTRACT: PromptContract<ScriptPromptInput, ScriptContent> = {
  id: "script.generation.v1",
  version: "1.0.0",
  task: "Generate a short drama script payload.",
  outputKind: "json",
  schema: scriptSchema,
  render: (input) => ({
    system: "You are a screenplay development assistant. Always return strict JSON.",
    user: renderPromptSections({
      task: "Generate a short-drama script payload.",
      rules: [
        "Return strict JSON only.",
        "Write playable short-drama scenes with clear conflict and production-friendly locations.",
        "Do not include markdown fences.",
      ],
      projectContext: [
        `Title: ${input.title}`,
        `Genre: ${input.genre}`,
        `Episode goal: ${input.episodeGoal}`,
        `Tone: ${input.tone}`,
        `Audience: ${input.audience}`,
        input.worldBibleContext ? `World bible:\n${input.worldBibleContext}` : "",
      ].filter(Boolean).join("\n"),
      sourceContent: `Premise:\n${input.premise}`,
      outputSchema: 'JSON object: { "logline": string, "premise": string, "characters": [{ "name": string, "profile": string }], "scenes": [{ "id": string, "heading": string, "synopsis": string, "characters": string[], "dialogue": [{ "speaker": string, "line": string }], "directorNote": string }] }',
      qualityBar: [
        "Every scene must be shootable.",
        "Every named speaking character must exist in characters.",
        "Dialogue should match the requested tone.",
      ],
    }),
    metadata: {
      contractId: "script.generation.v1",
      contractVersion: "1.0.0",
      inputSummary: summarizePromptInput(input),
    },
  }),
  validate: (output) => normalizeScriptContent(output),
};

export const STORYBOARD_GENERATION_CONTRACT: PromptContract<StoryboardPromptInput, StoryboardContent> = {
  id: "storyboard.generation.v1",
  version: "1.0.0",
  task: "Generate a structured storyboard payload.",
  outputKind: "json",
  schema: storyboardSchema,
  render: (input) => ({
    system: "You are a storyboard supervisor. Always return strict JSON.",
    user: renderPromptSections({
      task: "Generate a storyboard payload with overview and shots.",
      rules: [
        "Return strict JSON only.",
        "Multiple shots in the same scene MUST share the same sceneId.",
        "The numeric prefix of shotLabel determines scene grouping when source scene ids are absent.",
        "Preserve source scene ids from the script when they exist.",
        "Populate characterIds only with ids provided by the world bible context.",
      ],
      projectContext: [
        `Cinematic style: ${input.cinematicStyle}`,
        `Shot density: ${input.shotDensity}`,
        input.worldBibleContext ? `World bible:\n${input.worldBibleContext}` : "",
      ].filter(Boolean).join("\n"),
      sourceContent: `Script JSON:\n${JSON.stringify(input.script, null, 2)}`,
      outputSchema: 'JSON object: { "overview": string, "shots": [{ "id": string, "sceneId": string, "shotLabel": string, "framing": "ECU|CU|MCU|MS|MLS|LS|ELS|OTS|POV|bird-eye|low-angle|dutch-angle", "cameraMove": "static|pan-left|pan-right|tilt-up|tilt-down|dolly-in|dolly-out|tracking|crane-up|crane-down|handheld|steadicam|whip-pan|zoom-in|zoom-out", "durationSeconds": number, "visualDescription": string, "actionDescription": string, "dialogue": string, "soundDesign": string, "notes": string, "imagePrompt": string, "videoPrompt": string, "characterIds": string[] }] }',
      qualityBar: [
        "visualDescription describes composition, lighting, and subjects.",
        "actionDescription describes blocking or motion.",
        "imagePrompt and videoPrompt should be directly usable for media generation.",
      ],
    }),
    metadata: {
      contractId: "storyboard.generation.v1",
      contractVersion: "1.0.0",
      inputSummary: summarizePromptInput({
        cinematicStyle: input.cinematicStyle,
        shotDensity: input.shotDensity,
        sceneCount: input.script.scenes.length,
      }),
    },
  }),
  validate: (output) => normalizeStoryboardContent(output),
};

export interface WorldBibleExtractionInput {
  adaptationPlan: string;
  sourceText: string;
}

export interface NovelChunkScenesInput {
  adaptationPlan: string;
  worldBibleContext: string;
  previousSummary?: string;
  futureHints?: string;
  chunkText: string;
  chunkIndex: number;
}

const worldBibleSchema: PromptJsonSchema = {
  id: "world_bible.v1",
  type: "object",
  required: ["characters", "locations"],
  properties: {
    characters: { id: "characters", type: "array", items: { id: "character", type: "object" } },
    locations: { id: "locations", type: "array", items: { id: "location", type: "object" } },
    styleGuide: { id: "styleGuide", type: "object" },
  },
};

const novelChunkScenesSchema: PromptJsonSchema = {
  id: "novel_chunk_scenes.v1",
  type: "object",
  required: ["scenes", "summary", "continuityNotes"],
  properties: {
    scenes: { id: "scenes", type: "array", items: { id: "scene", type: "object" } },
    summary: { id: "summary", type: "string" },
    continuityNotes: { id: "continuityNotes", type: "string" },
  },
};

export const WORLD_BIBLE_EXTRACTION_CONTRACT: PromptContract<WorldBibleExtractionInput, import("@dramaflow/shared").WorldBibleContent> = {
  id: "world_bible.extract.v1",
  version: "1.0.0",
  task: "Extract a world bible from source text and adaptation plan.",
  outputKind: "json",
  schema: worldBibleSchema,
  render: (input) => ({
    system: "You are a story analyst. Always return strict JSON.",
    user: renderPromptSections({
      task: "Extract the project world bible from the adaptation plan and source text.",
      rules: [
        "Return strict JSON only.",
        "Extract named characters, physical appearance, personality, and tags.",
        "Extract named locations and production-useful descriptions.",
        "If a field is unknown, use an empty string or empty array.",
      ],
      projectContext: input.adaptationPlan,
      sourceContent: input.sourceText.slice(0, 16000),
      outputSchema: 'JSON object: { "characters": [{ "id": "char-N", "name": string, "appearance": string, "personality": string, "tags": string[], "referenceImages": [], "sortOrder": number }], "locations": [{ "id": "loc-N", "name": string, "description": string, "referenceImages": [], "sortOrder": number }], "styleGuide": { "visualStyle": string } }',
      qualityBar: ["Prefer stable IDs.", "Do not invent locations unsupported by the text."],
    }),
    metadata: {
      contractId: "world_bible.extract.v1",
      contractVersion: "1.0.0",
      inputSummary: summarizePromptInput({ adaptationPlan: input.adaptationPlan.slice(0, 200), sourceLength: input.sourceText.length }),
    },
  }),
  validate: (output) => normalizeWorldBibleContent(output),
};

export const NOVEL_CHUNK_SCENES_CONTRACT: PromptContract<NovelChunkScenesInput, { scenes: import("@dramaflow/shared").ScriptScene[]; summary: string; continuityNotes: string }> = {
  id: "novel.chunk_to_scenes.v1",
  version: "1.0.0",
  task: "Adapt a novel chunk into short drama script scenes.",
  outputKind: "json",
  schema: novelChunkScenesSchema,
  render: (input) => ({
    system: "You are a screenplay development assistant. Always return strict JSON.",
    user: renderPromptSections({
      task: `Convert novel chunk ${input.chunkIndex + 1} into short-drama scenes.`,
      rules: [
        "Return strict JSON only.",
        "Do not summarize instead of writing scenes.",
        "Keep continuity with previous summary and future hints.",
        "Extract dialogue as speaker and line pairs.",
      ],
      projectContext: [
        `Adaptation plan:\n${input.adaptationPlan}`,
        `World bible:\n${input.worldBibleContext}`,
        input.previousSummary ? `Previous summary:\n${input.previousSummary}` : "",
        input.futureHints ? `Future hints:\n${input.futureHints}` : "",
      ].filter(Boolean).join("\n\n"),
      sourceContent: input.chunkText,
      outputSchema: 'JSON object: { "scenes": [{ "id": "scene-N", "heading": string, "synopsis": string, "characters": string[], "dialogue": [{ "speaker": string, "line": string }], "directorNote": string }], "summary": string, "continuityNotes": string }',
      qualityBar: ["Scenes should be shootable.", "Summary should be 2-3 sentences.", "Continuity notes should help the next chunk."],
    }),
    metadata: {
      contractId: "novel.chunk_to_scenes.v1",
      contractVersion: "1.0.0",
      inputSummary: summarizePromptInput({ chunkIndex: input.chunkIndex, chunkLength: input.chunkText.length }),
    },
  }),
};
