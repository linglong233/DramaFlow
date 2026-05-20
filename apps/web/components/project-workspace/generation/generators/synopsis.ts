/**
 * @fileoverview 大纲生成器配置
 * @module web/components/project-workspace/generation/generators
 */

import type { GeneratorConfig } from "../generator-registry";

export const synopsisConfig: GeneratorConfig = {
  id: "synopsis",
  labelKey: "projectWorkspace.generate.synopsisLabel",
  hintKey: "synopsisGeneration.description",
  modes: ["quick", "conversational", "novelImport"],
  outputType: "text",
  streamEndpoint: "", // set dynamically via buildPayload path
  quickFields: [
    { key: "title", labelKey: "synopsisGeneration.titleLabel", type: "text", placeholderKey: "synopsisGeneration.titlePlaceholder", required: true },
    { key: "genre", labelKey: "synopsisGeneration.genreLabel", type: "text", placeholderKey: "synopsisGeneration.genrePlaceholder", required: true },
    { key: "theme", labelKey: "synopsisGeneration.themeLabel", type: "text", placeholderKey: "synopsisGeneration.themePlaceholder", required: true },
    { key: "keywords", labelKey: "synopsisGeneration.keywordsLabel", type: "text", placeholderKey: "synopsisGeneration.keywordsPlaceholder" },
    { key: "episodeCount", labelKey: "synopsisGeneration.episodeCountLabel", type: "number", min: 1, max: 30 },
    { key: "constraints", labelKey: "synopsisGeneration.constraintsLabel", type: "textarea", placeholderKey: "synopsisGeneration.constraintsPlaceholder", rows: 2, fullWidth: true },
  ],
  sourcePicker: undefined,
  conversationalDimensions: [
    "coreConflict",
    "protagonist",
    "supportingChars",
    "tone",
    "pacing",
    "constraints",
  ],
  buildPayload(values, { llmConfigSource }) {
    return {
      title: values.title ?? "",
      genre: values.genre ?? "",
      theme: values.theme ?? "",
      keywords: String(values.keywords ?? "")
        .split(",")
        .map((k: string) => k.trim())
        .filter(Boolean),
      episodeCount: Number(values.episodeCount) || 3,
      constraints: values.constraints || undefined,
      llmConfigSource,
    };
  },
};

synopsisConfig.streamEndpoint = "/synopsis-jobs/stream";
