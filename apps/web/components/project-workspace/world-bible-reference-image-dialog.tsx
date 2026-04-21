/**
 * @fileoverview 世界观参考图生成对话框
 * @module web/components/project-workspace
 *
 * 通过 AI 为世界观要素生成参考图片的对话框。
 */

"use client";

import { useState } from "react";
import type {
  ImageConfigSource,
  WorldBibleReferenceImageGenerateRequest,
  WorldBibleReferenceImageGenerateResponse,
} from "@dramaflow/shared";
import { apiFetch } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { ProviderSelector, useProviderEntries } from "./provider-selector";

type DialogStatus = "editing" | "generating" | "preview" | "error";

interface WorldBibleReferenceImageDialogProps {
  generatePath: string;
  initialPrompt: string;
  onImageGenerated: (assetUrl: string) => void;
  onClose: () => void;
  teamId?: string;
}

export function WorldBibleReferenceImageDialog({
  generatePath,
  initialPrompt,
  onImageGenerated,
  onClose,
  teamId,
}: WorldBibleReferenceImageDialogProps) {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [configSource, setConfigSource] = useState<ImageConfigSource>("team");
  const [selectedImageProvider, setSelectedImageProvider] = useState<string | undefined>();
  const [status, setStatus] = useState<DialogStatus>("editing");

  const providerEntries = useProviderEntries(configSource, teamId);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      return;
    }

    setStatus("generating");
    setError(null);

    try {
      const body: WorldBibleReferenceImageGenerateRequest = {
        prompt: prompt.trim(),
        configSource,
        providerId: selectedImageProvider,
      };
      const data = await apiFetch<WorldBibleReferenceImageGenerateResponse>(
        generatePath.startsWith("/") ? generatePath : `/${generatePath}`,
        {
          method: "POST",
          body,
        },
      );
      setPreviewUrl(data.assetUrl);
      setStatus("preview");
    } catch (error) {
      setError(error instanceof Error ? error.message : t("worldBible.generateRefImageFailed"));
      setStatus("error");
    }
  };

  const handleUseImage = () => {
    if (!previewUrl) {
      return;
    }

    onImageGenerated(previewUrl);
    onClose();
  };

  return (
    <div
      className="dialog-overlay"
      onClick={(event) => event.target === event.currentTarget && status !== "generating" && onClose()}
    >
      <div className="dialog-content dialog-content--sm">
        <div className="dialog-header">
          <h3 className="dialog-title">{t("worldBible.generateRefImageTitle")}</h3>
          {status !== "generating" && (
            <button className="dialog-close" onClick={onClose}>
              &times;
            </button>
          )}
        </div>

        <div className="dialog-body">
          <div style={{ marginBottom: 12 }}>
            <label className="wb-form__label" style={{ display: "block", marginBottom: 4 }}>
              {t("worldBible.generateRefImageConfigLabel")}
            </label>
            <select
              className="input wb-form__input"
              value={configSource}
              onChange={(event) => setConfigSource(event.target.value as ImageConfigSource)}
              disabled={status === "generating"}
            >
              <option value="team">{t("worldBible.generateRefImageConfigTeam")}</option>
              <option value="personal">{t("worldBible.generateRefImageConfigPersonal")}</option>
            </select>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label className="wb-form__label" style={{ display: "block", marginBottom: 4 }}>
              {"Provider"}
            </label>
            <ProviderSelector
              type="image"
              providers={providerEntries.imageProviders}
              defaultProviderId={providerEntries.defaultImageProvider}
              value={selectedImageProvider}
              onChange={setSelectedImageProvider}
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label className="wb-form__label" style={{ display: "block", marginBottom: 4 }}>
              {t("worldBible.generateRefImagePromptLabel")}
            </label>
            <textarea
              className="input wb-form__textarea"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={4}
              disabled={status === "generating"}
            />
          </div>

          {error && (
            <div style={{ color: "var(--danger-text, #f87171)", marginBottom: 12 }}>
              {error}
            </div>
          )}

          {status === "preview" && previewUrl && (
            <div style={{ marginBottom: 12 }}>
              <img
                src={previewUrl}
                alt="Generated reference"
                style={{
                  width: "100%",
                  borderRadius: "var(--radius-sm, 6px)",
                  maxHeight: 300,
                  objectFit: "contain",
                }}
              />
            </div>
          )}
        </div>

        <div className="dialog-footer">
          {status === "editing" || status === "error" ? (
            <>
              <button className="btn btn-secondary" onClick={onClose}>
                {t("common.cancel")}
              </button>
              <button
                className="btn btn-primary"
                onClick={handleGenerate}
                disabled={!prompt.trim()}
              >
                {t("worldBible.generateRefImageGenerate")}
              </button>
            </>
          ) : status === "generating" ? (
            <button className="btn btn-primary" disabled>
              {t("worldBible.generateRefImageGenerating")}
            </button>
          ) : status === "preview" ? (
            <>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setStatus("editing");
                  setPreviewUrl(null);
                }}
              >
                {t("worldBible.generateRefImageRegenerate")}
              </button>
              <button className="btn btn-primary" onClick={handleUseImage}>
                {t("worldBible.generateRefImageUseThis")}
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
