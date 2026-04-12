"use client";

import { useState } from "react";
import type { CharacterProfile } from "@dramaflow/shared";
import { useI18n } from "../../lib/i18n";
import { apiFetch } from "../../lib/api";

interface CharacterImageGenDialogProps {
  character: CharacterProfile;
  projectId: string;
  onImageGenerated: (assetUrl: string) => void;
  onClose: () => void;
}

export function CharacterImageGenDialog({
  character,
  projectId,
  onImageGenerated,
  onClose,
}: CharacterImageGenDialogProps) {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState(character.appearance || "");
  const [configSource, setConfigSource] = useState<"team" | "personal">("team");
  const [status, setStatus] = useState<"editing" | "generating" | "preview" | "error">("editing");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setStatus("generating");
    setError(null);
    try {
      const data = await apiFetch<{ assetUrl: string }>(
        `projects/${projectId}/world-bible/characters/${character.id}/generate-reference-image`,
        {
          method: "POST",
          body: { prompt: prompt.trim(), configSource },
        },
      );
      setPreviewUrl(data.assetUrl);
      setStatus("preview");
    } catch (err: any) {
      setError(err.message || t("worldBible.generateRefImageFailed"));
      setStatus("error");
    }
  };

  const handleUseImage = () => {
    if (previewUrl) {
      onImageGenerated(previewUrl);
      onClose();
    }
  };

  return (
    <div className="dialog-overlay" onClick={(e) => e.target === e.currentTarget && status !== "generating" && onClose()}>
      <div className="dialog-content dialog-content--sm">
        <div className="dialog-header">
          <h3 className="dialog-title">{t("worldBible.generateRefImageTitle")}</h3>
          {status !== "generating" && (
            <button className="dialog-close" onClick={onClose}>&times;</button>
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
              onChange={(e) => setConfigSource(e.target.value as "team" | "personal")}
              disabled={status === "generating"}
            >
              <option value="team">{t("worldBible.generateRefImageConfigTeam")}</option>
              <option value="personal">{t("worldBible.generateRefImageConfigPersonal")}</option>
            </select>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label className="wb-form__label" style={{ display: "block", marginBottom: 4 }}>
              {t("worldBible.generateRefImagePromptLabel")}
            </label>
            <textarea
              className="input wb-form__textarea"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
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
                style={{ width: "100%", borderRadius: "var(--radius-sm, 6px)", maxHeight: 300, objectFit: "contain" }}
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
              <button className="btn btn-secondary" onClick={() => { setStatus("editing"); setPreviewUrl(null); }}>
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
