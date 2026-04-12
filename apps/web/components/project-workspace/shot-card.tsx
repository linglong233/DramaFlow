/**
 * @fileoverview 镜头卡片
 * @module web/components/project-workspace
 *
 * 分镜工作台中的单个镜头视觉卡片。
 */

"use client";

import type { StoryboardShot } from "@dramaflow/shared";
import {
  getStoryboardCameraMoveLabel,
  getStoryboardFramingLabel,
} from "@dramaflow/shared";

import { useI18n } from "../../lib/i18n";

interface ShotProjectState {
  hasImage: boolean;
  hasVideo: boolean;
  hasAudio: boolean;
  currentImage: { content?: unknown } | null;
  jobs: {
    image?: { status: string };
    video?: { status: string };
    tts?: { status: string };
  };
}

interface Props {
  shot: StoryboardShot;
  state: ShotProjectState | null;
  isSelected: boolean;
  onClick: () => void;
}

function StatusDot({ has, jobStatus }: { has: boolean; jobStatus?: string }) {
  if (has) {
    return (
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          backgroundColor: "var(--success-bg, #22c55e)",
          display: "inline-block",
        }}
        title="Done"
      />
    );
  }
  if (jobStatus === "running" || jobStatus === "queued") {
    return (
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          backgroundColor: "var(--warning-bg, #eab308)",
          display: "inline-block",
          boxShadow: "0 0 6px rgba(56,189,248,0.4)",
          animation: "uw-pulse 1.5s ease-in-out infinite",
        }}
        title={jobStatus}
      />
    );
  }
  return (
    <span
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        backgroundColor: "var(--text-tertiary)",
        display: "inline-block",
      }}
      title="Not started"
    />
  );
}

function ImageIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1.5" y="2.5" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="5" cy="6" r="1.2" stroke="currentColor" strokeWidth="1" />
      <path d="M1.5 9.5l3-2.5 2 2 3-3 3 3" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1" y="2" width="9" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10 5l3-2v8l-3-2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="5" y="1" width="4" height="7" rx="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3 7a4 4 0 008 0M7 11v2M5 13h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ShotCard({ shot, state, isSelected, onClick }: Props) {
  const { locale } = useI18n();
  const lang = locale === "en" ? "en" : "zh-CN";

  const imageUrl = (state?.currentImage?.content as Record<string, string> | undefined)?.assetUrl;
  const visualPreview = shot.visualDescription
    ? shot.visualDescription.length > 40
      ? shot.visualDescription.slice(0, 40) + "..."
      : shot.visualDescription
    : "";
  const cameraLabel = getStoryboardCameraMoveLabel(shot.cameraMove, lang);
  const framingLabel = getStoryboardFramingLabel(shot.framing, lang);
  const durationText = shot.durationSeconds >= 60
    ? `${Math.floor(shot.durationSeconds / 60)}m ${shot.durationSeconds % 60}s`
    : `${shot.durationSeconds}s`;

  return (
    <button
      className={`shot-card${isSelected ? " shot-card--selected" : ""}`}
      type="button"
      onClick={onClick}
      title={`${shot.shotLabel} — ${framingLabel}`}
    >
      <div className="shot-card__header">
        <span className="shot-card__label">{shot.shotLabel}</span>
        <span className="shot-card__framing">{framingLabel}</span>
      </div>
      <div className="shot-card__body">
        {imageUrl ? (
          <img className="shot-card__thumb" src={imageUrl} alt={shot.shotLabel} loading="lazy" />
        ) : (
          <span className="shot-card__placeholder">{visualPreview || "—"}</span>
        )}
      </div>
      <div className="shot-card__footer">
        <span className="shot-card__meta">
          {cameraLabel} · {durationText}
        </span>
        <span className="shot-card__status">
          <span className="shot-card__status-item">
            <ImageIcon />
            <StatusDot has={state?.hasImage ?? false} jobStatus={state?.jobs.image?.status} />
          </span>
          <span className="shot-card__status-item">
            <VideoIcon />
            <StatusDot has={state?.hasVideo ?? false} jobStatus={state?.jobs.video?.status} />
          </span>
          <span className="shot-card__status-item">
            <MicIcon />
            <StatusDot has={state?.hasAudio ?? false} jobStatus={state?.jobs.tts?.status} />
          </span>
        </span>
      </div>
    </button>
  );
}
