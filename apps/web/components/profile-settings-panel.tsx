/**
 * @fileoverview 个人设置面板
 * @module web/components
 *
 * 用户个人信息、LLM 和图片生成配置管理。
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
} from "@dramaflow/shared";

import { apiFetch, formatApiError } from "../lib/api";
import {
  buildImageGenerationConfigPayload,
  toImageGenerationConfigDraft,
} from "../lib/image-config";
import { useI18n } from "../lib/i18n";
import { buildLlmConfigPayload, toLlmConfigDraft } from "../lib/llm-config";
import { ErrorState } from "./error-state";
import { InlineFeedback } from "./inline-feedback";
import { LoadingSkeleton } from "./loading-skeleton";

interface ProfileSettingsResponse {
  displayName: string;
  llmConfig?: LlmProviderConfig;
  imageGenerationConfig?: ImageGenerationConfig;
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

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M1.5 7a5.5 5.5 0 019.81-3.39M12.5 7a5.5 5.5 0 01-9.81 3.39" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M11.5 1v3h-3M2.5 13v-3h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
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
  const [availableModels, setAvailableModels] = useState<LlmModelSummary[]>([]);
  const [hasFetchedModels, setHasFetchedModels] = useState(false);
  const [modelListError, setModelListError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ message: string | null; error: string | null }>({ message: null, error: null });

  const profileQuery = useQuery({
    queryKey: ["auth_me"],
    queryFn: () => apiFetch<ProfileSettingsResponse>("/auth/me"),
  });

  useEffect(() => {
    if (!profileQuery.data) return;
    const llmDraft = toLlmConfigDraft(profileQuery.data.llmConfig);
    const imageDraft = toImageGenerationConfigDraft(profileQuery.data.imageGenerationConfig);
    setDisplayName(profileQuery.data.displayName || "");
    setLlmProvider(llmDraft.provider);
    setLlmApiKey(llmDraft.apiKey);
    setLlmBaseUrl(llmDraft.baseUrl);
    setLlmModel(llmDraft.model);
    setLlmStreamEnabled(llmDraft.stream);
    setImageProvider(imageDraft.provider);
    setImageApiKey(imageDraft.apiKey);
    setImageBaseUrl(imageDraft.baseUrl);
    setImageModel(imageDraft.model);
    setSdSamplerName(profileQuery.data.imageGenerationConfig?.sdConfig?.samplerName ?? "DPM++ 2M Karras");
    setSdSteps(profileQuery.data.imageGenerationConfig?.sdConfig?.steps ?? 20);
    setSdCfgScale(profileQuery.data.imageGenerationConfig?.sdConfig?.cfgScale ?? 7);
    setSdClipSkip(profileQuery.data.imageGenerationConfig?.sdConfig?.clipSkip ?? 1);
    setComfyuiWorkflowJson(profileQuery.data.imageGenerationConfig?.comfyuiConfig?.workflowJson ?? "");
    setComfyuiSamplerName(profileQuery.data.imageGenerationConfig?.comfyuiConfig?.samplerName ?? "euler");
    setComfyuiSteps(profileQuery.data.imageGenerationConfig?.comfyuiConfig?.steps ?? 20);
    setComfyuiCfgScale(profileQuery.data.imageGenerationConfig?.comfyuiConfig?.cfgScale ?? 8);
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
  };

  const updateMutation = useMutation({
    mutationFn: () => apiFetch("/auth/me", {
      method: "PATCH",
      body: { displayName, llmConfig: draftLlmConfig, imageGenerationConfig: draftImageConfig },
    }),
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

          <section className="sp-card animate-slide-up" style={{ animationDelay: "0.15s" }}>
            <div className="sp-card-head">
              <div className="sp-card-icon" style={{ background: "linear-gradient(135deg, rgba(56, 189, 248, 0.2), rgba(56, 189, 248, 0.05))", color: "#7dd3fc", boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 2px 10px -2px rgba(56, 189, 248, 0.3)" }}><ImageIcon /></div>
              <div>
                <h2 className="sp-card-title">{t("settingsPages.profileSettings.imageTitle")}</h2>
                <p className="sp-card-desc">{t("settingsPages.profileSettings.imageDescription")}</p>
              </div>
            </div>
            <div className="stack stack-gap-5">
              <div className="form-group">
                <label className="form-label text-sm" htmlFor="profile-image-provider">{t("settingsPages.profileSettings.imageProviderLabel")}</label>
                <select
                  id="profile-image-provider"
                  className="input"
                  value={imageProvider}
                  onChange={(event) => setImageProvider(event.target.value as ImageGenerationProvider)}
                >
                  <option value="google-gemini">{t("settingsPages.profileSettings.imageProviderGoogle")}</option>
                  <option value="openai-compatible">{t("settingsPages.profileSettings.imageProviderOpenAi")}</option>
                  <option value="stable-diffusion">{t("settingsPages.profileSettings.imageProviderSDWebUI")}</option>
                  <option value="comfyui">{t("settingsPages.profileSettings.imageProviderComfyUI")}</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label text-sm" htmlFor="profile-image-api-key">{t("settingsPages.profileSettings.imageApiKeyLabel")}</label>
                <input
                  id="profile-image-api-key"
                  className="input"
                  type="password"
                  placeholder={t("settingsPages.profileSettings.imageApiKeyPlaceholder")}
                  value={imageApiKey}
                  onChange={(event) => setImageApiKey(event.target.value)}
                />
              </div>
              {imageProvider === "openai-compatible" || imageProvider === "stable-diffusion" || imageProvider === "comfyui" ? (
                <div className="form-group">
                  <label className="form-label text-sm" htmlFor="profile-image-base-url">{t("settingsPages.profileSettings.imageBaseUrlLabel")}</label>
                  <input
                    id="profile-image-base-url"
                    className="input"
                    placeholder={t("settingsPages.profileSettings.imageBaseUrlPlaceholder")}
                    value={imageBaseUrl}
                    onChange={(event) => setImageBaseUrl(event.target.value)}
                  />
                </div>
              ) : null}
              <div className="form-group">
                <label className="form-label text-sm" htmlFor="profile-image-model">{t("settingsPages.profileSettings.imageModelLabel")}</label>
                <input
                  id="profile-image-model"
                  className="input"
                  placeholder={t("settingsPages.profileSettings.imageModelPlaceholder")}
                  value={imageModel}
                  onChange={(event) => setImageModel(event.target.value)}
                />
              </div>
              {imageProvider === "stable-diffusion" ? (
                <>
                  <div className="form-group">
                    <label className="form-label text-sm" htmlFor="profile-sd-sampler">{t("settingsPages.profileSettings.imageSdSamplerLabel")}</label>
                    <input id="profile-sd-sampler" className="input" value={sdSamplerName} onChange={(event) => setSdSamplerName(event.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label text-sm" htmlFor="profile-sd-steps">{t("settingsPages.profileSettings.imageSdStepsLabel")}</label>
                    <input id="profile-sd-steps" className="input" type="number" value={sdSteps} onChange={(event) => setSdSteps(Number(event.target.value))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label text-sm" htmlFor="profile-sd-cfg-scale">{t("settingsPages.profileSettings.imageSdCfgScaleLabel")}</label>
                    <input id="profile-sd-cfg-scale" className="input" type="number" value={sdCfgScale} onChange={(event) => setSdCfgScale(Number(event.target.value))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label text-sm" htmlFor="profile-sd-clip-skip">{t("settingsPages.profileSettings.imageSdClipSkipLabel")}</label>
                    <input id="profile-sd-clip-skip" className="input" type="number" value={sdClipSkip} onChange={(event) => setSdClipSkip(Number(event.target.value))} />
                  </div>
                </>
              ) : null}
              {imageProvider === "comfyui" ? (
                <>
                  <div className="form-group">
                    <label className="form-label text-sm" htmlFor="profile-comfyui-workflow">{t("settingsPages.profileSettings.imageComfyuiWorkflowLabel")}</label>
                    <textarea id="profile-comfyui-workflow" className="input" rows={6} placeholder={t("settingsPages.profileSettings.imageComfyuiWorkflowPlaceholder")} value={comfyuiWorkflowJson} onChange={(event) => setComfyuiWorkflowJson(event.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label text-sm" htmlFor="profile-comfyui-sampler">{t("settingsPages.profileSettings.imageComfyuiSamplerLabel")}</label>
                    <input id="profile-comfyui-sampler" className="input" value={comfyuiSamplerName} onChange={(event) => setComfyuiSamplerName(event.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label text-sm" htmlFor="profile-comfyui-steps">{t("settingsPages.profileSettings.imageComfyuiStepsLabel")}</label>
                    <input id="profile-comfyui-steps" className="input" type="number" value={comfyuiSteps} onChange={(event) => setComfyuiSteps(Number(event.target.value))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label text-sm" htmlFor="profile-comfyui-cfg-scale">{t("settingsPages.profileSettings.imageComfyuiCfgScaleLabel")}</label>
                    <input id="profile-comfyui-cfg-scale" className="input" type="number" value={comfyuiCfgScale} onChange={(event) => setComfyuiCfgScale(Number(event.target.value))} />
                  </div>
                </>
              ) : null}
            </div>
          </section>

          <div className="sp-save-area animate-slide-up" style={{ animationDelay: "0.18s" }}>
            <button className="btn btn-primary" type="button" onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending || !displayName.trim()}>
              {updateMutation.isPending ? t("common.submitting") : t("settingsPages.profileSettings.saveAction")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}