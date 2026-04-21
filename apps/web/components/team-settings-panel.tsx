/**
 * @fileoverview 团队设置面板
 * @module web/components
 *
 * 团队名称、审核策略、LLM 和图片/视频 Provider 配置管理。
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ImageGenerationConfig,
  ImageGenerationProvider,
  LlmModelListResponse,
  LlmModelSummary,
  ProviderEntry,
  TeamSettingsResponse,
  TeamSummary,
} from "@dramaflow/shared";

import { apiFetch, formatApiError } from "../lib/api";
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
import { getReviewPolicyLabel, useI18n } from "../lib/i18n";
import { buildLlmConfigPayload, toLlmConfigDraft } from "../lib/llm-config";
import { queryKeys } from "../lib/query-keys";
import { ConfirmAction } from "./confirm-action";
import { ErrorState } from "./error-state";
import { InlineFeedback } from "./inline-feedback";
import { LoadingSkeleton } from "./loading-skeleton";
import { ProviderEntryForm } from "./provider-entry-form";

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill={filled ? "currentColor" : "none"} aria-hidden="true" style={{ color: filled ? "var(--warning)" : "var(--text-tertiary)" }}>
      <path d="M8 1.5l1.85 3.75 4.15.6-3 2.93.71 4.12L8 10.87 4.29 12.9 5 8.78l-3-2.93 4.15-.6L8 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function TeamSettingsPanel() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { t } = useI18n();
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [name, setName] = useState("");
  const [defaultReviewPolicy, setDefaultReviewPolicy] = useState<"required" | "bypass">("required");
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
  const [feedback, setFeedback] = useState<{ message: string | null; error: string | null }>({ message: null, error: null });

  const teamsQuery = useQuery({
    queryKey: queryKeys.teams,
    queryFn: () => apiFetch<TeamSummary[]>("/teams"),
  });

  const manageableTeams = useMemo(
    () => (teamsQuery.data ?? []).filter((team) => team.canManage),
    [teamsQuery.data],
  );

  useEffect(() => {
    if (!selectedTeamId || !manageableTeams.some((team) => team.id === selectedTeamId)) {
      setSelectedTeamId(manageableTeams[0]?.id ?? "");
    }
  }, [manageableTeams, selectedTeamId]);

  const teamQuery = useQuery({
    queryKey: queryKeys.teamSettings(selectedTeamId),
    queryFn: () => apiFetch<TeamSettingsResponse>(`/admin/teams/${selectedTeamId}/settings`),
    enabled: Boolean(selectedTeamId),
  });

  useEffect(() => {
    if (!teamQuery.data) {
      return;
    }

    const data = teamQuery.data;
    const llmDraft = toLlmConfigDraft(data.llmConfig);
    const imageDraft = toImageGenerationConfigDraft(data.imageGenerationConfig);

    setName(data.name);
    setDefaultReviewPolicy(data.defaultReviewPolicy);
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
      const migrated = migrateImageGenerationConfig(data.imageGenerationConfig as ImageGenerationConfig | undefined);
      setImageDrafts(migrated.imageProviders.map(toProviderEntryDraft));
      setDefaultImageProvider(migrated.defaultImageProvider ?? "");
    }

    if (data.videoProviders && data.videoProviders.length > 0) {
      setVideoDrafts(data.videoProviders.map(toProviderEntryDraft));
      setDefaultVideoProvider(data.defaultVideoProvider ?? "");
    } else {
      const migrated = migrateImageGenerationConfig(data.imageGenerationConfig as ImageGenerationConfig | undefined);
      setVideoDrafts(migrated.videoProviders.map(toProviderEntryDraft));
      setDefaultVideoProvider(migrated.defaultVideoProvider ?? "");
    }

    // Legacy image config (kept for backward-compat)
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
  }, [teamQuery.data]);

  useEffect(() => {
    setAvailableModels([]);
    setHasFetchedModels(false);
    setModelListError(null);
  }, [selectedTeamId, llmProvider, llmApiKey, llmBaseUrl]);

  const draftLlmConfig = buildLlmConfigPayload({
    provider: llmProvider,
    apiKey: llmApiKey,
    baseUrl: llmBaseUrl,
    model: llmModel,
    stream: llmStreamEnabled,
  }, teamQuery.data?.llmConfig);

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
    if (!defaultDraft) return buildImageGenerationConfigPayload(toImageGenerationConfigDraft(teamQuery.data?.imageGenerationConfig));
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
      return apiFetch(`/teams/${selectedTeamId}`, {
        method: "PATCH",
        body: {
          name,
          defaultReviewPolicy,
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
      setFeedback({ message: t("settingsPages.teamSettings.saveSuccess"), error: null });
      await queryClient.invalidateQueries({ queryKey: queryKeys.teamSettings(selectedTeamId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.teamOverview(selectedTeamId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.teams });
    },
    onError: (error) => setFeedback({ message: null, error: formatApiError(error, t, "settingsPages.teamSettings.saveError") }),
  });

  const deleteTeamMutation = useMutation({
    mutationFn: () => apiFetch(`/teams/${selectedTeamId}`, {
      method: "DELETE",
    }),
    onSuccess: async () => {
      setFeedback({ message: t("settingsPages.teamSettings.deleteTeamSuccess"), error: null });
      await queryClient.invalidateQueries({ queryKey: queryKeys.teams });
      setSelectedTeamId("");
      const remainingTeams = manageableTeams.filter((team) => team.id !== selectedTeamId);
      if (remainingTeams.length === 0) {
        router.push("/dashboard");
      }
    },
    onError: (error) => setFeedback({ message: null, error: formatApiError(error, t, "settingsPages.teamSettings.deleteTeamError") }),
  });

  const loadModelsMutation = useMutation({
    mutationFn: () => apiFetch<LlmModelListResponse>(`/teams/${selectedTeamId}/llm-models`, {
      method: "POST",
      body: {
        llmConfig: draftLlmConfig,
      },
    }),
    onMutate: () => {
      setModelListError(null);
    },
    onSuccess: (payload) => {
      setAvailableModels(payload.models);
      setHasFetchedModels(true);
      setModelListError(null);
    },
    onError: (error) => {
      setModelListError(formatApiError(error, t, "settingsPages.teamSettings.llmLoadModelsError"));
    },
  });

  const selectedCatalogModel = availableModels.some((model) => model.id === llmModel)
    ? llmModel
    : "";

  // --- Provider list management helpers ---
  function addImageProvider() {
    const draft = createImageProviderDraft();
    setImageDrafts((prev) => [...prev, draft]);
    setEditingImageId(draft.id);
  }

  function addVideoProvider() {
    const draft = createVideoProviderDraft();
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

  if (teamsQuery.isPending) {
    return <LoadingSkeleton variant="hero" rows={8} />;
  }

  if (teamsQuery.error) {
    return (
      <ErrorState
        title={t("teamAdmin.loadErrorTitle")}
        description={formatApiError(teamsQuery.error, t, "teamAdmin.loadErrorDescription")}
        action={<button className="btn btn-secondary" type="button" onClick={() => void teamsQuery.refetch()}>{t("common.reload")}</button>}
      />
    );
  }

  const teams = manageableTeams;
  if (teams.length === 0) {
    return (
      <ErrorState
        title={t("teamAdmin.noTeamTitle")}
        description={t("teamAdmin.noTeamDescription")}
      />
    );
  }

  return (
    <div className="animate-fade-in" style={{ maxWidth: "1400px", margin: "0 auto" }}>
      <div className="team-hero" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-6)", flexWrap: "wrap" }}>
        <div>
          <div className="team-hero-kicker">{t("settingsPages.teamSettings.kicker")}</div>
          <h1 className="team-hero-title">{t("nav.teamSettings")}</h1>
          <p className="team-hero-desc">{t("settingsPages.teamSettings.description")}</p>
        </div>
        <div className="team-switcher" style={{ marginTop: 0 }}>
          <label className="team-switcher-label" htmlFor="team-switcher">
            {t("teamAdmin.switcher.label")}
          </label>
          <select
            id="team-switcher"
            className="input"
            value={selectedTeamId}
            onChange={(event) => setSelectedTeamId(event.target.value)}
            style={{ minWidth: 240 }}
          >
            {teams.map((team) => (
              <option key={team.id} value={team.id}>{team.name}</option>
            ))}
          </select>
        </div>
      </div>

      <InlineFeedback message={feedback.message} error={feedback.error} />

      {teamQuery.isPending ? (
        <LoadingSkeleton rows={6} />
      ) : teamQuery.error ? (
        <ErrorState
          title={t("teamAdmin.overviewLoadErrorTitle")}
          description={formatApiError(teamQuery.error, t, "teamAdmin.overviewLoadErrorDescription")}
          action={<button className="btn btn-secondary" type="button" onClick={() => void teamQuery.refetch()}>{t("common.reload")}</button>}
        />
      ) : !teamQuery.data ? (
        <LoadingSkeleton rows={6} />
      ) : (
        <div className="stack stack-gap-6">
          {/* --- 团队基本信息 --- */}
          <section className="team-section">
            <div className="team-section-header">
              <h2 className="team-section-title">
                {t("settingsPages.teamSettings.formTitle")}
              </h2>
              <p className="team-section-desc">
                {t("settingsPages.teamSettings.formDescription")}
              </p>
            </div>

            <div className="team-form-card">
              <div className="team-split-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="team-name">
                    {t("settingsPages.teamSettings.nameLabel")}
                  </label>
                  <input
                    id="team-name"
                    className="input"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="team-review-policy">
                    {t("settingsPages.teamSettings.defaultReviewLabel")}
                  </label>
                  <select
                    id="team-review-policy"
                    className="input"
                    value={defaultReviewPolicy}
                    onChange={(event) => setDefaultReviewPolicy(event.target.value as "required" | "bypass")}
                  >
                    <option value="required">{getReviewPolicyLabel(t, "required")}</option>
                    <option value="bypass">{getReviewPolicyLabel(t, "bypass")}</option>
                  </select>
                </div>
              </div>
            </div>
          </section>

          {/* --- LLM 配置 --- */}
          <section className="team-section">
            <div className="team-section-header">
              <h2 className="team-section-title">
                {t("settingsPages.teamSettings.llmTitle")}
              </h2>
              <p className="team-section-desc">
                {t("settingsPages.teamSettings.llmDescription")}
              </p>
            </div>

            <div className="team-form-card">
              <div className="stack stack-gap-6">
                <div className="team-split-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="team-llm-provider">
                      {t("settingsPages.teamSettings.llmProviderLabel")}
                    </label>
                    <select
                      id="team-llm-provider"
                      className="input"
                      value={llmProvider}
                      onChange={(event) => setLlmProvider(event.target.value as "openai-completions")}
                    >
                      <option value="openai-completions">OpenAI Standard (completions)</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="team-llm-api-key">
                      {t("settingsPages.teamSettings.llmApiKeyLabel")}
                    </label>
                    <input
                      id="team-llm-api-key"
                      className="input"
                      type="password"
                      placeholder={t("settingsPages.teamSettings.llmApiKeyPlaceholder")}
                      value={llmApiKey}
                      onChange={(event) => setLlmApiKey(event.target.value)}
                    />
                  </div>
                </div>

                <div className="team-split-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="team-llm-base-url">
                      {t("settingsPages.teamSettings.llmBaseUrlLabel")}
                    </label>
                    <input
                      id="team-llm-base-url"
                      className="input"
                      placeholder={t("settingsPages.teamSettings.llmBaseUrlPlaceholder")}
                      value={llmBaseUrl}
                      onChange={(event) => setLlmBaseUrl(event.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="team-llm-stream">
                      {t("settingsPages.teamSettings.llmStreamLabel")}
                    </label>
                    <select
                      id="team-llm-stream"
                      className="input"
                      value={llmStreamEnabled ? "enabled" : "disabled"}
                      onChange={(event) => setLlmStreamEnabled(event.target.value === "enabled")}
                    >
                      <option value="disabled">{t("settingsPages.teamSettings.llmStreamDisabled")}</option>
                      <option value="enabled">{t("settingsPages.teamSettings.llmStreamEnabled")}</option>
                    </select>
                  </div>
                </div>

                <div className="team-settings-model-card">
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--space-4)", marginBottom: "var(--space-4)", flexWrap: "wrap" }}>
                    <div style={{ flex: "1 1 auto", minWidth: "200px" }}>
                      <label className="form-label" htmlFor="team-llm-model-catalog">
                        {t("settingsPages.teamSettings.llmModelCatalogLabel")}
                      </label>
                      <select
                        id="team-llm-model-catalog"
                        className="input"
                        value={selectedCatalogModel}
                        onChange={(event) => setLlmModel(event.target.value)}
                        disabled={availableModels.length === 0}
                      >
                        <option value="">{t("settingsPages.teamSettings.llmModelCatalogPlaceholder")}</option>
                        {availableModels.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.ownedBy ? `${model.id} (${model.ownedBy})` : model.id}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      className="btn btn-secondary"
                      type="button"
                      onClick={() => loadModelsMutation.mutate()}
                      disabled={loadModelsMutation.isPending || !selectedTeamId}
                      style={{ flexShrink: 0, marginTop: "28px" }}
                    >
                      {loadModelsMutation.isPending ? t("settingsPages.teamSettings.llmLoadingModels") : t("settingsPages.teamSettings.llmLoadModelsAction")}
                    </button>
                  </div>

                  <div style={{ marginTop: "var(--space-3)" }}>
                    <p className="team-settings-card-desc" style={{ fontSize: "13px" }}>
                      {hasFetchedModels
                        ? availableModels.length > 0
                          ? t("settingsPages.teamSettings.llmModelCatalogCount", { count: availableModels.length })
                          : t("settingsPages.teamSettings.llmModelCatalogEmpty")
                        : t("settingsPages.teamSettings.llmModelCatalogHint")}
                    </p>
                    {modelListError ? (
                      <p style={{ marginTop: "var(--space-2)", color: "var(--danger-text)", fontSize: "13px" }} role="alert">
                        {modelListError}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="team-llm-model">
                    {t("settingsPages.teamSettings.llmModelLabel")}
                  </label>
                  <input
                    id="team-llm-model"
                    className="input"
                    placeholder={t("settingsPages.teamSettings.llmModelPlaceholder")}
                    value={llmModel}
                    onChange={(event) => setLlmModel(event.target.value)}
                  />
                  <p className="team-settings-card-desc" style={{ marginTop: "var(--space-2)", fontSize: "13px" }}>
                    {t("settingsPages.teamSettings.llmStreamHint")}
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* --- 图片 Provider 列表 --- */}
          <section className="team-section">
            <div className="team-section-header">
              <h2 className="team-section-title">图片生成 Provider</h2>
              <p className="team-section-desc">配置一个或多个图片生成服务，点击星标设为默认</p>
            </div>

            <div className="team-form-card">
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
                          maskedApiKey
                        />
                      ) : null}
                    </div>
                  ))
                )}
                <button type="button" className="btn btn-secondary" onClick={addImageProvider}>
                  + 添加图片 Provider
                </button>
              </div>
            </div>
          </section>

          {/* --- 视频 Provider 列表 --- */}
          <section className="team-section">
            <div className="team-section-header">
              <h2 className="team-section-title">视频生成 Provider</h2>
              <p className="team-section-desc">配置一个或多个视频生成服务，点击星标设为默认</p>
            </div>

            <div className="team-form-card">
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
                          maskedApiKey
                        />
                      ) : null}
                    </div>
                  ))
                )}
                <button type="button" className="btn btn-secondary" onClick={addVideoProvider}>
                  + 添加视频 Provider
                </button>
              </div>
            </div>
          </section>

          {/* --- 团队摘要 --- */}
          <section className="team-section">
            <div className="team-section-header">
              <h2 className="team-section-title">
                {t("settingsPages.teamSettings.summaryTitle")}
              </h2>
              <p className="team-section-desc">
                {t("settingsPages.teamSettings.summaryDescription")}
              </p>
            </div>

            <div className="team-split-row">
              <div className="team-info-card">
                <div className="team-info-card-title">
                  {t("settingsPages.teamSettings.slugLabel")}
                </div>
                <p className="team-settings-summary-value" style={{ marginTop: "var(--space-3)" }}>
                  /{teamQuery.data.slug}
                </p>
              </div>

              <div className="team-info-card">
                <div className="team-info-card-title">
                  {t("settingsPages.teamSettings.currentReviewLabel")}
                </div>
                <div style={{ marginTop: "var(--space-3)" }}>
                  <span className="team-review-badge">
                    {getReviewPolicyLabel(t, teamQuery.data.defaultReviewPolicy)}
                  </span>
                </div>
              </div>
            </div>
          </section>

          <div className="team-settings-save-row">
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending || !name.trim()}
              style={{ minWidth: "140px", padding: "12px 24px", fontSize: "15px", fontWeight: 500 }}
            >
              {updateMutation.isPending ? t("common.submitting") : t("settingsPages.teamSettings.saveAction")}
            </button>
          </div>

          <section className="team-danger-zone">
            <div className="team-danger-zone-header">
              <h2 className="team-danger-zone-title">
                {t("settingsPages.teamSettings.dangerZoneTitle")}
              </h2>
              <p className="team-danger-zone-desc">
                {t("settingsPages.teamSettings.dangerZoneDescription")}
              </p>
            </div>
            <div className="team-danger-zone-row">
              <div className="team-danger-zone-row-info">
                <div className="team-danger-zone-row-label">
                  {t("settingsPages.teamSettings.deleteTeamAction")}
                </div>
                <div className="team-danger-zone-row-hint">
                  {t("settingsPages.teamSettings.deleteTeamDescription")}
                </div>
              </div>
              <ConfirmAction
                label={t("settingsPages.teamSettings.deleteTeamAction")}
                confirmLabel={t("settingsPages.teamSettings.deleteTeamConfirm")}
                tone="danger"
                onConfirm={() => deleteTeamMutation.mutate()}
              />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
