/**
 * @fileoverview 版本差异视图
 * @module web/components/project-workspace
 *
 * 两个版本之间的内容差异对比。
 */

"use client";

import { useMemo, useState } from "react";
import type { ScriptContent, StoryboardContent, VersionRecord } from "@dramaflow/shared";
import { normalizeScriptContent, normalizeStoryboardContent } from "@dramaflow/shared";

import { useI18n } from "../../lib/i18n";

interface Props {
  versions: Array<Pick<VersionRecord, "id" | "title" | "versionNumber" | "content" | "createdAt">>;
  onClose: () => void;
}

type DiffType = "added" | "removed" | "modified";

interface DiffEntry {
  type: DiffType;
  label: string;
  details: string[];
}

function isScriptContent(content: unknown): content is ScriptContent {
  return typeof content === "object" && content !== null && "scenes" in content && Array.isArray((content as ScriptContent).scenes);
}

function isStoryboardContent(content: unknown): content is StoryboardContent {
  return typeof content === "object" && content !== null && "shots" in content && Array.isArray((content as StoryboardContent).shots);
}

function diffScripts(base: ScriptContent, compare: ScriptContent): DiffEntry[] {
  const entries: DiffEntry[] = [];

  if (base.logline !== compare.logline) {
    entries.push({ type: "modified", label: "Logline", details: ["Logline changed"] });
  }
  if (base.premise !== compare.premise) {
    entries.push({ type: "modified", label: "Premise", details: ["Premise changed"] });
  }

  const baseChars = (base.characters ?? []).map((character) => character.name);
  const compareChars = (compare.characters ?? []).map((character) => character.name);
  const addedChars = compareChars.filter((name) => !baseChars.includes(name));
  const removedChars = baseChars.filter((name) => !compareChars.includes(name));
  if (addedChars.length || removedChars.length) {
    const details: string[] = [];
    if (addedChars.length) details.push(`+ ${addedChars.join(", ")}`);
    if (removedChars.length) details.push(`- ${removedChars.join(", ")}`);
    entries.push({ type: "modified", label: "Characters", details });
  }

  for (const scene of compare.scenes) {
    if (!base.scenes.find((item) => item.id === scene.id)) {
      entries.push({ type: "added", label: `Scene: ${scene.heading || scene.id}`, details: [scene.synopsis || ""] });
    }
  }

  for (const scene of base.scenes) {
    if (!compare.scenes.find((item) => item.id === scene.id)) {
      entries.push({ type: "removed", label: `Scene: ${scene.heading || scene.id}`, details: [scene.synopsis || ""] });
    }
  }

  for (const baseScene of base.scenes) {
    const compareScene = compare.scenes.find((scene) => scene.id === baseScene.id);
    if (!compareScene) {
      continue;
    }

    const details: string[] = [];
    if (baseScene.heading !== compareScene.heading) details.push("Heading changed");
    if (baseScene.synopsis !== compareScene.synopsis) details.push("Synopsis changed");
    if ((baseScene.directorNote ?? "") !== (compareScene.directorNote ?? "")) details.push("Director note changed");
    if (baseScene.dialogue.length !== compareScene.dialogue.length) details.push(`Dialogue count: ${baseScene.dialogue.length} -> ${compareScene.dialogue.length}`);
    if (details.length) {
      entries.push({ type: "modified", label: `Scene: ${baseScene.heading || baseScene.id}`, details });
    }
  }

  return entries;
}

function diffStoryboards(baseRaw: StoryboardContent, compareRaw: StoryboardContent): DiffEntry[] {
  const base = normalizeStoryboardContent(baseRaw);
  const compare = normalizeStoryboardContent(compareRaw);
  const entries: DiffEntry[] = [];

  if (base.overview !== compare.overview) {
    entries.push({ type: "modified", label: "Overview", details: ["Overview changed"] });
  }

  const baseOrder = new Map(base.shots.map((shot, index) => [shot.id, index]));
  const compareOrder = new Map(compare.shots.map((shot, index) => [shot.id, index]));

  for (const shot of compare.shots) {
    if (!baseOrder.has(shot.id)) {
      entries.push({ type: "added", label: `Shot: ${shot.shotLabel || shot.id}`, details: [shot.visualDescription || ""] });
    }
  }

  for (const shot of base.shots) {
    if (!compareOrder.has(shot.id)) {
      entries.push({ type: "removed", label: `Shot: ${shot.shotLabel || shot.id}`, details: [shot.visualDescription || ""] });
    }
  }

  for (const baseShot of base.shots) {
    const compareShot = compare.shots.find((shot) => shot.id === baseShot.id);
    if (!compareShot) {
      continue;
    }

    const details: string[] = [];
    if (baseOrder.get(baseShot.id) !== compareOrder.get(baseShot.id)) details.push(`Order: ${baseOrder.get(baseShot.id)} -> ${compareOrder.get(baseShot.id)}`);
    if (baseShot.sceneId !== compareShot.sceneId) details.push(`Scene: ${baseShot.sceneId} -> ${compareShot.sceneId}`);
    if (baseShot.shotLabel !== compareShot.shotLabel) details.push(`Shot label: ${baseShot.shotLabel} -> ${compareShot.shotLabel}`);
    if (baseShot.framing !== compareShot.framing) details.push(`Framing: ${baseShot.framing} -> ${compareShot.framing}`);
    if (baseShot.cameraMove !== compareShot.cameraMove) details.push(`Camera move: ${baseShot.cameraMove} -> ${compareShot.cameraMove}`);
    if (baseShot.durationSeconds !== compareShot.durationSeconds) details.push(`Duration: ${baseShot.durationSeconds}s -> ${compareShot.durationSeconds}s`);
    if (baseShot.visualDescription !== compareShot.visualDescription) details.push("Visual description changed");
    if ((baseShot.actionDescription ?? "") !== (compareShot.actionDescription ?? "")) details.push("Action description changed");
    if ((baseShot.dialogue ?? "") !== (compareShot.dialogue ?? "")) details.push("Dialogue changed");
    if ((baseShot.soundDesign ?? "") !== (compareShot.soundDesign ?? "")) details.push("Sound design changed");
    if ((baseShot.notes ?? "") !== (compareShot.notes ?? "")) details.push("Notes changed");
    if ((baseShot.imagePrompt ?? "") !== (compareShot.imagePrompt ?? "")) details.push("Image prompt changed");
    if ((baseShot.videoPrompt ?? "") !== (compareShot.videoPrompt ?? "")) details.push("Video prompt changed");
    if ((baseShot.characterIds ?? []).join(",") !== (compareShot.characterIds ?? []).join(",")) details.push("Character mapping changed");

    if (details.length) {
      entries.push({ type: "modified", label: `Shot: ${baseShot.shotLabel || baseShot.id}`, details });
    }
  }

  return entries;
}

export function VersionDiffView({ versions, onClose }: Props) {
  const { t } = useI18n();
  const [baseId, setBaseId] = useState(versions[1]?.id || "");
  const [compareId, setCompareId] = useState(versions[0]?.id || "");

  const baseVersion = useMemo(() => versions.find((version) => version.id === baseId), [baseId, versions]);
  const compareVersion = useMemo(() => versions.find((version) => version.id === compareId), [compareId, versions]);

  const entries = useMemo(() => {
    if (!baseVersion?.content || !compareVersion?.content) {
      return null;
    }
    if (isScriptContent(baseVersion.content) && isScriptContent(compareVersion.content)) {
      return diffScripts(normalizeScriptContent(baseVersion.content), normalizeScriptContent(compareVersion.content));
    }
    if (isStoryboardContent(baseVersion.content) && isStoryboardContent(compareVersion.content)) {
      return diffStoryboards(baseVersion.content, compareVersion.content);
    }
    if (JSON.stringify(baseVersion.content) === JSON.stringify(compareVersion.content)) {
      return [];
    }
    return [{ type: "modified" as DiffType, label: "Content", details: ["Content changed"] }];
  }, [baseVersion, compareVersion]);

  if (versions.length < 2) {
    return (
      <div className="vdiff-root">
        <div className="vdiff-header">
          <h3 className="heading-4">{t("versionDiff.title")}</h3>
          <button className="btn btn-ghost btn-sm" type="button" onClick={onClose}>{t("versionDiff.close")}</button>
        </div>
        <p className="muted" style={{ padding: "var(--space-6)", textAlign: "center" }}>{t("versionDiff.noVersions")}</p>
      </div>
    );
  }

  return (
    <div className="vdiff-root">
      <div className="vdiff-header">
        <h3 className="heading-4">{t("versionDiff.title")}</h3>
        <button className="btn btn-ghost btn-sm" type="button" onClick={onClose}>{t("versionDiff.close")}</button>
      </div>

      <div className="vdiff-selectors">
        <div className="form-group">
          <label className="form-label">{t("versionDiff.selectBase")}</label>
          <select className="input" value={baseId} onChange={(event) => setBaseId(event.target.value)}>
            {versions.map((version) => <option key={version.id} value={version.id}>V{version.versionNumber} - {version.title}</option>)}
          </select>
        </div>
        <div className="vdiff-arrow">-&gt;</div>
        <div className="form-group">
          <label className="form-label">{t("versionDiff.selectCompare")}</label>
          <select className="input" value={compareId} onChange={(event) => setCompareId(event.target.value)}>
            {versions.map((version) => <option key={version.id} value={version.id}>V{version.versionNumber} - {version.title}</option>)}
          </select>
        </div>
      </div>

      <div className="vdiff-body">
        {entries === null ? (
          <p className="muted" style={{ textAlign: "center", padding: "var(--space-6)" }}>{t("versionDiff.noVersions")}</p>
        ) : entries.length === 0 ? (
          <div className="vdiff-same">{t("versionDiff.same")}</div>
        ) : (
          <div className="vdiff-entries">
            {entries.map((entry, index) => (
              <div key={`${entry.label}-${index}`} className={`vdiff-entry vdiff-entry--${entry.type}`}>
                <div className="vdiff-entry__header">
                  <span className={`vdiff-badge vdiff-badge--${entry.type}`}>
                    {entry.type === "added" ? t("versionDiff.added") : entry.type === "removed" ? t("versionDiff.removed") : t("versionDiff.modified")}
                  </span>
                  <span className="vdiff-entry__label">{entry.label}</span>
                </div>
                <div className="vdiff-entry__details">
                  {entry.details.map((detail) => <div key={detail} className="vdiff-detail">{detail}</div>)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
