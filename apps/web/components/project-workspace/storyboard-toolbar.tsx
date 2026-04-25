/**
 * @fileoverview 分镜工具栏
 * @module web/components/project-workspace
 *
 * 分镜工作台的操作工具栏。
 */

"use client";

import { useState, useRef, useEffect } from "react";
import type { ImageConfigSource, StoryboardContent } from "@dramaflow/shared";
import { getStoryboardEstimatedDuration, getStoryboardSceneIds } from "@dramaflow/shared";

import { useI18n } from "../../lib/i18n";

type ShotFilter = "all" | "unfinished" | "candidates";

interface SceneGroup {
  sceneId: string;
  heading?: string;
}

interface Props {
  content: StoryboardContent;
  editable: boolean;
  canMutateProject: boolean;
  filter: ShotFilter;
  onFilterChange: (filter: ShotFilter) => void;
  onAddScene: (sceneId: string) => void;
  onAddShot: (sceneId: string) => void;
  onBatchGenerateImages: () => void;
  isBatchPending: boolean;
  allImagesReady: boolean;
  imageConfigSource: ImageConfigSource;
  onImageConfigSourceChange: (source: ImageConfigSource) => void;
  sceneGroups: SceneGroup[];
  selectedSceneId: string;
  onSceneSelect: (sceneId: string) => void;
  onBatchSceneTts: () => void;
  isBatchTtsPending: boolean;
  hasEligibleTtsShots: boolean;
}

function ChevronDownIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2.5 4.5l3.5 3.5 3.5-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M6 1h2l.5 2 1.5.9 2-.5 1 1.7-1.5 1.5.1 1.8L13 9.5l-1 1.7-2-.5-1.5.9L8 13.5H6l-.5-2-1.5-.9-2 .5-1-1.7 1.5-1.5L2.4 8 1 6.5l1-1.7 2 .5 1.5-.9L6 1z" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

export function StoryboardToolbar({
  content,
  editable,
  canMutateProject,
  filter,
  onFilterChange,
  onAddScene,
  onAddShot,
  onBatchGenerateImages,
  isBatchPending,
  allImagesReady,
  imageConfigSource,
  onImageConfigSourceChange,
  sceneGroups,
  selectedSceneId,
  onSceneSelect,
  onBatchSceneTts,
  isBatchTtsPending,
  hasEligibleTtsShots,
}: Props) {
  const { t } = useI18n();
  const [sceneDropdownOpen, setSceneDropdownOpen] = useState(false);
  const [batchDropdownOpen, setBatchDropdownOpen] = useState(false);
  const sceneDropdownRef = useRef<HTMLDivElement>(null);
  const batchDropdownRef = useRef<HTMLDivElement>(null);

  const sceneCount = getStoryboardSceneIds(content).length;
  const shotCount = content.shots.length;
  const totalDuration = getStoryboardEstimatedDuration(content);
  const durationText = totalDuration >= 60
    ? `${Math.floor(totalDuration / 60)}m ${Math.round(totalDuration % 60)}s`
    : `${Math.round(totalDuration)}s`;

  const selectedGroupIndex = sceneGroups.findIndex((g) => g.sceneId === selectedSceneId);
  const selectedGroup = selectedGroupIndex >= 0 ? sceneGroups[selectedGroupIndex] : undefined;
  const selectedSceneLabel = selectedGroup?.heading
    || (selectedGroupIndex >= 0
      ? t("storyboardToolbar.scenePrefix", { index: String(selectedGroupIndex + 1) })
      : t("storyboardToolbar.untitledScene"));

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (sceneDropdownRef.current && !sceneDropdownRef.current.contains(e.target as Node)) {
        setSceneDropdownOpen(false);
      }
      if (batchDropdownRef.current && !batchDropdownRef.current.contains(e.target as Node)) {
        setBatchDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filters: { key: ShotFilter; label: string }[] = [
    { key: "all", label: t("storyboardToolbar.filterAll") },
    { key: "unfinished", label: t("storyboardToolbar.filterUnfinished") },
    { key: "candidates", label: t("storyboardToolbar.filterCandidates") },
  ];

  return (
    <div className="swb-toolbar">
      <div className="swb-toolbar__left">
        {/* Scene selector dropdown */}
        <div className="swb-toolbar__scene-select" ref={sceneDropdownRef}>
          <button
            className="swb-toolbar__scene-btn"
            type="button"
            onClick={() => setSceneDropdownOpen(!sceneDropdownOpen)}
          >
            {selectedSceneLabel}
            <ChevronDownIcon />
          </button>
          {sceneDropdownOpen && (
            <div className="swb-toolbar__dropdown">
              {sceneGroups.map((group, index) => (
                <button
                  key={group.sceneId}
                  className={`swb-toolbar__dropdown-item${group.sceneId === selectedSceneId ? " swb-toolbar__dropdown-item--active" : ""}`}
                  type="button"
                  onClick={() => {
                    onSceneSelect(group.sceneId);
                    setSceneDropdownOpen(false);
                  }}
                >
                  {t("storyboardToolbar.scenePrefix", { index: String(index + 1) })}: {group.heading || t("storyboardToolbar.untitledScene")}
                </button>
              ))}
              {editable && (
                <>
                  <div className="swb-toolbar__dropdown-divider" />
                  <button
                    className="swb-toolbar__dropdown-item"
                    type="button"
                    onClick={() => {
                      const id = `scene-${sceneCount + 1}`;
                      onAddScene(id);
                      setSceneDropdownOpen(false);
                    }}
                  >
                    <PlusIcon /> {t("storyboardEditor.addScene")}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Stats */}
        <span className="swb-toolbar__stat">
          {shotCount} {t("storyboardToolbar.shotsUnit")} · {durationText}
        </span>

        {/* Filter chips */}
        <div className="swb-toolbar__filters">
          {filters.map((f) => (
            <button
              key={f.key}
              className={`swb-toolbar__chip${filter === f.key ? " swb-toolbar__chip--active" : ""}`}
              type="button"
              onClick={() => onFilterChange(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="swb-toolbar__right">
        {/* Add shot */}
        {editable && (
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            onClick={() => onAddShot(selectedSceneId)}
          >
            <PlusIcon /> {t("storyboardEditor.addShot")}
          </button>
        )}

        {/* Batch actions */}
        {canMutateProject && (
          <div className="swb-toolbar__batch" ref={batchDropdownRef}>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => setBatchDropdownOpen(!batchDropdownOpen)}
            >
              <SettingsIcon />
            </button>
            {batchDropdownOpen && (
              <div className="swb-toolbar__dropdown swb-toolbar__dropdown--right">
                <label className="swb-toolbar__config-row">
                  <span>{t("projectWorkspace.media.imageConfigSourceLabel")}</span>
                  <select
                    value={imageConfigSource}
                    onChange={(e) => onImageConfigSourceChange(e.target.value as ImageConfigSource)}
                  >
                    <option value="team">{t("projectWorkspace.media.imageConfigSourceTeam")}</option>
                    <option value="personal">{t("projectWorkspace.media.imageConfigSourcePersonal")}</option>
                  </select>
                </label>
                <button
                  className="swb-toolbar__dropdown-item"
                  type="button"
                  disabled={isBatchPending || allImagesReady}
                  onClick={() => {
                    onBatchGenerateImages();
                    setBatchDropdownOpen(false);
                  }}
                >
                  {isBatchPending
                    ? t("common.submitting")
                    : t("projectWorkspace.media.batchGenerateMissingImages")}
                </button>
                <button
                  className="swb-toolbar__dropdown-item"
                  type="button"
                  disabled={isBatchTtsPending || !hasEligibleTtsShots}
                  onClick={() => {
                    onBatchSceneTts();
                    setBatchDropdownOpen(false);
                  }}
                >
                  {isBatchTtsPending ? t("common.submitting") : t("storyboardEditor.batchSceneTts")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
