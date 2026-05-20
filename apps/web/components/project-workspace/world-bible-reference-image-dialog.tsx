"use client";

import { useState, useCallback } from "react";
import type {
  EnhanceReferencePromptRequest,
  EnhanceReferencePromptResponse,
  ImageConfigSource,
  WorldBibleReferenceImageGenerateRequest,
  WorldBibleReferenceImageGenerateResponse,
} from "@dramaflow/shared";
import { apiFetch } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { ProviderSelector, useProviderEntries } from "./provider-selector";

type DialogStatus =
  | "editing"
  | "enhancing"
  | "generating"
  | "reviewing"
  | "iterating";

interface GeneratedImage {
  assetUrl: string;
  assetId: string;
  prompt: string;
  status: "loading" | "done" | "error";
  error?: string;
}

interface GenerationRound {
  id: number;
  images: GeneratedImage[];
  referenceImageAssetId?: string;
}

interface Props {
  generatePath: string;
  enhancePath: string;
  initialPrompt: string;
  onImageGenerated: (assetUrl: string) => void;
  onClose: () => void;
  teamId?: string;
  worldBibleType: "character" | "location" | "styleGuide";
}

export function WorldBibleReferenceImageDialog({
  generatePath,
  enhancePath,
  initialPrompt,
  onImageGenerated,
  onClose,
  teamId,
  worldBibleType,
}: Props) {
  const { t } = useI18n();

  const [prompt, setPrompt] = useState("");
  const [promptInitialized, setPromptInitialized] = useState(false);
  const [negativePrompt, setNegativePrompt] = useState("");

  const [llmConfigSource, setLlmConfigSource] = useState<ImageConfigSource>("team");
  const [imageConfigSource, setImageConfigSource] = useState<ImageConfigSource>("team");
  const [selectedImageProvider, setSelectedImageProvider] = useState<string | undefined>();
  const [genCount, setGenCount] = useState(4);
  const [referenceImageAssetId, setReferenceImageAssetId] = useState<string | undefined>();
  const [referenceImageLabel, setReferenceImageLabel] = useState<string>("");

  const [status, setStatus] = useState<DialogStatus>("editing");
  const [rounds, setRounds] = useState<GenerationRound[]>([]);
  const [activeRoundId, setActiveRoundId] = useState(0);
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(null);

  const imageProviders = useProviderEntries(imageConfigSource, teamId);

  // Auto-fill prompt only when empty and dialog first opens
  if (initialPrompt && !promptInitialized && !prompt) {
    setPrompt(initialPrompt);
    setPromptInitialized(true);
  }

  const activeRound = rounds.find((r) => r.id === activeRoundId);
  const isBusy = status === "generating" || status === "enhancing";

  const handleEnhancePrompt = useCallback(async () => {
    if (!prompt.trim()) return;
    setStatus("enhancing");
    try {
      const body: EnhanceReferencePromptRequest = {
        prompt: prompt.trim(),
        type: worldBibleType,
        configSource: llmConfigSource,
      };
      const path = enhancePath.startsWith("/") ? enhancePath : `/${enhancePath}`;
      const data = await apiFetch<EnhanceReferencePromptResponse>(path, {
        method: "POST",
        body,
      });
      setPrompt(data.enhancedPrompt);
    } catch {
      // Keep original prompt on failure
    } finally {
      setStatus("editing");
    }
  }, [prompt, worldBibleType, llmConfigSource, enhancePath]);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;

    const roundId = (rounds.length > 0 ? rounds[rounds.length - 1].id + 1 : 1);
    const images: GeneratedImage[] = Array.from({ length: genCount }, () => ({
      assetUrl: "",
      assetId: "",
      prompt: prompt.trim(),
      status: "loading",
    }));

    const newRound: GenerationRound = {
      id: roundId,
      images,
      referenceImageAssetId,
    };

    setRounds((prev) => [...prev, newRound].slice(-3));
    setActiveRoundId(roundId);
    setSelectedImageIndex(null);
    setStatus("generating");

    const resolvedPath = generatePath.startsWith("/") ? generatePath : `/${generatePath}`;

    await Promise.allSettled(
      images.map(async (_, index) => {
        try {
          const body: WorldBibleReferenceImageGenerateRequest = {
            prompt: prompt.trim(),
            configSource: imageConfigSource,
            providerId: selectedImageProvider,
            referenceImageAssetId,
            negativePrompt: negativePrompt.trim() || undefined,
          };
          const data = await apiFetch<WorldBibleReferenceImageGenerateResponse>(resolvedPath, {
            method: "POST",
            body,
          });
          setRounds((prev) =>
            prev.map((r) =>
              r.id === roundId
                ? {
                    ...r,
                    images: r.images.map((img, i) =>
                      i === index
                        ? {
                            ...img,
                            assetUrl: data.assetUrl,
                            assetId: data.assetId,
                            status: "done" as const,
                            prompt: data.prompt,
                          }
                        : img,
                    ),
                  }
                : r,
            ),
          );
        } catch (err) {
          setRounds((prev) =>
            prev.map((r) =>
              r.id === roundId
                ? {
                    ...r,
                    images: r.images.map((img, i) =>
                      i === index
                        ? {
                            ...img,
                            status: "error" as const,
                            error: err instanceof Error ? err.message : "Failed",
                          }
                        : img,
                    ),
                  }
                : r,
            ),
          );
        }
      }),
    );

    setStatus("reviewing");
  }, [
    prompt, genCount, rounds, generatePath, imageConfigSource,
    selectedImageProvider, referenceImageAssetId, negativePrompt,
  ]);

  const handleUseImage = useCallback(
    (imageUrl: string) => {
      onImageGenerated(imageUrl);
      onClose();
    },
    [onImageGenerated, onClose],
  );

  const handleIterate = useCallback((image: GeneratedImage) => {
    setReferenceImageAssetId(image.assetId);
    setReferenceImageLabel("候选图");
    setStatus("iterating");
  }, []);

  const handleResetPrompt = useCallback(() => {
    setPrompt(initialPrompt);
    setPromptInitialized(false);
  }, [initialPrompt]);

  return (
    <div
      className="dialog-overlay"
      onClick={(e) => e.target === e.currentTarget && !isBusy && onClose()}
    >
      <div className="dialog-content dialog-content--ref-gen">
        {/* Header */}
        <div className="dialog-header">
          <h3 className="dialog-title">{t("worldBible.generateRefImageTitle")}</h3>
          {!isBusy && (
            <button className="dialog-close" onClick={onClose}>
              ×
            </button>
          )}
        </div>

        {/* Split body */}
        <div className="dialog-body--split">
          {/* LEFT: Editing panel */}
          <div className="ref-gen-panel-left">
            {/* Prompt section */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <label className="wb-form__label">Prompt</label>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    className="btn btn-primary"
                    style={{ padding: "3px 10px", fontSize: 11 }}
                    onClick={handleEnhancePrompt}
                    disabled={isBusy || !prompt.trim()}
                  >
                    AI 增强
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: "3px 10px", fontSize: 11 }}
                    onClick={handleResetPrompt}
                    disabled={isBusy}
                  >
                    重置
                  </button>
                </div>
              </div>
              <textarea
                className="input wb-form__textarea"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                disabled={isBusy}
              />
              <details style={{ marginTop: 2 }}>
                <summary className="wb-form__label" style={{ cursor: "pointer" }}>
                  负面 Prompt（可选）
                </summary>
                <textarea
                  className="input wb-form__textarea"
                  value={negativePrompt}
                  onChange={(e) => setNegativePrompt(e.target.value)}
                  rows={2}
                  placeholder="不希望出现的元素..."
                  disabled={isBusy}
                  style={{ marginTop: 4 }}
                />
              </details>
            </div>

            {/* Config section */}
            <div className="ref-gen-config">
              {/* LLM row */}
              <div className="ref-gen-config-row">
                <label className="wb-form__label" style={{ minWidth: 52 }}>LLM</label>
                <select
                  className="input"
                  style={{ width: 72, height: 36, fontSize: 12, padding: "0 8px" }}
                  value={llmConfigSource}
                  onChange={(e) => setLlmConfigSource(e.target.value as ImageConfigSource)}
                  disabled={isBusy}
                >
                  <option value="team">团队</option>
                  <option value="personal">个人</option>
                </select>
                <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>使用已配置的文本模型</span>
              </div>

              {/* Image provider row */}
              <div className="ref-gen-config-row">
                <label className="wb-form__label" style={{ minWidth: 52 }}>图片</label>
                <select
                  className="input"
                  style={{ width: 72, height: 36, fontSize: 12, padding: "0 8px" }}
                  value={imageConfigSource}
                  onChange={(e) => setImageConfigSource(e.target.value as ImageConfigSource)}
                  disabled={isBusy}
                >
                  <option value="team">团队</option>
                  <option value="personal">个人</option>
                </select>
                <ProviderSelector
                  type="image"
                  providers={imageProviders.imageProviders}
                  defaultProviderId={imageProviders.defaultImageProvider}
                  value={selectedImageProvider}
                  onChange={setSelectedImageProvider}
                />
              </div>

              {/* Count + Reference row */}
              <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 8, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <label className="wb-form__label">数量</label>
                  <select
                    className="input"
                    style={{ width: 48, height: 36, fontSize: 12, padding: "0 8px" }}
                    value={genCount}
                    onChange={(e) => setGenCount(Number(e.target.value))}
                    disabled={isBusy}
                  >
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={4}>4</option>
                  </select>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <label className="wb-form__label">参考图</label>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: "3px 10px", fontSize: 11 }}
                    onClick={() => {
                      if (referenceImageAssetId) {
                        setReferenceImageAssetId(undefined);
                        setReferenceImageLabel("");
                      }
                    }}
                    disabled={isBusy}
                  >
                    {referenceImageAssetId ? `清除 (${referenceImageLabel})` : "未选择"}
                  </button>
                </div>
              </div>
            </div>

            {/* Iteration history */}
            {rounds.length > 0 && (
              <div className="ref-gen-history">
                <span className="wb-form__label">历史</span>
                {rounds.map((round) => (
                  <button
                    key={round.id}
                    className={`ref-gen-history-chip ${round.id === activeRoundId ? "ref-gen-history-chip--active" : ""}`}
                    onClick={() => setActiveRoundId(round.id)}
                  >
                    R{round.id}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* RIGHT: Image grid panel */}
          <div className="ref-gen-panel-right">
            {activeRound ? (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="wb-form__label">
                    候选图 ({activeRound.images.filter((i) => i.status === "done").length}/{activeRound.images.length})
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>点击选择 · 双击放大</span>
                </div>
                <div className="ref-gen-grid">
                  {activeRound.images.map((image, index) => (
                    <div
                      key={index}
                      className={`ref-gen-cell ${
                        image.status === "loading"
                          ? "ref-gen-cell--loading"
                          : image.status === "error"
                          ? "ref-gen-cell--error"
                          : selectedImageIndex === index
                          ? "ref-gen-cell--selected"
                          : ""
                      }`}
                      onClick={() => image.status === "done" && setSelectedImageIndex(index)}
                    >
                      {image.status === "loading" && (
                        <>
                          <div className="ref-gen-skeleton" />
                          <svg
                            width="24" height="24" viewBox="0 0 24 24"
                            fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2"
                            style={{ position: "relative", zIndex: 1, animation: "ref-gen-spin 1s linear infinite" }}
                          >
                            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                          </svg>
                        </>
                      )}
                      {image.status === "error" && (
                        <div style={{ textAlign: "center", color: "var(--danger-text)", fontSize: 12, padding: 8 }}>
                          <div>生成失败</div>
                          <button
                            className="btn btn-secondary"
                            style={{ fontSize: 10, padding: "2px 8px", marginTop: 4 }}
                          >
                            重试
                          </button>
                        </div>
                      )}
                      {image.status === "done" && (
                        <>
                          <img
                            src={image.assetUrl}
                            alt={`Candidate ${index + 1}`}
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          />
                          {selectedImageIndex === index && (
                            <div className="ref-gen-cell__check">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--bg-base)" strokeWidth="3">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            </div>
                          )}
                          <div className="ref-gen-cell__actions">
                            <button className="btn btn-primary" onClick={(e) => { e.stopPropagation(); handleUseImage(image.assetUrl); }}>
                              使用
                            </button>
                            <button className="btn btn-secondary" onClick={(e) => { e.stopPropagation(); handleIterate(image); }}>
                              迭代
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="ref-gen-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                <div>点击下方「生成」开始创建参考图</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.25)" }}>支持多张候选 · 选择后可迭代优化</div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={isBusy}>
            {t("common.cancel")}
          </button>
          {activeRound && status === "reviewing" && (
            <button className="btn btn-secondary" onClick={handleGenerate} disabled={isBusy}>
              重新生成
            </button>
          )}
          {activeRound && selectedImageIndex !== null && status === "reviewing" && (
            <button
              className="btn btn-primary"
              onClick={() => {
                const img = activeRound.images[selectedImageIndex];
                if (img?.status === "done") handleUseImage(img.assetUrl);
              }}
            >
              使用选中
            </button>
          )}
          {(status === "editing" || status === "iterating") && (
            <button className="btn btn-primary" onClick={handleGenerate} disabled={isBusy || !prompt.trim()}>
              生成
            </button>
          )}
          {isBusy && (
            <button className="btn btn-primary" disabled>
              {status === "enhancing" ? "增强中..." : "生成中..."}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
