/**
 * @fileoverview 单个 Provider 配置表单组件
 * @module web/components
 *
 * 用于编辑图片或视频 ProviderEntry 的可复用表单。
 * 根据 provider 类型动态显示/隐藏对应的配置字段。
 */

"use client";

import type { ImageGenerationProvider, VideoGenerationProvider } from "@dramaflow/shared";

import type { ProviderEntryDraft } from "../lib/image-config";
import {
  IMAGE_PROVIDER_LABELS,
  VIDEO_PROVIDER_LABELS,
} from "../lib/image-config";

interface ProviderEntryFormProps {
  draft: ProviderEntryDraft;
  onChange: (draft: ProviderEntryDraft) => void;
  type: "image" | "video";
  /** 团队设置中 apiKey 被掩码为 hasApiKey，此时隐藏密钥输入框，仅显示指示器 */
  maskedApiKey?: boolean;
}

const IMAGE_PROVIDER_OPTIONS = Object.entries(IMAGE_PROVIDER_LABELS);
const VIDEO_PROVIDER_OPTIONS = Object.entries(VIDEO_PROVIDER_LABELS);

export function ProviderEntryForm({ draft, onChange, type, maskedApiKey }: ProviderEntryFormProps) {
  const providerOptions = type === "image" ? IMAGE_PROVIDER_OPTIONS : VIDEO_PROVIDER_OPTIONS;

  function update(partial: Partial<ProviderEntryDraft>) {
    onChange({ ...draft, ...partial });
  }

  function handleProviderChange(newProvider: string) {
    const provider = newProvider as ImageGenerationProvider | VideoGenerationProvider;
    update({
      provider,
      model: "",
      sdConfig: {},
      comfyuiConfig: {},
      grokConfig: {},
    });
  }

  const showBaseUrl = draft.provider !== "google-gemini";

  return (
    <div className="stack stack-gap-4">
      <div className="form-group">
        <label className="form-label text-sm">名称</label>
        <input
          className="input"
          placeholder="可选，为此配置取一个名称"
          value={draft.name}
          onChange={(e) => update({ name: e.target.value })}
        />
      </div>

      <div className="form-group">
        <label className="form-label text-sm">Provider 类型</label>
        <select
          className="input"
          value={draft.provider}
          onChange={(e) => handleProviderChange(e.target.value)}
        >
          {providerOptions.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {maskedApiKey ? (
        <div className="form-group">
          <label className="form-label text-sm">API 密钥</label>
          <div className="input" style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-secondary)" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--success)" }} />
            <span>已配置 API 密钥</span>
          </div>
        </div>
      ) : (
        <div className="form-group">
          <label className="form-label text-sm">API 密钥</label>
          <input
            className="input"
            type="password"
            placeholder="输入 API 密钥"
            value={draft.apiKey}
            onChange={(e) => update({ apiKey: e.target.value })}
          />
        </div>
      )}

      {showBaseUrl ? (
        <div className="form-group">
          <label className="form-label text-sm">基础 URL</label>
          <input
            className="input"
            placeholder="API 基础地址"
            value={draft.baseUrl}
            onChange={(e) => update({ baseUrl: e.target.value })}
          />
        </div>
      ) : null}

      <div className="form-group">
        <label className="form-label text-sm">模型</label>
        <input
          className="input"
          placeholder="模型名称"
          value={draft.model}
          onChange={(e) => update({ model: e.target.value })}
        />
      </div>

      {draft.provider === "stable-diffusion" ? (
        <>
          <div className="form-group">
            <label className="form-label text-sm">采样器</label>
            <input
              className="input"
              value={draft.sdConfig.samplerName ?? ""}
              onChange={(e) => update({ sdConfig: { ...draft.sdConfig, samplerName: e.target.value || undefined } })}
            />
          </div>
          <div className="form-group">
            <label className="form-label text-sm">采样步数</label>
            <input
              className="input"
              type="number"
              value={draft.sdConfig.steps ?? 20}
              onChange={(e) => update({ sdConfig: { ...draft.sdConfig, steps: Number(e.target.value) || undefined } })}
            />
          </div>
          <div className="form-group">
            <label className="form-label text-sm">CFG 引导系数</label>
            <input
              className="input"
              type="number"
              value={draft.sdConfig.cfgScale ?? 7}
              onChange={(e) => update({ sdConfig: { ...draft.sdConfig, cfgScale: Number(e.target.value) || undefined } })}
            />
          </div>
          <div className="form-group">
            <label className="form-label text-sm">CLIP Skip</label>
            <input
              className="input"
              type="number"
              value={draft.sdConfig.clipSkip ?? 1}
              onChange={(e) => update({ sdConfig: { ...draft.sdConfig, clipSkip: Number(e.target.value) || undefined } })}
            />
          </div>
        </>
      ) : null}

      {draft.provider === "comfyui" ? (
        <>
          <div className="form-group">
            <label className="form-label text-sm">工作流 JSON</label>
            <textarea
              className="input"
              rows={6}
              placeholder="粘贴 ComfyUI 工作流 JSON"
              value={draft.comfyuiConfig.workflowJson ?? ""}
              onChange={(e) => update({ comfyuiConfig: { ...draft.comfyuiConfig, workflowJson: e.target.value || undefined } })}
            />
          </div>
          <div className="form-group">
            <label className="form-label text-sm">采样器</label>
            <input
              className="input"
              value={draft.comfyuiConfig.samplerName ?? ""}
              onChange={(e) => update({ comfyuiConfig: { ...draft.comfyuiConfig, samplerName: e.target.value || undefined } })}
            />
          </div>
          <div className="form-group">
            <label className="form-label text-sm">采样步数</label>
            <input
              className="input"
              type="number"
              value={draft.comfyuiConfig.steps ?? 20}
              onChange={(e) => update({ comfyuiConfig: { ...draft.comfyuiConfig, steps: Number(e.target.value) || undefined } })}
            />
          </div>
          <div className="form-group">
            <label className="form-label text-sm">CFG 引导系数</label>
            <input
              className="input"
              type="number"
              value={draft.comfyuiConfig.cfgScale ?? 8}
              onChange={(e) => update({ comfyuiConfig: { ...draft.comfyuiConfig, cfgScale: Number(e.target.value) || undefined } })}
            />
          </div>
        </>
      ) : null}

      {draft.provider === "grok" ? (
        <>
          <div className="form-group">
            <label className="form-label text-sm">视频生成模型</label>
            <input
              className="input"
              value={draft.grokConfig.videoModel ?? ""}
              placeholder="grok-imagine-1.0-video"
              onChange={(e) => update({ grokConfig: { ...draft.grokConfig, videoModel: e.target.value || undefined } })}
            />
          </div>
          <div className="form-group">
            <label className="form-label text-sm">画面比例</label>
            <select
              className="input"
              value={draft.grokConfig.aspectRatio ?? "16:9"}
              onChange={(e) => update({ grokConfig: { ...draft.grokConfig, aspectRatio: e.target.value } })}
            >
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
              <option value="1:1">1:1</option>
              <option value="2:3">2:3</option>
              <option value="3:2">3:2</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label text-sm">视频时长（秒）</label>
            <input
              className="input"
              type="number"
              min={5}
              max={15}
              value={draft.grokConfig.videoLength ?? 6}
              onChange={(e) => update({ grokConfig: { ...draft.grokConfig, videoLength: Number(e.target.value) || undefined } })}
            />
          </div>
          <div className="form-group">
            <label className="form-label text-sm">视频分辨率</label>
            <select
              className="input"
              value={draft.grokConfig.resolution ?? "HD"}
              onChange={(e) => update({ grokConfig: { ...draft.grokConfig, resolution: e.target.value as "SD" | "HD" } })}
            >
              <option value="SD">SD</option>
              <option value="HD">HD</option>
            </select>
          </div>
        </>
      ) : null}
    </div>
  );
}
