/**
 * @fileoverview 个人设置面板
 * @module web/components
 *
 * 用户个人信息、LLM 和图片/视频 Provider 配置管理。
 */

"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ImageGenerationConfig,
  ImageGenerationProvider,
  LlmModelListResponse,
  LlmModelSummary,
  LlmProviderConfig,
  ProviderEntry,
  VideoGenerationProvider,
} from "@dramaflow/shared";

import { apiFetch, formatApiError } from "../lib/api";
import { useFeedback } from "../lib/hooks";
import {
  IMAGE_PROVIDER_LABELS,
  VIDEO_PROVIDER_LABELS,
  buildImageGenerationConfigPayload,
  buildProviderEntry,
  createImageProviderDraft,
  createVideoProviderDraft,
  migrateImageGenerationConfig,
  toImageGenerationConfigDraft,
  toProviderEntryDraft,
} from "../lib/image-config";
import type { ProviderEntryDraft } from "../lib/image-config";
import { useI18n } from "../lib/i18n";
import { buildLlmConfigPayload, toLlmConfigDraft } from "../lib/llm-config";
import { ErrorState } from "./error-state";
import { InlineFeedback } from "./inline-feedback";
import { LoadingSkeleton } from "./loading-skeleton";
import { ProviderEntryForm } from "./provider-entry-form";

interface ProfileSettingsResponse {
  displayName: string;
  llmConfig?: LlmProviderConfig;
  imageGenerationConfig?: ImageGenerationConfig;
  imageProviders?: ProviderEntry[];
  videoProviders?: ProviderEntry[];
  defaultImageProvider?: string;
  defaultVideoProvider?: string;
}

function UserIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="7" r="3.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 18c0-3.866 3.134-7 7-7s7 3.134 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function AiIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 2l2.5 5 5.5.8-4 3.9.9 5.3-4.9-2.6L5.1 17l.9-5.3-4-3.9 5.5-.8L10 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2.5" y="3.5" width="15" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="7" cy="8" r="1.5" fill="currentColor" />
      <path d="M4.5 14l3.8-3.8a1.2 1.2 0 011.697 0L12 12.203l1.05-1.05a1.2 1.2 0 011.697 0L16 12.406V14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2" y="4" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M14 8l4-2.5v9L14 12" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M1.5 7a5.5 5.5 0 019.81-3.39M12.5 7a5.5 5.5 0 01-9.81 3.39" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M11.5 1v3h-3M2.5 13v-3h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill={filled ? "currentColor" : "none"} aria-hidden="true" style={{ color: filled ? "var(--warning)" : "var(--text-tertiary)" }}>
      <path d="M8 1.5l1.85 3.75 4.15.6-3 2.93.71 4.12L8 10.87 4.29 12.9 5 8.78l-3-2.93 4.15-.6L8 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function ProfileSettingsPanel() {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [displayName, setDisplayName] = useState("");
  const [llmProvider, setLlmProvider] = useState<"openai-completions">("openai-completions");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmBaseUrl, setLlmBaseUrl] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [llmStreamEnabled, setLlmStreamEnabled] = useState(false);

  // --- Multi-provider state ---
  const [imageDrafts, setImageDrafts] = useState<ProviderEntryDraft[]>([]);
  const [videoDrafts, setVideoDrafts] = useState<ProviderEntryDraft[]>([]);
  const [defaultImageProvider, setDefaultImageProvider] = useState<string>("");
  const [defaultVideoProvider, setDefaultVideoProvider] = useState<string>("");
  const [selectedVideoProviderType, setSelectedVideoProviderType] = useState<VideoGenerationProvider>("grok");
  const [editingImageId, setEditingImageId] = useState<string | null>(null);
  const [editingVideoId, setEditingVideoId] = useState<string | null>(null);

  // Legacy image config state (kept for backward-compat on save)
  const [imageProvider, setImageProvider] = useState<ImageGenerationProvider>("google-gemini");
  const [imageApiKey, setImageApiKey] = useState("");
  const [imageBaseUrl, setImageBaseUrl] = useState("");
  const [imageModel, setImageModel] = useState("gemini-3.1-flash-image-preview");
  const [sdSamplerName, setSdSamplerName] = useState("DPM++ 2M Karras");
  const [sdSteps, setSdSteps] = useState(20);
  const [sdCfgScale, setSdCfgScale] = useState(7);
  const [sdClipSkip, setSdClipSkip] = useState(1);
  const [comfyuiWorkflowJson, setComfyuiWorkflowJson] = useState("");
  const [comfyuiSamplerName, setComfyuiSamplerName] = useState("euler");
  const [comfyuiSteps, setComfyuiSteps] = useState(20);
  const [comfyuiCfgScale, setComfyuiCfgScale] = useState(8);
  const [grokVideoModel, setGrokVideoModel] = useState("grok-imagine-1.0-video");
  const [grokAspectRatio, setGrokAspectRatio] = useState("16:9");
  const [grokVideoLength, setGrokVideoLength] = useState(6);
  const [grokResolution, setGrokResolution] = useState<"SD" | "HD">("HD");

  const [availableModels, setAvailableModels] = useState<LlmModelSummary[]>([]);
  const [hasFetchedModels, setHasFetchedModels] = useState(false);
  const [modelListError, setModelListError] = useState<string | null>(null);
  const { feedback, setFeedback } = useFeedback();

  const profileQuery = useQuery({
    queryKey: ["auth_me"],
    queryFn: () => apiFetch<ProfileSettingsResponse>("/auth/me"),
  });

  useEffect(() => {
    if (!profileQuery.data) return;

    const data = profileQuery.data;
    const llmDraft = toLlmConfigDraft(data.llmConfig);
    setDisplayName(data.displayName || "");
    setLlmProvider(llmDraft.provider);
    setLlmApiKey(llmDraft.apiKey);
    setLlmBaseUrl(llmDraft.baseUrl);
    setLlmModel(llmDraft.model);
    setLlmStreamEnabled(llmDraft.stream);

    // Load new multi-provider fields
    if (data.imageProviders && data.imageProviders.length > 0) {
      setImageDrafts(data.imageProviders.map(toProviderEntryDraft));
      setDefaultImageProvider(data.defaultImageProvider ?? "");
    } else {
      // Migrate from old config
      const migrated = migrateImageGenerationConfig(data.imageGenerationConfig);
      setImageDrafts(migrated.imageProviders.map(toProviderEntryDraft));
      setDefaultImageProvider(migrated.defaultImageProvider ?? "");
    }

    if (data.videoProviders && data.videoProviders.length > 0) {
      setVideoDrafts(data.videoProviders.map(toProviderEntryDraft));
      setDefaultVideoProvider(data.defaultVideoProvider ?? "");
    } else {
      const migrated = migrateImageGenerationConfig(data.imageGenerationConfig);
      setVideoDrafts(migrated.videoProviders.map(toProviderEntryDraft));
      setDefaultVideoProvider(migrated.defaultVideoProvider ?? "");
    }

    // Legacy image config (kept for backward-compat)
    const imageDraft = toImageGenerationConfigDraft(data.imageGenerationConfig);
    setImageProvider(imageDraft.provider);
    setImageApiKey(imageDraft.apiKey);
    setImageBaseUrl(imageDraft.baseUrl);
    setImageModel(imageDraft.model);
    setSdSamplerName(data.imageGenerationConfig?.sdConfig?.samplerName ?? "DPM++ 2M Karras");
    setSdSteps(data.imageGenerationConfig?.sdConfig?.steps ?? 20);
    setSdCfgScale(data.imageGenerationConfig?.sdConfig?.cfgScale ?? 7);
    setSdClipSkip(data.imageGenerationConfig?.sdConfig?.clipSkip ?? 1);
    setComfyuiWorkflowJson(data.imageGenerationConfig?.comfyuiConfig?.workflowJson ?? "");
    setComfyuiSamplerName(data.imageGenerationConfig?.comfyuiConfig?.samplerName ?? "euler");
    setComfyuiSteps(data.imageGenerationConfig?.comfyuiConfig?.steps ?? 20);
    setComfyuiCfgScale(data.imageGenerationConfig?.comfyuiConfig?.cfgScale ?? 8);
    setGrokVideoModel(data.imageGenerationConfig?.grokConfig?.videoModel ?? "grok-imagine-1.0-video");
    setGrokAspectRatio(data.imageGenerationConfig?.grokConfig?.aspectRatio ?? "16:9");
    setGrokVideoLength(data.imageGenerationConfig?.grokConfig?.videoLength ?? 6);
    setGrokResolution(data.imageGenerationConfig?.grokConfig?.resolution ?? "HD");
  }, [profileQuery.data]);

  useEffect(() => {
    setAvailableModels([]);
    setHasFetchedModels(false);
    setModelListError(null);
  }, [llmProvider, llmApiKey, llmBaseUrl]);

  const draftLlmConfig = buildLlmConfigPayload({
    provider: llmProvider,
    apiKey: llmApiKey,
    baseUrl: llmBaseUrl,
    model: llmModel,
    stream: llmStreamEnabled,
  }, profileQuery.data?.llmConfig);

  // Legacy image config payload (for backward-compat)
  const draftImageConfig: ImageGenerationConfig = {
    provider: imageProvider,
    apiKey: imageApiKey || undefined,
    baseUrl: imageBaseUrl || undefined,
    model: imageModel || undefined,
    ...(imageProvider === "stable-diffusion" ? {
      sdConfig: {
        samplerName: sdSamplerName || undefined,
        steps: sdSteps || undefined,
        cfgScale: sdCfgScale || undefined,
        clipSkip: sdClipSkip || undefined,
      }
    } : {}),
    ...(imageProvider === "comfyui" ? {
      comfyuiConfig: {
        workflowJson: comfyuiWorkflowJson || undefined,
        samplerName: comfyuiSamplerName || undefined,
        steps: comfyuiSteps || undefined,
        cfgScale: comfyuiCfgScale || undefined,
      }
    } : {}),
    ...(imageProvider === "grok" ? {
      grokConfig: {
        videoModel: grokVideoModel || undefined,
        aspectRatio: grokAspectRatio || undefined,
        videoLength: grokVideoLength || undefined,
        resolution: grokResolution || undefined,
      }
    } : {}),
  };

  // Build backward-compat imageGenerationConfig from the default image provider
  function buildLegacyImageConfig(): ImageGenerationConfig | undefined {
    const defaultDraft = imageDrafts.find((d) => d.id === defaultImageProvider);
    if (!defaultDraft) return buildImageGenerationConfigPayload(toImageGenerationConfigDraft(profileQuery.data?.imageGenerationConfig));
    return {
      provider: defaultDraft.provider as ImageGenerationProvider,
      ...(defaultDraft.apiKey.trim() ? { apiKey: defaultDraft.apiKey.trim() } : {}),
      ...(defaultDraft.baseUrl.trim() ? { baseUrl: defaultDraft.baseUrl.trim() } : {}),
      ...(defaultDraft.model.trim() ? { model: defaultDraft.model.trim() } : {}),
      ...(defaultDraft.provider === "stable-diffusion" && Object.values(defaultDraft.sdConfig as Record<string, unknown>).some((v) => v) ? { sdConfig: defaultDraft.sdConfig } : {}),
      ...(defaultDraft.provider === "comfyui" && Object.values(defaultDraft.comfyuiConfig as Record<string, unknown>).some((v) => v) ? { comfyuiConfig: defaultDraft.comfyuiConfig } : {}),
      ...(defaultDraft.provider === "grok" && Object.values(defaultDraft.grokConfig as Record<string, unknown>).some((v) => v) ? { grokConfig: defaultDraft.grokConfig } : {}),
    };
  }

  const updateMutation = useMutation({
    mutationFn: () => {
      const imageEntries = imageDrafts.map(buildProviderEntry);
      const videoEntries = videoDrafts.map(buildProviderEntry);
      return apiFetch("/auth/me", {
        method: "PATCH",
        body: {
          displayName,
          llmConfig: draftLlmConfig,
          imageGenerationConfig: buildLegacyImageConfig(),
          imageProviders: imageEntries,
          videoProviders: videoEntries,
          defaultImageProvider,
          defaultVideoProvider,
        },
      });
    },
    onSuccess: async () => {
      setFeedback({ message: t("settingsPages.profileSettings.saveSuccess"), error: null });
      await queryClient.invalidateQueries({ queryKey: ["auth_me"] });
    },
    onError: (error) => setFeedback({ message: null, error: formatApiError(error, t, "settingsPages.profileSettings.saveError") }),
  });

  const loadModelsMutation = useMutation({
    mutationFn: () => apiFetch<LlmModelListResponse>("/auth/me/llm-models", {
      method: "POST",
      body: { llmConfig: draftLlmConfig },
    }),
    onMutate: () => setModelListError(null),
    onSuccess: (payload) => {
      setAvailableModels(payload.models);
      setHasFetchedModels(true);
      setModelListError(null);
    },
    onError: (error) => setModelListError(formatApiError(error, t, "settingsPages.profileSettings.llmLoadModelsError")),
  });

  const selectedCatalogModel = availableModels.some((model) => model.id === llmModel) ? llmModel : "";

  // --- Provider list management helpers ---
  function addImageProvider() {
    const draft = createImageProviderDraft();
    setImageDrafts((prev) => [...prev, draft]);
    setEditingImageId(draft.id);
  }

  function addVideoProvider() {
    const draft = createVideoProviderDraft(selectedVideoProviderType);
    setVideoDrafts((prev) => [...prev, draft]);
    setEditingVideoId(draft.id);
  }

  function removeImageProvider(id: string) {
    setImageDrafts((prev) => prev.filter((d) => d.id !== id));
    if (defaultImageProvider === id) setDefaultImageProvider("");
    if (editingImageId === id) setEditingImageId(null);
  }

  function removeVideoProvider(id: string) {
    setVideoDrafts((prev) => prev.filter((d) => d.id !== id));
    if (defaultVideoProvider === id) setDefaultVideoProvider("");
    if (editingVideoId === id) setEditingVideoId(null);
  }

  function updateImageDraft(id: string, updated: ProviderEntryDraft) {
    setImageDrafts((prev) => prev.map((d) => d.id === id ? updated : d));
  }

  function updateVideoDraft(id: string, updated: ProviderEntryDraft) {
    setVideoDrafts((prev) => prev.map((d) => d.id === id ? updated : d));
  }

  function getProviderLabel(draft: ProviderEntryDraft): string {
    if (draft.name.trim()) return draft.name.trim();
    const imageLabel = IMAGE_PROVIDER_LABELS[draft.provider as ImageGenerationProvider];
    const videoLabel = VIDEO_PROVIDER_LABELS[draft.provider as keyof typeof VIDEO_PROVIDER_LABELS];
    return imageLabel ?? videoLabel ?? String(draft.provider);
  }

  return (
    <div className="sp-root animate-fade-in">
      <header className="sp-header">
        <span className="sp-kicker">{t("settingsPages.profileSettings.kicker")}</span>
        <h1 className="sp-title">{t("nav.settings")}</h1>
        <p className="sp-desc">{t("settingsPages.profileSettings.description")}</p>
      </header>

      <InlineFeedback message={feedback.message} error={feedback.error} />

      {profileQuery.isPending || !profileQuery.data ? (
        <LoadingSkeleton rows={6} />
      ) : profileQuery.error ? (
        <ErrorState
          title="Failed to load profile"
          description={formatApiError(profileQuery.error, t)}
          action={<button className="btn btn-secondary" type="button" onClick={() => void profileQuery.refetch()}>{t("common.reload")}</button>}
        />
      ) : (
        <div className="sp-body">
          {/* --- 个人信息 --- */}
          <section className="sp-card animate-slide-up" style={{ animationDelay: "0.06s" }}>
            <div className="sp-card-head">
              <div className="sp-card-icon"><UserIcon /></div>
              <div>
                <h2 className="sp-card-title">{t("settingsPages.profileSettings.formTitle")}</h2>
                <p className="sp-card-desc">{t("settingsPages.profileSettings.formDescription")}</p>
              </div>
            </div>
            <div className="stack stack-gap-5">
              <div className="form-group">
                <label className="form-label text-sm" htmlFor="profile-display-name">{t("settingsPages.profileSettings.displayNameLabel")}</label>
                <input id="profile-display-name" className="input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
              </div>
            </div>
          </section>

          {/* --- LLM 配置 --- */}
          <section className="sp-card animate-slide-up" style={{ animationDelay: "0.12s" }}>
            <div className="sp-card-head">
              <div className="sp-card-icon" style={{ background: "linear-gradient(135deg, rgba(167, 139, 250, 0.2), rgba(167, 139, 250, 0.05))", color: "#c4b5fd", boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 2px 10px -2px rgba(167, 139, 250, 0.3)" }}><AiIcon /></div>
              <div>
                <h2 className="sp-card-title">{t("settingsPages.profileSettings.llmTitle")}</h2>
                <p className="sp-card-desc">{t("settingsPages.profileSettings.llmDescription")}</p>
              </div>
            </div>
            <div className="stack stack-gap-5">
              <div className="form-group">
                <label className="form-label text-sm" htmlFor="profile-llm-provider">{t("settingsPages.profileSettings.llmProviderLabel")}</label>
                <select id="profile-llm-provider" className="input" value={llmProvider} onChange={(event) => setLlmProvider(event.target.value as "openai-completions")}>
                  <option value="openai-completions">OpenAI Standard (completions)</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label text-sm" htmlFor="profile-llm-api-key">{t("settingsPages.profileSettings.llmApiKeyLabel")}</label>
                <input id="profile-llm-api-key" className="input" type="password" placeholder={t("settingsPages.profileSettings.llmApiKeyPlaceholder")} value={llmApiKey} onChange={(event) => setLlmApiKey(event.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label text-sm" htmlFor="profile-llm-base-url">{t("settingsPages.profileSettings.llmBaseUrlLabel")}</label>
                <input id="profile-llm-base-url" className="input" placeholder={t("settingsPages.profileSettings.llmBaseUrlPlaceholder")} value={llmBaseUrl} onChange={(event) => setLlmBaseUrl(event.target.value)} />
              </div>

              <div className="form-group">
                <div className="sp-field-row">
                  <label className="form-label text-sm" htmlFor="profile-llm-model-catalog">{t("settingsPages.profileSettings.llmModelCatalogLabel")}</label>
                  <button className="btn btn-secondary btn-sm" type="button" onClick={() => loadModelsMutation.mutate()} disabled={loadModelsMutation.isPending}>
                    <RefreshIcon />
                    <span style={{ marginLeft: 4 }}>{loadModelsMutation.isPending ? t("settingsPages.profileSettings.llmLoadingModels") : t("settingsPages.profileSettings.llmLoadModelsAction")}</span>
                  </button>
                </div>
                <select
                  id="profile-llm-model-catalog"
                  className="input"
                  value={selectedCatalogModel}
                  onChange={(event) => setLlmModel(event.target.value)}
                  disabled={availableModels.length === 0}
                >
                  <option value="">{t("settingsPages.profileSettings.llmModelCatalogPlaceholder")}</option>
                  {availableModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.ownedBy ? `${model.id} (${model.ownedBy})` : model.id}
                    </option>
                  ))}
                </select>
                <p className="sp-hint">
                  {hasFetchedModels
                    ? availableModels.length > 0
                      ? t("settingsPages.profileSettings.llmModelCatalogCount", { count: availableModels.length })
                      : t("settingsPages.profileSettings.llmModelCatalogEmpty")
                    : t("settingsPages.profileSettings.llmModelCatalogHint")}
                </p>
                {modelListError ? <p className="sp-error" role="alert">{modelListError}</p> : null}
              </div>

              <div className="form-group">
                <label className="form-label text-sm" htmlFor="profile-llm-model">{t("settingsPages.profileSettings.llmModelLabel")}</label>
                <input id="profile-llm-model" className="input" placeholder={t("settingsPages.profileSettings.llmModelPlaceholder")} value={llmModel} onChange={(event) => setLlmModel(event.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label text-sm" htmlFor="profile-llm-stream">{t("settingsPages.profileSettings.llmStreamLabel")}</label>
                <select
                  id="profile-llm-stream"
                  className="input"
                  value={llmStreamEnabled ? "enabled" : "disabled"}
                  onChange={(event) => setLlmStreamEnabled(event.target.value === "enabled")}
                >
                  <option value="disabled">{t("settingsPages.profileSettings.llmStreamDisabled")}</option>
                  <option value="enabled">{t("settingsPages.profileSettings.llmStreamEnabled")}</option>
                </select>
                <p className="sp-hint">{t("settingsPages.profileSettings.llmStreamHint")}</p>
              </div>
            </div>
          </section>

          {/* --- 图片 Provider 列表 --- */}
          <section className="sp-card animate-slide-up" style={{ animationDelay: "0.15s" }}>
            <div className="sp-card-head">
              <div className="sp-card-icon" style={{ background: "linear-gradient(135deg, rgba(56, 189, 248, 0.2), rgba(56, 189, 248, 0.05))", color: "#7dd3fc", boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 2px 10px -2px rgba(56, 189, 248, 0.3)" }}><ImageIcon /></div>
              <div>
                <h2 className="sp-card-title">图片生成 Provider</h2>
                <p className="sp-card-desc">配置一个或多个图片生成服务，点击星标设为默认</p>
              </div>
            </div>
            <div className="stack stack-gap-4">
              {imageDrafts.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>暂无图片 Provider 配置，点击下方按钮添加</p>
              ) : (
                imageDrafts.map((draft) => (
                  <div key={draft.id} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "var(--space-4)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: editingImageId === draft.id ? "var(--space-4)" : 0 }}>
                      <button
                        type="button"
                        onClick={() => setDefaultImageProvider(defaultImageProvider === draft.id ? "" : draft.id)}
                        style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
                        title={defaultImageProvider === draft.id ? "取消默认" : "设为默认"}
                      >
                        <StarIcon filled={defaultImageProvider === draft.id} />
                      </button>
                      <span className="text-sm" style={{ fontWeight: 500, flex: 1 }}>{getProviderLabel(draft)}</span>
                      <span className="text-sm" style={{ color: "var(--text-tertiary)" }}>
                        {IMAGE_PROVIDER_LABELS[draft.provider as ImageGenerationProvider] ?? String(draft.provider)}
                      </span>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setEditingImageId(editingImageId === draft.id ? null : draft.id)}
                      >
                        {editingImageId === draft.id ? "收起" : "编辑"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ color: "var(--danger-text)" }}
                        onClick={() => removeImageProvider(draft.id)}
                      >
                        删除
                      </button>
                    </div>
                    {editingImageId === draft.id ? (
                      <ProviderEntryForm
                        draft={draft}
                        onChange={(updated) => updateImageDraft(draft.id, updated)}
                        type="image"
                      />
                    ) : null}
                  </div>
                ))
              )}
              <button type="button" className="btn btn-secondary" onClick={addImageProvider}>
                + 添加图片 Provider
              </button>
            </div>
          </section>

          {/* --- 视频 Provider 列表 --- */}
          <section className="sp-card animate-slide-up" style={{ animationDelay: "0.18s" }}>
            <div className="sp-card-head">
              <div className="sp-card-icon" style={{ background: "linear-gradient(135deg, rgba(251, 146, 60, 0.2), rgba(251, 146, 60, 0.05))", color: "#fb923c", boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 2px 10px -2px rgba(251, 146, 60, 0.3)" }}><VideoIcon /></div>
              <div>
                <h2 className="sp-card-title">视频生成 Provider</h2>
                <p className="sp-card-desc">配置一个或多个视频生成服务，点击星标设为默认</p>
              </div>
            </div>
            <div className="stack stack-gap-4">
              {videoDrafts.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>暂无视频 Provider 配置，点击下方按钮添加</p>
              ) : (
                videoDrafts.map((draft) => (
                  <div key={draft.id} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "var(--space-4)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: editingVideoId === draft.id ? "var(--space-4)" : 0 }}>
                      <button
                        type="button"
                        onClick={() => setDefaultVideoProvider(defaultVideoProvider === draft.id ? "" : draft.id)}
                        style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
                        title={defaultVideoProvider === draft.id ? "取消默认" : "设为默认"}
                      >
                        <StarIcon filled={defaultVideoProvider === draft.id} />
                      </button>
                      <span className="text-sm" style={{ fontWeight: 500, flex: 1 }}>{getProviderLabel(draft)}</span>
                      <span className="text-sm" style={{ color: "var(--text-tertiary)" }}>
                        {VIDEO_PROVIDER_LABELS[draft.provider as keyof typeof VIDEO_PROVIDER_LABELS] ?? String(draft.provider)}
                      </span>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setEditingVideoId(editingVideoId === draft.id ? null : draft.id)}
                      >
                        {editingVideoId === draft.id ? "收起" : "编辑"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ color: "var(--danger-text)" }}
                        onClick={() => removeVideoProvider(draft.id)}
                      >
                        删除
                      </button>
                    </div>
                    {editingVideoId === draft.id ? (
                      <ProviderEntryForm
                        draft={draft}
                        onChange={(updated) => updateVideoDraft(draft.id, updated)}
                        type="video"
                      />
                    ) : null}
                  </div>
                ))
              )}
              <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
                <select
                  className="input"
                  style={{ maxWidth: 220 }}
                  value={selectedVideoProviderType}
                  onChange={(event) => setSelectedVideoProviderType(event.target.value as VideoGenerationProvider)}
                >
                  {Object.entries(VIDEO_PROVIDER_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <button type="button" className="btn btn-secondary" onClick={addVideoProvider}>
                  + 添加视频 Provider
                </button>
              </div>
            </div>
          </section>

          <div className="sp-save-area animate-slide-up" style={{ animationDelay: "0.21s" }}>
            <button className="btn btn-primary" type="button" onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending || !displayName.trim()}>
              {updateMutation.isPending ? t("common.submitting") : t("settingsPages.profileSettings.saveAction")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
