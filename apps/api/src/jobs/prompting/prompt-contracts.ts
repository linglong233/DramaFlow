export type PromptOutputKind = "plain_text" | "json";

export type PromptSchemaType = "string" | "number" | "boolean" | "object" | "array";

export interface PromptJsonSchema {
  id: string;
  type: PromptSchemaType;
  required?: string[];
  properties?: Record<string, PromptJsonSchema>;
  items?: PromptJsonSchema;
  enum?: string[];
}

export interface RenderedPrompt {
  system: string;
  user: string;
  metadata: {
    contractId: string;
    contractVersion: string;
    inputSummary: string;
  };
}

export interface PromptContract<TInput, TOutput> {
  id: string;
  version: string;
  task: string;
  outputKind: PromptOutputKind;
  schema?: PromptJsonSchema;
  render: (input: TInput) => RenderedPrompt;
  validate?: (output: unknown) => TOutput;
}

export interface PromptSnapshot {
  contractId: string;
  contractVersion: string;
  provider?: string;
  model?: string;
  renderedSystemPrompt?: string;
  renderedUserPrompt?: string;
  inputSummary: string;
  schemaVersion?: string;
  outputValidation?: {
    ok: boolean;
    errors: string[];
  };
}

export function createPromptSnapshot(input: PromptSnapshot): PromptSnapshot {
  return {
    contractId: input.contractId,
    contractVersion: input.contractVersion,
    provider: input.provider,
    model: input.model,
    renderedSystemPrompt: input.renderedSystemPrompt,
    renderedUserPrompt: input.renderedUserPrompt,
    inputSummary: input.inputSummary,
    schemaVersion: input.schemaVersion,
    outputValidation: input.outputValidation
      ? { ok: input.outputValidation.ok, errors: [...input.outputValidation.errors] }
      : undefined,
  };
}
