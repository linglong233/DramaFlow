/**
 * @fileoverview 剧本生成器配置
 * @module web/components/project-workspace/generation/generators
 */

import type { GeneratorConfig } from "../generator-registry";

export const scriptConfig: GeneratorConfig = {
  id: "script",
  labelKey: "projectWorkspace.generate.scriptLabel",
  modes: ["quick", "conversational", "novelImport"],
  outputType: "script",
  streamEndpoint: "/script-jobs/stream",
  quickFields: [
    { key: "title", labelKey: "projectWorkspace.sidebar.scriptTitleLabel", type: "text", placeholderKey: "projectWorkspace.sidebar.scriptTitlePlaceholder", required: true },
    { key: "genre", labelKey: "projectWorkspace.sidebar.genreLabel", type: "text", placeholderKey: "projectWorkspace.sidebar.genrePlaceholder", required: true },
    { key: "premise", labelKey: "projectWorkspace.sidebar.premiseLabel", type: "textarea", placeholderKey: "projectWorkspace.sidebar.premisePlaceholder", rows: 3, fullWidth: true, required: true },
    { key: "episodeGoal", labelKey: "projectWorkspace.sidebar.episodeGoalLabel", type: "text", placeholderKey: "projectWorkspace.sidebar.episodeGoalPlaceholder" },
    { key: "tone", labelKey: "projectWorkspace.sidebar.toneLabel", type: "text", placeholderKey: "projectWorkspace.sidebar.tonePlaceholder" },
    { key: "audience", labelKey: "projectWorkspace.sidebar.audienceLabel", type: "text", placeholderKey: "projectWorkspace.sidebar.audiencePlaceholder" },
  ],
  sourcePicker: {
    sourceType: "synopsis",
    labelKey: "projectWorkspace.generate.sourceSynopsisLabel",
    emptyHintKey: "projectWorkspace.generate.noSynopsisYet",
  },
  conversationalDimensions: [
    "coreConflict",
    "protagonist",
    "supportingChars",
    "tone",
    "pacing",
    "constraints",
  ],
  buildPayload(values, { llmConfigSource, sourceVersionId }) {
    return {
      title: values.title ?? "",
      genre: values.genre ?? "",
      premise: values.premise ?? "",
      episodeGoal: values.episodeGoal ?? "",
      tone: values.tone ?? "",
      audience: values.audience ?? "",
      llmConfigSource,
      sourceSynopsisVersionId: sourceVersionId || undefined,
    };
  },
};
