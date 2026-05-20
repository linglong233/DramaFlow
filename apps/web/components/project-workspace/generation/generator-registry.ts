/**
 * @fileoverview 生成器注册表 — 类型定义与注册
 * @module web/components/project-workspace/generation
 *
 * 每种生成类型注册一份配置，定义字段、端点、支持的模式等。
 */

import type { ConversationDimension, LlmConfigSource, ProjectWorkspacePayload } from "@dramaflow/shared";

import { synopsisConfig } from "./generators/synopsis";
import { scriptConfig } from "./generators/script";
import { storyboardConfig } from "./generators/storyboard";

export type GeneratorId = "synopsis" | "script" | "storyboard";
export type GenerationMode = "quick" | "conversational" | "novelImport";

export interface FieldDef {
  key: string;
  labelKey: string;
  type: "text" | "textarea" | "number" | "select";
  placeholderKey?: string;
  required?: boolean;
  options?: { value: string; labelKey: string }[];
  rows?: number;
  fullWidth?: boolean;
  min?: number;
  max?: number;
}

export interface SourcePickerConfig {
  sourceType: string;
  labelKey: string;
  emptyHintKey: string;
}

export interface GeneratorConfig {
  id: GeneratorId;
  labelKey: string;
  hintKey?: string;
  modes: GenerationMode[];
  quickFields: FieldDef[];
  streamEndpoint: string;
  outputType: "text" | "script" | "storyboard";
  sourcePicker?: SourcePickerConfig;
  conversationalDimensions?: ConversationDimension[];
  buildPayload: (
    values: Record<string, unknown>,
    context: {
      llmConfigSource: LlmConfigSource;
      sourceVersionId?: string;
      project: ProjectWorkspacePayload;
    },
  ) => Record<string, unknown>;
}

export const generatorRegistry: Record<GeneratorId, GeneratorConfig> = {
  synopsis: synopsisConfig,
  script: scriptConfig,
  storyboard: storyboardConfig,
};

export function getGeneratorConfig(id: GeneratorId): GeneratorConfig {
  return generatorRegistry[id];
}
