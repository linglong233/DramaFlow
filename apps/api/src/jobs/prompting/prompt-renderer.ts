/** @fileoverview 提示词段落渲染器与输入摘要工具 */
export interface PromptSections {
  task?: string;
  rules?: string[];
  projectContext?: string;
  sourceContent?: string;
  outputSchema?: string;
  qualityBar?: string[];
}

function renderBlock(name: string, value: string | string[] | undefined): string {
  if (!value || (Array.isArray(value) && value.length === 0)) return "";
  const body = Array.isArray(value)
    ? value.filter(Boolean).map((item) => `- ${item}`).join("\n")
    : value.trim();
  if (!body) return "";
  return `<${name}>\n${body}\n</${name}>`;
}

export function renderPromptSections(sections: PromptSections): string {
  return [
    renderBlock("task", sections.task),
    renderBlock("rules", sections.rules),
    renderBlock("project_context", sections.projectContext),
    renderBlock("source_content", sections.sourceContent),
    renderBlock("output_schema", sections.outputSchema),
    renderBlock("quality_bar", sections.qualityBar),
  ].filter(Boolean).join("\n\n");
}

export function summarizePromptInput(input: unknown): string {
  const raw = JSON.stringify(input);
  if (!raw) return "";
  return raw.length > 500 ? `${raw.slice(0, 497)}...` : raw;
}
