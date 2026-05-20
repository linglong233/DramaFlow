/**
 * @fileoverview 生成器宿主组件
 * @module web/components/project-workspace/generation
 *
 * 根据当前文档类型查注册表，渲染模式切换 + SourcePicker + 对应生成器。
 */

"use client";

import { useState } from "react";
import type { LlmConfigSource, ProjectWorkspacePayload } from "@dramaflow/shared";

import { useI18n } from "../../../lib/i18n";
import { getGeneratorConfig, type GeneratorId, type GenerationMode } from "./generator-registry";
import { QuickGenerator } from "./quick-generator";
import { ConversationalGenerator } from "./conversational-generator";
import { NovelImportGenerator } from "./novel-import-generator";

interface Props {
  generatorId: GeneratorId;
  projectId: string;
  project: ProjectWorkspacePayload;
}

export function GeneratorHost({ generatorId, projectId, project }: Props) {
  const { t } = useI18n();
  const config = getGeneratorConfig(generatorId);

  const availableModes = config.modes;
  const [mode, setMode] = useState<GenerationMode>(availableModes[0]);
  const [llmConfigSource, setLlmConfigSource] = useState<LlmConfigSource>("team");

  const showModeToggle = availableModes.length > 1;

  return (
    <div className="gen-root">
      <div className="gen-mode-bar">
        {showModeToggle && (
          <div className="gen-toggle-group">
            {availableModes.map((m) => (
              <button
                key={m}
                className={`gen-toggle${mode === m ? " gen-toggle--on" : ""}`}
                type="button"
                onClick={() => setMode(m)}
              >
                {m === "quick" ? t("projectWorkspace.generate.quickMode")
                  : m === "conversational" ? t("projectWorkspace.generate.conversationalMode")
                  : "小说导入"}
              </button>
            ))}
          </div>
        )}
        <div className="gen-toggle-group">
          <button
            className={`gen-toggle${llmConfigSource === "team" ? " gen-toggle--on" : ""}`}
            type="button"
            onClick={() => setLlmConfigSource("team")}
          >
            {t("projectWorkspace.generate.llmConfigSourceTeam")}
          </button>
          <button
            className={`gen-toggle${llmConfigSource === "personal" ? " gen-toggle--on" : ""}`}
            type="button"
            onClick={() => setLlmConfigSource("personal")}
          >
            {t("projectWorkspace.generate.llmConfigSourcePersonal")}
          </button>
        </div>
      </div>

      {mode === "novelImport" && availableModes.includes("novelImport") ? (
        <NovelImportGenerator
          config={config}
          projectId={projectId}
          project={project}
          llmConfigSource={llmConfigSource}
        />
      ) : mode === "conversational" && availableModes.includes("conversational") ? (
        <ConversationalGenerator
          config={config}
          projectId={projectId}
          project={project}
          llmConfigSource={llmConfigSource}
        />
      ) : (
        <QuickGenerator
          config={config}
          projectId={projectId}
          project={project}
          llmConfigSource={llmConfigSource}
        />
      )}
    </div>
  );
}
