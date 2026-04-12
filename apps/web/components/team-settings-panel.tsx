"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ImageGenerationConfig,
  ImageGenerationProvider,
  LlmModelListResponse,
  LlmModelSummary,
  TeamSettingsResponse,
  TeamSummary,
} from "@dramaflow/shared";

import { apiFetch, formatApiError } from "../lib/api";
import {
  buildImageGenerationConfigPayload,
  toImageGenerationConfigDraft,
} from "../lib/image-config";
import { getReviewPolicyLabel, useI18n } from "../lib/i18n";
import { buildLlmConfigPayload, toLlmConfigDraft } from "../lib/llm-config";
import { queryKeys } from "../lib/query-keys";
import { ConfirmAction } from "./confirm-action";
import { ErrorState } from "./error-state";
import { InlineFeedback } from "./inline-feedback";
import { LoadingSkeleton } from "./loading-skeleton";

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

    const llmDraft = toLlmConfigDraft(teamQuery.data.llmConfig);
    const imageDraft = toImageGenerationConfigDraft(teamQuery.data.imageGenerationConfig);
    setName(teamQuery.data.name);
    setDefaultReviewPolicy(teamQuery.data.defaultReviewPolicy);
    setLlmProvider(llmDraft.provider);
    setLlmApiKey(llmDraft.apiKey);
    setLlmBaseUrl(llmDraft.baseUrl);
    setLlmModel(llmDraft.model);
    setLlmStreamEnabled(llmDraft.stream);
    setImageProvider(imageDraft.provider);
    setImageApiKey(imageDraft.apiKey);
    setImageBaseUrl(imageDraft.baseUrl);
    setImageModel(imageDraft.model);
    setSdSamplerName(teamQuery.data.imageGenerationConfig?.sdConfig?.samplerName ?? "DPM++ 2M Karras");
    setSdSteps(teamQuery.data.imageGenerationConfig?.sdConfig?.steps ?? 20);
    setSdCfgScale(teamQuery.data.imageGenerationConfig?.sdConfig?.cfgScale ?? 7);
    setSdClipSkip(teamQuery.data.imageGenerationConfig?.sdConfig?.clipSkip ?? 1);
    setComfyuiWorkflowJson(teamQuery.data.imageGenerationConfig?.comfyuiConfig?.workflowJson ?? "");
    setComfyuiSamplerName(teamQuery.data.imageGenerationConfig?.comfyuiConfig?.samplerName ?? "euler");
    setComfyuiSteps(teamQuery.data.imageGenerationConfig?.comfyuiConfig?.steps ?? 20);
    setComfyuiCfgScale(teamQuery.data.imageGenerationConfig?.comfyuiConfig?.cfgScale ?? 8);
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
    mutationFn: () => apiFetch(`/teams/${selectedTeamId}`, {
      method: "PATCH",
      body: {
        name,
        defaultReviewPolicy,
        llmConfig: draftLlmConfig,
        imageGenerationConfig: draftImageConfig,
      },
    }),
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

          <section className="team-section">
            <div className="team-section-header">
              <h2 className="team-section-title">
                {t("settingsPages.teamSettings.imageTitle")}
              </h2>
              <p className="team-section-desc">
                {t("settingsPages.teamSettings.imageDescription")}
              </p>
            </div>

            <div className="team-form-card">
              <div className="stack stack-gap-6">
                <div className="team-split-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="team-image-provider">
                      {t("settingsPages.teamSettings.imageProviderLabel")}
                    </label>
                    <select
                      id="team-image-provider"
                      className="input"
                      value={imageProvider}
                      onChange={(event) => setImageProvider(event.target.value as ImageGenerationProvider)}
                    >
                      <option value="google-gemini">{t("settingsPages.teamSettings.imageProviderGoogle")}</option>
                      <option value="openai-compatible">{t("settingsPages.teamSettings.imageProviderOpenAi")}</option>
                      <option value="stable-diffusion">{t("settingsPages.teamSettings.imageProviderSDWebUI")}</option>
                      <option value="comfyui">{t("settingsPages.teamSettings.imageProviderComfyUI")}</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="team-image-api-key">
                      {t("settingsPages.teamSettings.imageApiKeyLabel")}
                    </label>
                    <input
                      id="team-image-api-key"
                      className="input"
                      type="password"
                      placeholder={t("settingsPages.teamSettings.imageApiKeyPlaceholder")}
                      value={imageApiKey}
                      onChange={(event) => setImageApiKey(event.target.value)}
                    />
                  </div>
                </div>

                {imageProvider === "openai-compatible" || imageProvider === "stable-diffusion" || imageProvider === "comfyui" ? (
                  <div className="team-split-row">
                    <div className="form-group">
                      <label className="form-label" htmlFor="team-image-base-url">
                        {t("settingsPages.teamSettings.imageBaseUrlLabel")}
                      </label>
                      <input
                        id="team-image-base-url"
                        className="input"
                        placeholder={t("settingsPages.teamSettings.imageBaseUrlPlaceholder")}
                        value={imageBaseUrl}
                        onChange={(event) => setImageBaseUrl(event.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="team-image-model">
                        {t("settingsPages.teamSettings.imageModelLabel")}
                      </label>
                      <input
                        id="team-image-model"
                        className="input"
                        placeholder={t("settingsPages.teamSettings.imageModelPlaceholder")}
                        value={imageModel}
                        onChange={(event) => setImageModel(event.target.value)}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="form-group">
                    <label className="form-label" htmlFor="team-image-model">
                      {t("settingsPages.teamSettings.imageModelLabel")}
                    </label>
                    <input
                      id="team-image-model"
                      className="input"
                      placeholder={t("settingsPages.teamSettings.imageModelPlaceholder")}
                      value={imageModel}
                      onChange={(event) => setImageModel(event.target.value)}
                    />
                  </div>
                )}
                {imageProvider === "stable-diffusion" ? (
                  <div className="team-split-row">
                    <div className="form-group">
                      <label className="form-label" htmlFor="team-sd-sampler">{t("settingsPages.teamSettings.imageSdSamplerLabel")}</label>
                      <input id="team-sd-sampler" className="input" value={sdSamplerName} onChange={(event) => setSdSamplerName(event.target.value)} />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="team-sd-steps">{t("settingsPages.teamSettings.imageSdStepsLabel")}</label>
                      <input id="team-sd-steps" className="input" type="number" value={sdSteps} onChange={(event) => setSdSteps(Number(event.target.value))} />
                    </div>
                  </div>
                ) : null}
                {imageProvider === "stable-diffusion" ? (
                  <div className="team-split-row">
                    <div className="form-group">
                      <label className="form-label" htmlFor="team-sd-cfg-scale">{t("settingsPages.teamSettings.imageSdCfgScaleLabel")}</label>
                      <input id="team-sd-cfg-scale" className="input" type="number" value={sdCfgScale} onChange={(event) => setSdCfgScale(Number(event.target.value))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="team-sd-clip-skip">{t("settingsPages.teamSettings.imageSdClipSkipLabel")}</label>
                      <input id="team-sd-clip-skip" className="input" type="number" value={sdClipSkip} onChange={(event) => setSdClipSkip(Number(event.target.value))} />
                    </div>
                  </div>
                ) : null}
                {imageProvider === "comfyui" ? (
                  <>
                    <div className="form-group">
                      <label className="form-label" htmlFor="team-comfyui-workflow">{t("settingsPages.teamSettings.imageComfyuiWorkflowLabel")}</label>
                      <textarea id="team-comfyui-workflow" className="input" rows={6} placeholder={t("settingsPages.teamSettings.imageComfyuiWorkflowPlaceholder")} value={comfyuiWorkflowJson} onChange={(event) => setComfyuiWorkflowJson(event.target.value)} />
                    </div>
                    <div className="team-split-row">
                      <div className="form-group">
                        <label className="form-label" htmlFor="team-comfyui-sampler">{t("settingsPages.teamSettings.imageComfyuiSamplerLabel")}</label>
                        <input id="team-comfyui-sampler" className="input" value={comfyuiSamplerName} onChange={(event) => setComfyuiSamplerName(event.target.value)} />
                      </div>
                      <div className="form-group">
                        <label className="form-label" htmlFor="team-comfyui-steps">{t("settingsPages.teamSettings.imageComfyuiStepsLabel")}</label>
                        <input id="team-comfyui-steps" className="input" type="number" value={comfyuiSteps} onChange={(event) => setComfyuiSteps(Number(event.target.value))} />
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="team-comfyui-cfg-scale">{t("settingsPages.teamSettings.imageComfyuiCfgScaleLabel")}</label>
                      <input id="team-comfyui-cfg-scale" className="input" type="number" value={comfyuiCfgScale} onChange={(event) => setComfyuiCfgScale(Number(event.target.value))} />
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </section>

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