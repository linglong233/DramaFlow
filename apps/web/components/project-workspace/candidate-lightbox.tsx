"use client";

import { useEffect, useCallback, useState } from "react";
import { createPortal } from "react-dom";
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

interface Props {
  candidate: VersionItem;
  allCandidates: VersionItem[];
  currentIndex: number;
  canMutateProject: boolean;
  isSetCurrentUsePending: boolean;
  isAdoptPending: boolean;
  mediaType: "image" | "video";
  documentId: string | undefined;
  currentUseVersionId: string | undefined;
  baselineVersionId: string | undefined;
  onAdoptAsBaseline: (documentId: string, versionId: string) => void;
  onUseForShot?: (versionId: string) => void;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  const d = direction === "left"
    ? "M10 3L5 8l5 5"
    : "M6 3l5 5-5 5";
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CandidateLightbox({
  candidate,
  allCandidates,
  currentIndex,
  canMutateProject,
  isSetCurrentUsePending,
  isAdoptPending,
  mediaType,
  documentId,
  currentUseVersionId,
  baselineVersionId,
  onAdoptAsBaseline,
  onUseForShot,
  onClose,
  onNavigate,
}: Props) {
  const { t } = useI18n();
  const [mounted, setMounted] = useState(true);
  const [closing, setClosing] = useState(false);

  const content = (candidate.content ?? {}) as MediaVersionContent;
  const assetUrl = content.assetUrl;
  const mimeType = content.mimeType ?? (mediaType === "image" ? "image/png" : "video/mp4");
  const isVideo = mimeType.startsWith("video/") || mediaType === "video";
  const isInUse = candidate.id === currentUseVersionId;
  const isBaseline = candidate.id === baselineVersionId;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < allCandidates.length - 1;

  function handleClose() {
    setClosing(true);
    setTimeout(() => {
      setMounted(false);
      onClose();
    }, 150);
  }

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") { handleClose(); return; }
    if (e.key === "ArrowLeft" && hasPrev) { e.preventDefault(); onNavigate(currentIndex - 1); }
    if (e.key === "ArrowRight" && hasNext) { e.preventDefault(); onNavigate(currentIndex + 1); }
  }, [hasPrev, hasNext, currentIndex, onNavigate]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (!mounted) return null;

  return createPortal(
    <div
      className={`sm-lightbox${closing ? " sm-lightbox--closing" : ""}`}
      onClick={handleClose}
    >
      <div className="sm-lightbox__content" onClick={(e) => e.stopPropagation()}>
        {/* Close button */}
        <button className="sm-lightbox__close" type="button" onClick={handleClose}>
          <CloseIcon />
        </button>

        {/* Nav arrows */}
        {hasPrev && (
          <button
            className="sm-lightbox__nav sm-lightbox__nav--prev"
            type="button"
            onClick={(e) => { e.stopPropagation(); onNavigate(currentIndex - 1); }}
          >
            <ChevronIcon direction="left" />
          </button>
        )}
        {hasNext && (
          <button
            className="sm-lightbox__nav sm-lightbox__nav--next"
            type="button"
            onClick={(e) => { e.stopPropagation(); onNavigate(currentIndex + 1); }}
          >
            <ChevronIcon direction="right" />
          </button>
        )}

        {/* Media */}
        <div className="sm-lightbox__media">
          {assetUrl ? (
            isVideo ? (
              <video
                key={assetUrl}
                src={assetUrl}
                controls
                playsInline
                autoPlay
                className="sm-lightbox__image"
              />
            ) : (
              <img
                key={assetUrl}
                src={assetUrl}
                alt={candidate.title}
                className="sm-lightbox__image"
              />
            )
          ) : (
            <span className="sm-lightbox__empty">{t("shotDetailDrawer.noMediaYet")}</span>
          )}
        </div>

        {/* Bottom bar */}
        <div className="sm-lightbox__bar">
          <div className="sm-lightbox__info">
            <span className="sm-lightbox__version">V{candidate.versionNumber}</span>
            {content.model && <span className="sm-lightbox__model">{content.model}</span>}
            <span className="sm-lightbox__position">{currentIndex + 1}/{allCandidates.length}</span>
          </div>
          <div className="sm-lightbox__actions">
            {canMutateProject && onUseForShot && documentId && (
              isInUse ? (
                <button className="btn btn-primary btn-sm" type="button" disabled aria-current="true">
                  {t("shotDetailDrawer.inUse")}
                </button>
              ) : (
                <button
                  className="btn btn-primary btn-sm"
                  type="button"
                  disabled={isSetCurrentUsePending}
                  onClick={(e) => { e.stopPropagation(); onUseForShot(candidate.id); }}
                >
                  {t("shotDetailDrawer.useForShot")}
                </button>
              )
            )}
            {canMutateProject && documentId && (
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                disabled={isAdoptPending || isBaseline}
                onClick={(e) => { e.stopPropagation(); onAdoptAsBaseline(documentId, candidate.id); }}
              >
                {isBaseline ? t("shotDetailDrawer.baselineAdopted") : t("shotDetailDrawer.adoptAsBaseline")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
