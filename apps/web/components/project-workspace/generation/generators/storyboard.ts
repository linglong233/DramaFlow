/**
 * @fileoverview 分镜生成器配置
 * @module web/components/project-workspace/generation/generators
 */

import type { GeneratorConfig } from "../generator-registry";

export const storyboardConfig: GeneratorConfig = {
  id: "storyboard",
  labelKey: "projectWorkspace.generate.storyboardLabel",
  hintKey: "projectWorkspace.generate.storyboardHint",
  modes: ["quick"],
  outputType: "storyboard",
  streamEndpoint: "/storyboard-jobs/stream",
  quickFields: [
    { key: "cinematicStyle", labelKey: "projectWorkspace.sidebar.cinematicStyleLabel", type: "textarea", placeholderKey: "projectWorkspace.sidebar.cinematicStylePlaceholder", rows: 3, fullWidth: true, required: true },
    {
      key: "shotDensity",
      labelKey: "projectWorkspace.sidebar.shotDensityLabel",
      type: "select",
      options: [
        { value: "sparse", labelKey: "enums.shotDensity.sparse" },
        { value: "balanced", labelKey: "enums.shotDensity.balanced" },
        { value: "dense", labelKey: "enums.shotDensity.dense" },
      ],
    },
  ],
  sourcePicker: {
    sourceType: "script",
    labelKey: "projectWorkspace.generate.sourceScriptLabel",
    emptyHintKey: "projectWorkspace.generate.noScriptYet",
  },
  buildPayload(values, { llmConfigSource, sourceVersionId, project }) {
    const storyboardDoc = project.documents.find((d) => d.type === "storyboard");
    return {
      documentId: storyboardDoc?.id ?? "",
      versionId: sourceVersionId ?? "",
      cinematicStyle: values.cinematicStyle ?? "",
      shotDensity: values.shotDensity ?? "balanced",
      llmConfigSource,
    };
  },
};
