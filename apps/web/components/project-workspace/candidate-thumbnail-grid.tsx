"use client";

import type { ProjectWorkspacePayload } from "@dramaflow/shared";
import { useI18n } from "../../lib/i18n";

interface MediaVersionContent {
  assetId?: string;
  assetUrl?: string;
  mimeType?: string;
  model?: string;
  duration?: number;
}

type VersionItem = ProjectWorkspacePayload["versions"][number];

interface CandidateCardProps {
  candidate: VersionItem;
  isInUse: boolean;
  isBaseline: boolean;
  mediaType: "image" | "video";
  canMutateProject: boolean;
  canUseForShot: boolean;
  isSetCurrentUsePending: boolean;
  isAdoptPending: boolean;
  onThumbnailClick: (candidate: VersionItem) => void;
  onUseForShot?: (candidate: VersionItem) => void;
  onAdoptAsBaseline: (candidate: VersionItem) => void;
}

function CandidateCard({
  candidate,
  isInUse,
  isBaseline,
  mediaType,
  canMutateProject,
  canUseForShot,
  isSetCurrentUsePending,
  isAdoptPending,
  onThumbnailClick,
  onUseForShot,
  onAdoptAsBaseline,
}: CandidateCardProps) {
  const { t } = useI18n();
  const content = (candidate.content ?? {}) as MediaVersionContent;
  const assetUrl = content.assetUrl;
  const mimeType = content.mimeType ?? (mediaType === "image" ? "image/png" : "video/mp4");
  const isVideo = mimeType.startsWith("video/") || mediaType === "video";

  return (
    <div className={`sm-candidate-thumb${isInUse ? " sm-candidate-thumb--adopted" : ""}`}>
      <div
        className="sm-candidate-thumb__preview"
        role="button"
        tabIndex={0}
        onClick={() => onThumbnailClick(candidate)}
        onKeyDown={(e) => { if (e.key === "Enter") onThumbnailClick(candidate); }}
      >
        {assetUrl ? (
          isVideo ? (
            <video
              src={assetUrl}
              className="sm-candidate-thumb__image"
              preload="metadata"
              muted
              playsInline
            />
          ) : (
            <img
              src={assetUrl}
              alt={candidate.title}
              className="sm-candidate-thumb__image"
              loading="lazy"
            />
          )
        ) : (
          <span className="sm-candidate-thumb__empty">-</span>
        )}
        {isInUse && <span className="sm-candidate-thumb__badge">{t("shotDetailDrawer.inUse")}</span>}
      </div>
      <div className="sm-candidate-thumb__info">
        <span className="sm-candidate-thumb__version">V{candidate.versionNumber}</span>
        <span className="sm-candidate-thumb__model">{isInUse ? t("shotDetailDrawer.inUse") : t("shotDetailDrawer.candidateStatus")}</span>
        {content.model && <span className="sm-candidate-thumb__model">{content.model}</span>}
      </div>
      <div className="sm-candidate-thumb__actions">
        {isInUse ? (
          <button className="btn btn-primary btn-sm" type="button" disabled aria-current="true">
            {t("shotDetailDrawer.inUse")}
          </button>
        ) : (
          canUseForShot && onUseForShot && (
            <button
              className="btn btn-primary btn-sm"
              type="button"
              disabled={isSetCurrentUsePending}
              onClick={(e) => { e.stopPropagation(); onUseForShot(candidate); }}
            >
              {t("shotDetailDrawer.useForShot")}
            </button>
          )
        )}
        <button
          className="btn btn-ghost btn-sm"
          type="button"
          disabled={!canMutateProject || isAdoptPending || isBaseline}
          onClick={(e) => { e.stopPropagation(); onAdoptAsBaseline(candidate); }}
        >
          {isBaseline ? t("shotDetailDrawer.baselineAdopted") : t("shotDetailDrawer.adoptAsBaseline")}
        </button>
      </div>
    </div>
  );
}

interface Props {
  candidates: ProjectWorkspacePayload["versions"];
  currentUseVersionId: string | undefined;
  baselineVersionId: string | undefined;
  mediaType: "image" | "video";
  canMutateProject: boolean;
  isSetCurrentUsePending: boolean;
  isAdoptPending: boolean;
  canUseForShot: boolean;
  onThumbnailClick: (candidate: VersionItem) => void;
  onAdoptAsBaseline: (candidate: VersionItem) => void;
  onUseForShot?: (candidate: VersionItem) => void;
}

export function CandidateThumbnailGrid({
  candidates,
  currentUseVersionId,
  baselineVersionId,
  mediaType,
  canMutateProject,
  isSetCurrentUsePending,
  isAdoptPending,
  canUseForShot,
  onThumbnailClick,
  onAdoptAsBaseline,
  onUseForShot,
}: Props) {
  if (!candidates.length) return null;

  return (
    <div className="sm-candidates-grid">
      {candidates.map((candidate) => (
        <CandidateCard
          key={candidate.id}
          candidate={candidate}
          isInUse={candidate.id === currentUseVersionId}
          isBaseline={candidate.id === baselineVersionId}
          mediaType={mediaType}
          canMutateProject={canMutateProject}
          canUseForShot={canUseForShot}
          isSetCurrentUsePending={isSetCurrentUsePending}
          isAdoptPending={isAdoptPending}
          onThumbnailClick={onThumbnailClick}
          onAdoptAsBaseline={onAdoptAsBaseline}
          onUseForShot={onUseForShot}
        />
      ))}
    </div>
  );
}
