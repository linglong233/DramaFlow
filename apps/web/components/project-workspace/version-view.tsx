"use client";

import { useState, useCallback, useMemo } from "react";
import {
  normalizeScriptContent,
  normalizeStoryboardContent,
  normalizeWorldBibleContent,
  getStoryboardFramingLabel,
  getStoryboardCameraMoveLabel,
  getStoryboardSceneIds,
  getStoryboardEstimatedDuration,
  type CharacterProfile,
  type LocationProfile,
  type ProjectWorkspacePayload,
  type ScriptContent,
  type ScriptScene,
  type StoryboardContent,
  type StoryboardShot,
  type WorldBibleContent,
} from "@dramaflow/shared";
import { useI18n, getVersionStatusLabel } from "../../lib/i18n";
import { StoryboardWorkbench } from "./storyboard-workbench";

interface Version {
  id: string;
  title: string;
  versionNumber: number;
  status: string;
  content: unknown;
  createdAt: string;
}

export function isStoryboardContent(content: unknown): content is StoryboardContent {
  return typeof content === "object" && content !== null && ("shots" in content || "overview" in content);
}

export function isScriptContent(content: unknown): content is ScriptContent {
  return typeof content === "object" && content !== null && ("scenes" in content || "logline" in content || "premise" in content);
}

export function isWorldBibleContent(content: unknown): content is WorldBibleContent {
  return typeof content === "object" && content !== null && ("characters" in content || "locations" in content || "styleGuide" in content || "voiceConfigs" in content);
}

function SceneCard({ scene, index, expanded, onToggle }: { scene: ScriptScene; index: number; expanded: boolean; onToggle: () => void }) {
  const hasDialogue = scene.dialogue.length > 0;
  const hasDetails = hasDialogue || Boolean(scene.directorNote);

  return (
    <div
      className={`vv-scene${expanded ? " vv-scene--expanded" : ""}`}
      onClick={hasDetails ? onToggle : undefined}
      role={hasDetails ? "button" : undefined}
      tabIndex={hasDetails ? 0 : undefined}
      onKeyDown={hasDetails ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } } : undefined}
      style={{ cursor: hasDetails ? "pointer" : "default" }}
    >
      <div className="vv-scene__head">
        <div className="vv-scene__head-left">
          <span className="vv-scene__number">Scene {index + 1}</span>
          <h3 className="vv-scene__heading">
            {scene.heading || `Untitled Scene ${index + 1}`}
            {scene.locationId ? <span className="vv-sync-badge" title="Linked world-bible location">Link</span> : null}
          </h3>
        </div>
        <div className="vv-scene__head-right">
          {hasDialogue ? (
            <span className="vv-scene__meta-badge">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              {scene.dialogue.length}
            </span>
          ) : null}
          {scene.characters.length > 0 ? (
            <span className="vv-scene__meta-badge">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              {scene.characters.length}
            </span>
          ) : null}
          {hasDetails ? (
            <span className={`vv-scene__chevron${expanded ? " vv-scene__chevron--open" : ""}`}>▼</span>
          ) : null}
        </div>
      </div>

      <p className={`vv-scene__synopsis${expanded ? "" : " vv-scene__synopsis--clamped"}`}>
        {scene.synopsis || "No synopsis yet."}
      </p>

      {/* Always-visible character tags (compact row) */}
      {scene.characters.length > 0 ? (
        <div className="vv-scene__chars">
          {scene.characters.map((character, itemIndex) => (
            <span key={`${scene.id}-character-${itemIndex}`} className="vv-tag">{character}</span>
          ))}
        </div>
      ) : null}

      {/* Expandable details section */}
      {expanded && hasDetails ? (
        <div className="vv-scene__details">
          {hasDialogue ? (
            <div className="vv-dialogue-list">
              {scene.dialogue.map((dialogue, itemIndex) => (
                <div key={`${scene.id}-dialogue-${itemIndex}`} className="vv-dialogue">
                  <span className="vv-dialogue__speaker">{dialogue.speaker || "Narration"}</span>
                  <span className="vv-dialogue__line">{dialogue.line}</span>
                </div>
              ))}
            </div>
          ) : null}
          {scene.directorNote ? (
            <div className="vv-scene__director-note">
              <span className="vv-scene__director-note-label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                Director Note
              </span>
              <span className="vv-scene__director-note-value">{scene.directorNote}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Expand hint */}
      {!expanded && hasDetails ? (
        <div className="vv-scene__expand-hint">Click to expand details</div>
      ) : null}
    </div>
  );
}

export function StoryboardView({
  content,
  projectId,
  project,
  allowProjectMutations = true,
}: {
  content: StoryboardContent;
  projectId?: string;
  project?: ProjectWorkspacePayload;
  allowProjectMutations?: boolean;
}) {
  const safeContent = normalizeStoryboardContent(content);

  return (
    <StoryboardWorkbench
      content={safeContent}
      projectId={projectId}
      project={project}
      allowProjectMutations={allowProjectMutations}
    />
  );
}

/* ──────────────────────────────────────────
   StoryboardPreview — Lightweight read-only
   preview for the generation results page.
   ────────────────────────────────────────── */

function ShotPreviewCard({ shot, index }: { shot: StoryboardShot; index: number }) {
  const { locale } = useI18n();
  const lang = locale === "en" ? "en" : "zh-CN";
  const [expanded, setExpanded] = useState(false);

  const hasDetail = Boolean(shot.actionDescription || shot.dialogue || shot.soundDesign || shot.notes || shot.imagePrompt || shot.videoPrompt);

  return (
    <div
      className={`sbp-card${expanded ? " sbp-card--open" : ""}`}
      style={{ animationDelay: `${index * 0.04}s` }}
    >
      <div
        className="sbp-card__head"
        onClick={hasDetail ? () => setExpanded(!expanded) : undefined}
        role={hasDetail ? "button" : undefined}
        tabIndex={hasDetail ? 0 : undefined}
        onKeyDown={hasDetail ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(!expanded); } } : undefined}
        style={{ cursor: hasDetail ? "pointer" : "default" }}
      >
        <div className="sbp-card__label">
          <span className="sbp-card__id">{shot.shotLabel}</span>
          <span className="sbp-card__framing">{getStoryboardFramingLabel(shot.framing, lang)}</span>
          <span className="sbp-card__camera">{getStoryboardCameraMoveLabel(shot.cameraMove, lang)}</span>
          <span className="sbp-card__dur">{shot.durationSeconds}s</span>
        </div>
        {hasDetail ? (
          <span className={`sbp-card__chevron${expanded ? " sbp-card__chevron--open" : ""}`}>▾</span>
        ) : null}
      </div>

      {shot.visualDescription ? (
        <p className={`sbp-card__visual${expanded ? "" : " sbp-card__visual--clamp"}`}>
          {shot.visualDescription}
        </p>
      ) : null}

      {shot.dialogue && !expanded ? (
        <p className="sbp-card__dialogue-hint">💬 {shot.dialogue.length > 60 ? shot.dialogue.slice(0, 60) + "..." : shot.dialogue}</p>
      ) : null}

      {expanded && hasDetail ? (
        <div className="sbp-card__details">
          {shot.actionDescription ? (
            <div className="sbp-card__field">
              <span className="sbp-card__field-label">Action</span>
              <span className="sbp-card__field-value">{shot.actionDescription}</span>
            </div>
          ) : null}
          {shot.dialogue ? (
            <div className="sbp-card__field">
              <span className="sbp-card__field-label">Dialogue</span>
              <span className="sbp-card__field-value">{shot.dialogue}</span>
            </div>
          ) : null}
          {shot.soundDesign ? (
            <div className="sbp-card__field">
              <span className="sbp-card__field-label">Sound</span>
              <span className="sbp-card__field-value">{shot.soundDesign}</span>
            </div>
          ) : null}
          {shot.notes ? (
            <div className="sbp-card__field">
              <span className="sbp-card__field-label">Notes</span>
              <span className="sbp-card__field-value">{shot.notes}</span>
            </div>
          ) : null}
          {shot.imagePrompt ? (
            <div className="sbp-card__field sbp-card__field--prompt">
              <span className="sbp-card__field-label">Image Prompt</span>
              <span className="sbp-card__field-value">{shot.imagePrompt}</span>
            </div>
          ) : null}
          {shot.videoPrompt ? (
            <div className="sbp-card__field sbp-card__field--prompt">
              <span className="sbp-card__field-label">Video Prompt</span>
              <span className="sbp-card__field-value">{shot.videoPrompt}</span>
            </div>
          ) : null}
          {shot.characterIds && shot.characterIds.length > 0 ? (
            <div className="sbp-card__chars">
              {shot.characterIds.map((cid) => (
                <span key={cid} className="vv-tag">{cid}</span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function StoryboardPreview({ content }: { content: StoryboardContent }) {
  const safeContent = normalizeStoryboardContent(content);
  const { locale } = useI18n();
  const lang = locale === "en" ? "en" : "zh-CN";

  const sceneGroups = useMemo(() => {
    const map = new Map<string, StoryboardShot[]>();
    for (const shot of safeContent.shots) {
      const group = map.get(shot.sceneId) ?? [];
      group.push(shot);
      map.set(shot.sceneId, group);
    }
    return Array.from(map.entries());
  }, [safeContent.shots]);

  const stats = useMemo(() => ({
    scenes: getStoryboardSceneIds(safeContent).length,
    shots: safeContent.shots.length,
    duration: getStoryboardEstimatedDuration(safeContent),
  }), [safeContent]);

  const durationStr = stats.duration < 60
    ? `${Math.round(stats.duration)}s`
    : `${Math.floor(stats.duration / 60)}m ${Math.round(stats.duration % 60)}s`;

  return (
    <div className="sbp-root">
      {/* Overview */}
      {safeContent.overview ? (
        <div className="sbp-overview">
          <p>{safeContent.overview}</p>
        </div>
      ) : null}

      {/* Stats bar */}
      <div className="sbp-stats">
        <div className="sbp-stat"><span>{lang === "en" ? "Scenes" : "场次"}</span><strong>{stats.scenes}</strong></div>
        <div className="sbp-stat"><span>{lang === "en" ? "Shots" : "镜头"}</span><strong>{stats.shots}</strong></div>
        <div className="sbp-stat"><span>{lang === "en" ? "Duration" : "时长"}</span><strong>{durationStr}</strong></div>
      </div>

      {/* Scene groups */}
      {sceneGroups.map(([sceneId, shots], groupIndex) => (
        <div key={sceneId} className="sbp-scene">
          <div className="sbp-scene__head">
            <span className="sbp-scene__num">{lang === "en" ? "Scene" : "场次"} {groupIndex + 1}</span>
            <span className="sbp-scene__id">{sceneId}</span>
            <span className="sbp-scene__count">{shots.length} {lang === "en" ? "shots" : "镜头"}</span>
          </div>
          <div className="sbp-scene__shots">
            {shots.map((shot, shotIndex) => (
              <ShotPreviewCard key={shot.id} shot={shot} index={shotIndex} />
            ))}
          </div>
        </div>
      ))}

      {safeContent.shots.length === 0 ? (
        <div className="sbp-empty">{lang === "en" ? "No storyboard shots generated yet." : "暂无分镜数据。"}</div>
      ) : null}
    </div>
  );
}
export function ScriptView({ content }: { content: ScriptContent }) {
  const safeContent = normalizeScriptContent(content);
  const [expandedScenes, setExpandedScenes] = useState<Set<string>>(new Set());
  const allExpanded = safeContent.scenes.length > 0 && expandedScenes.size === safeContent.scenes.length;

  const toggleScene = useCallback((sceneId: string) => {
    setExpandedScenes((prev) => {
      const next = new Set(prev);
      if (next.has(sceneId)) {
        next.delete(sceneId);
      } else {
        next.add(sceneId);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (allExpanded) {
      setExpandedScenes(new Set());
    } else {
      setExpandedScenes(new Set(safeContent.scenes.map((s) => s.id)));
    }
  }, [allExpanded, safeContent.scenes]);

  return (
    <div className="vv-content">
      {safeContent.logline ? (
        <div className="vv-hero-field">
          <span className="vv-hero-field__label">Logline</span>
          <p className="vv-hero-field__value">{safeContent.logline}</p>
        </div>
      ) : null}
      {safeContent.premise ? (
        <div className="vv-hero-field">
          <span className="vv-hero-field__label">Premise</span>
          <p className="vv-hero-field__value">{safeContent.premise}</p>
        </div>
      ) : null}
      {safeContent.characters.length > 0 ? (
        <div className="vv-hero-field">
          <span className="vv-hero-field__label">Characters</span>
          <div className="vv-char-list">
            {safeContent.characters.map((character, index) => (
              <div key={`${character.name}-${index}`} className="vv-char">
                <strong>
                  {character.name || `Character ${index + 1}`}
                  {character.worldBibleCharId ? <span className="vv-sync-badge" title="Linked world-bible character">Link</span> : null}
                </strong>
                <span className="muted">{character.profile || "No profile yet."}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Scene section with expand-all control */}
      <div className="vv-scenes-header">
        <div className="vv-scenes-header__left">
          <span className="vv-scenes-header__count">{safeContent.scenes.length}</span>
          <span className="vv-scenes-header__label">Scenes</span>
        </div>
        {safeContent.scenes.length > 1 ? (
          <button className="vv-scenes-header__toggle" type="button" onClick={toggleAll}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {allExpanded ? (
                <><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></>
              ) : (
                <><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></>
              )}
            </svg>
            {allExpanded ? "Collapse All" : "Expand All"}
          </button>
        ) : null}
      </div>

      <div className="vv-scenes-grid">
        {safeContent.scenes.map((scene, index) => (
          <SceneCard
            key={scene.id}
            scene={scene}
            index={index}
            expanded={expandedScenes.has(scene.id)}
            onToggle={() => toggleScene(scene.id)}
          />
        ))}
      </div>
    </div>
  );
}

function CharacterCard({ character, index }: { character: CharacterProfile; index: number }) {
  return (
    <div className="vv-shot" style={{ animationDelay: `${index * 0.06}s` }}>
      <div className="vv-shot__head">
        <div className="vv-shot__id-group">
          <span className="vv-shot__seq">{String(index + 1).padStart(2, "0")}</span>
          <span className="vv-shot__label">{character.name}</span>
        </div>
      </div>
      {character.tags.length > 0 ? (
        <div className="vv-shot__tags">
          {character.tags.map((tag, itemIndex) => (
            <span key={`${character.id}-tag-${itemIndex}`} className="vv-tag">{tag}</span>
          ))}
        </div>
      ) : null}
      <div className="vv-shot__extras">
        <div className="vv-shot__field">
          <span className="vv-shot__field-label">Appearance</span>
          <span className="vv-shot__field-value">{character.appearance || "No appearance note yet."}</span>
        </div>
        {character.personality ? (
          <div className="vv-shot__field">
            <span className="vv-shot__field-label">Personality</span>
            <span className="vv-shot__field-value">{character.personality}</span>
          </div>
        ) : null}
        {character.costumes && Object.keys(character.costumes).length > 0 ? (
          <div className="vv-shot__field">
            <span className="vv-shot__field-label">Costumes</span>
            <span className="vv-shot__field-value">{Object.entries(character.costumes).map(([key, value]) => `${key}: ${value}`).join(", ")}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function LocationCard({ location, index }: { location: LocationProfile; index: number }) {
  return (
    <div className="vv-shot" style={{ animationDelay: `${index * 0.06}s` }}>
      <div className="vv-shot__head">
        <div className="vv-shot__id-group">
          <span className="vv-shot__seq">{String(index + 1).padStart(2, "0")}</span>
          <span className="vv-shot__label">{location.name}</span>
        </div>
        {location.timeOfDay ? <span className="vv-shot__duration">{location.timeOfDay}</span> : null}
      </div>
      <p className="vv-shot__desc">{location.description || "No location description yet."}</p>
      {location.lighting ? (
        <div className="vv-shot__extras">
          <div className="vv-shot__field">
            <span className="vv-shot__field-label">Lighting</span>
            <span className="vv-shot__field-value">{location.lighting}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function WorldBibleView({ content }: { content: WorldBibleContent }) {
  const safeContent = normalizeWorldBibleContent(content);

  return (
    <div className="vv-content">
      {safeContent.characters.length > 0 ? (
        <div className="vv-scene-group">
          <div className="vv-scene-group__header">
            <span className="vv-scene-group__label">Character Profiles</span>
            <span className="vv-scene-group__count">{safeContent.characters.length} characters</span>
          </div>
          <div className="vv-shot-grid">
            {safeContent.characters.map((character, index) => (
              <CharacterCard key={character.id} character={character} index={index} />
            ))}
          </div>
        </div>
      ) : null}

      {safeContent.locations.length > 0 ? (
        <div className="vv-scene-group" style={{ marginTop: "var(--space-4)" }}>
          <div className="vv-scene-group__header">
            <span className="vv-scene-group__label">Location Profiles</span>
            <span className="vv-scene-group__count">{safeContent.locations.length} locations</span>
          </div>
          <div className="vv-shot-grid">
            {safeContent.locations.map((location, index) => (
              <LocationCard key={location.id} location={location} index={index} />
            ))}
          </div>
        </div>
      ) : null}

      {safeContent.styleGuide ? (
        <div className="vv-scene-group" style={{ marginTop: "var(--space-4)" }}>
          <div className="vv-scene-group__header">
            <span className="vv-scene-group__label">Style Guide</span>
          </div>
          <div className="vv-shot">
            <div className="vv-shot__extras">
              <div className="vv-shot__field">
                <span className="vv-shot__field-label">Visual Style</span>
                <span className="vv-shot__field-value">{safeContent.styleGuide.visualStyle || "No style guide note yet."}</span>
              </div>
              {safeContent.styleGuide.colorPalette ? (
                <div className="vv-shot__field">
                  <span className="vv-shot__field-label">Color Palette</span>
                  <span className="vv-shot__field-value">{safeContent.styleGuide.colorPalette}</span>
                </div>
              ) : null}
              {safeContent.styleGuide.compositionNote ? (
                <div className="vv-shot__field">
                  <span className="vv-shot__field-label">Composition</span>
                  <span className="vv-shot__field-value">{safeContent.styleGuide.compositionNote}</span>
                </div>
              ) : null}
              {safeContent.styleGuide.negativePrompt ? (
                <div className="vv-shot__field">
                  <span className="vv-shot__field-label">Negative Prompt</span>
                  <span className="vv-shot__field-value">{safeContent.styleGuide.negativePrompt}</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RawJsonView({ content }: { content: unknown }) {
  return (
    <pre className="vv-json">
      {JSON.stringify(content, null, 2)}
    </pre>
  );
}

export function VersionView({
  version,
  isLoading,
  projectId,
  project,
  allowStoryboardMutations = true,
}: {
  version: Version | null;
  isLoading: boolean;
  projectId?: string;
  project?: ProjectWorkspacePayload;
  allowStoryboardMutations?: boolean;
}) {
  const { formatDate, t } = useI18n();

  if (!version) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">{t("projectWorkspace.versions.emptyCurrentTitle")}</div>
        <div className="empty-state-description">{t("projectWorkspace.versions.emptyCurrentDescription")}</div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="stack stack-gap-4">
        <div className="skeleton" style={{ height: 24, width: "40%" }} />
        <div className="skeleton" style={{ height: 200 }} />
      </div>
    );
  }

  const currentVersion = version;
  function renderContent() {
    if (!currentVersion.content) {
      return <span className="muted">{t("projectWorkspace.overview.fallbackDescription")}</span>;
    }

    if (isStoryboardContent(currentVersion.content)) {
      return <StoryboardView content={normalizeStoryboardContent(currentVersion.content)} projectId={projectId} project={project} allowProjectMutations={allowStoryboardMutations} />;
    }

    if (isScriptContent(currentVersion.content)) {
      return <ScriptView content={normalizeScriptContent(currentVersion.content)} />;
    }

    if (isWorldBibleContent(currentVersion.content)) {
      return <WorldBibleView content={normalizeWorldBibleContent(currentVersion.content)} />;
    }

    if (typeof currentVersion.content === "string") {
      return (
        <pre className="vv-json" style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>
          {currentVersion.content}
        </pre>
      );
    }

    return <RawJsonView content={currentVersion.content} />;
  }

  return (
    <div className="stack stack-gap-4">
      <div className="vv-header">
        <div className="vv-header__info">
          <h2 className="vv-header__title">{currentVersion.title}</h2>
          <span className="vv-header__meta">
            {t("projectWorkspace.versions.versionMeta", {
              versionNumber: currentVersion.versionNumber,
              date: formatDate(currentVersion.createdAt, {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
              }),
            })}
          </span>
        </div>
        <span className={`badge badge-${currentVersion.status === "approved" ? "success" : currentVersion.status === "rejected" ? "danger" : "neutral"}`}>
          {getVersionStatusLabel(t, currentVersion.status as never)}
        </span>
      </div>

      <div style={{ marginTop: "var(--space-4)" }}>
        {renderContent()}
      </div>
    </div>
  );
}
