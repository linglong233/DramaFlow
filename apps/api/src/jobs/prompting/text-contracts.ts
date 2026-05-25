/** @fileoverview 脚本与分镜提示词契约 */
import type {
  GenerateScriptInput,
  GenerateStoryboardInput,
  ScriptContent,
  StoryboardContent,
} from "@dramaflow/shared";
import { normalizeScriptContent, normalizeStoryboardContent } from "@dramaflow/shared";
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
