"use client";

import type { ProjectWorkspacePayload } from "@dramaflow/shared";

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
  isAdopted: boolean;
  mediaType: "image" | "video";
  canMutateProject: boolean;
  isAdoptPending: boolean;
  canSelect: boolean;
  onThumbnailClick: (candidate: VersionItem) => void;
  onAdopt: (candidate: VersionItem) => void;
  onSelect?: (candidate: VersionItem) => void;
}

function CandidateCard({ candidate, isAdopted, mediaType, canMutateProject, isAdoptPending, canSelect, onThumbnailClick, onAdopt, onSelect }: CandidateCardProps) {
  const content = (candidate.content ?? {}) as MediaVersionContent;
  const assetUrl = content.assetUrl;
  const mimeType = content.mimeType ?? (mediaType === "image" ? "image/png" : "video/mp4");
  const isVideo = mimeType.startsWith("video/") || mediaType === "video";

  return (
    <div className={`sm-candidate-thumb${isAdopted ? " sm-candidate-thumb--adopted" : ""}`}>
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
          <span className="sm-candidate-thumb__empty">—</span>
        )}
        {isAdopted && <span className="sm-candidate-thumb__badge">✓</span>}
      </div>
      <div className="sm-candidate-thumb__info">
        <span className="sm-candidate-thumb__version">V{candidate.versionNumber}</span>
        {content.model && <span className="sm-candidate-thumb__model">{content.model}</span>}
      </div>
      <div className="sm-candidate-thumb__actions">
        {canSelect && onSelect && (
          <button
            className="btn btn-primary btn-sm"
            type="button"
            onClick={(e) => { e.stopPropagation(); onSelect(candidate); }}
          >
            Select
          </button>
        )}
        <button
          className="btn btn-ghost btn-sm"
          type="button"
          disabled={!canMutateProject || isAdoptPending || isAdopted}
          onClick={(e) => { e.stopPropagation(); onAdopt(candidate); }}
        >
          {isAdopted ? "✓" : "Adopt"}
        </button>
      </div>
    </div>
  );
}

interface Props {
  candidates: ProjectWorkspacePayload["versions"];
  currentVersionId: string | undefined;
  mediaType: "image" | "video";
  canMutateProject: boolean;
  isAdoptPending: boolean;
  canSelect: boolean;
  onThumbnailClick: (candidate: VersionItem) => void;
  onAdopt: (candidate: VersionItem) => void;
  onSelect?: (candidate: VersionItem) => void;
}

export function CandidateThumbnailGrid({
  candidates,
  currentVersionId,
  mediaType,
  canMutateProject,
  isAdoptPending,
  canSelect,
  onThumbnailClick,
  onAdopt,
  onSelect,
}: Props) {
  if (!candidates.length) return null;

  return (
    <div className="sm-candidates-grid">
      {candidates.map((candidate) => (
        <CandidateCard
          key={candidate.id}
          candidate={candidate}
          isAdopted={candidate.id === currentVersionId}
          mediaType={mediaType}
          canMutateProject={canMutateProject}
          isAdoptPending={isAdoptPending}
          canSelect={canSelect}
          onThumbnailClick={onThumbnailClick}
          onAdopt={onAdopt}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
