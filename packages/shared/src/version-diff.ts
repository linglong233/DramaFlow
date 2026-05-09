/**
 * @fileoverview 版本内容差异比较工具
 * @module shared/version-diff
 *
 * 提供版本间的结构化 diff 功能，支持剧本、分镜、世界观三种内容类型。
 * 前端（diff 视图）和后端（审计摘要）均可使用。
 */

import type { ScriptContent, StoryboardContent, WorldBibleContent } from "./domain";
import { ensureMediaBindings, normalizeStoryboardContent } from "./storyboard";

/** 差异条目类型 */
export type DiffType = "added" | "removed" | "modified";

/** 单条差异记录 */
export interface DiffEntry {
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

function isWorldBibleContent(content: unknown): content is WorldBibleContent {
  return typeof content === "object" && content !== null && ("characters" in content || "locations" in content) && !("scenes" in content) && !("shots" in content);
}

/**
 * 对比两个剧本内容的差异
 */
export function diffScriptContents(base: ScriptContent, compare: ScriptContent): DiffEntry[] {
  const entries: DiffEntry[] = [];

  if (base.logline !== compare.logline) {
    entries.push({ type: "modified", label: "Logline", details: ["Logline changed"] });
  }
  if (base.premise !== compare.premise) {
    entries.push({ type: "modified", label: "Premise", details: ["Premise changed"] });
  }

  const baseChars = (base.characters ?? []).map((c) => c.name);
  const compareChars = (compare.characters ?? []).map((c) => c.name);
  const addedChars = compareChars.filter((name) => !baseChars.includes(name));
  const removedChars = baseChars.filter((name) => !compareChars.includes(name));
  if (addedChars.length || removedChars.length) {
    const details: string[] = [];
    if (addedChars.length) details.push(`+ ${addedChars.join(", ")}`);
    if (removedChars.length) details.push(`- ${removedChars.join(", ")}`);
    entries.push({ type: "modified", label: "Characters", details });
  }

  for (const scene of compare.scenes) {
    if (!base.scenes.find((s) => s.id === scene.id)) {
      entries.push({ type: "added", label: `Scene: ${scene.heading || scene.id}`, details: [scene.synopsis || ""] });
    }
  }

  for (const scene of base.scenes) {
    if (!compare.scenes.find((s) => s.id === scene.id)) {
      entries.push({ type: "removed", label: `Scene: ${scene.heading || scene.id}`, details: [scene.synopsis || ""] });
    }
  }

  for (const baseScene of base.scenes) {
    const compareScene = compare.scenes.find((s) => s.id === baseScene.id);
    if (!compareScene) continue;

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

/**
 * 对比两个分镜内容的差异（含媒体绑定）
 */
export function diffStoryboardContents(baseRaw: StoryboardContent, compareRaw: StoryboardContent): DiffEntry[] {
  const base = ensureMediaBindings(normalizeStoryboardContent(baseRaw));
  const compare = ensureMediaBindings(normalizeStoryboardContent(compareRaw));
  const entries: DiffEntry[] = [];

  if (base.overview !== compare.overview) {
    entries.push({ type: "modified", label: "Overview", details: ["Overview changed"] });
  }

  const baseOrder = new Map(base.shots.map((shot, i) => [shot.id, i]));
  const compareOrder = new Map(compare.shots.map((shot, i) => [shot.id, i]));

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
    const compareShot = compare.shots.find((s) => s.id === baseShot.id);
    if (!compareShot) continue;

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

    const baseBinding = base.mediaBindings[baseShot.id] ?? {};
    const compareBinding = compare.mediaBindings[baseShot.id] ?? {};
    if (baseBinding.imageVersionId !== compareBinding.imageVersionId) details.push("Image version changed");
    if (baseBinding.videoVersionId !== compareBinding.videoVersionId) details.push("Video version changed");
    if (baseBinding.audioVersionId !== compareBinding.audioVersionId) details.push("Audio version changed");
    if ((baseBinding.subtitle ?? "") !== (compareBinding.subtitle ?? "")) details.push("Subtitle changed");

    if (details.length) {
      entries.push({ type: "modified", label: `Shot: ${baseShot.shotLabel || baseShot.id}`, details });
    }
  }

  return entries;
}

/**
 * 对比两个世界观设定内容的差异
 */
export function diffWorldBibleContents(base: WorldBibleContent, compare: WorldBibleContent): DiffEntry[] {
  const entries: DiffEntry[] = [];

  const baseCharNames = (base.characters ?? []).map((c) => c.name);
  const compareCharNames = (compare.characters ?? []).map((c) => c.name);
  const addedChars = compareCharNames.filter((n) => !baseCharNames.includes(n));
  const removedChars = baseCharNames.filter((n) => !compareCharNames.includes(n));
  if (addedChars.length) {
    entries.push({ type: "added", label: "Characters", details: [`+ ${addedChars.join(", ")}`] });
  }
  if (removedChars.length) {
    entries.push({ type: "removed", label: "Characters", details: [`- ${removedChars.join(", ")}`] });
  }

  for (const baseChar of base.characters ?? []) {
    const compareChar = (compare.characters ?? []).find((c) => c.id === baseChar.id);
    if (!compareChar) continue;
    const details: string[] = [];
    if (baseChar.appearance !== compareChar.appearance) details.push("Appearance changed");
    if ((baseChar.personality ?? "") !== (compareChar.personality ?? "")) details.push("Personality changed");
    if (details.length) {
      entries.push({ type: "modified", label: `Character: ${baseChar.name}`, details });
    }
  }

  const baseLocNames = (base.locations ?? []).map((l) => l.name);
  const compareLocNames = (compare.locations ?? []).map((l) => l.name);
  const addedLocs = compareLocNames.filter((n) => !baseLocNames.includes(n));
  const removedLocs = baseLocNames.filter((n) => !compareLocNames.includes(n));
  if (addedLocs.length) {
    entries.push({ type: "added", label: "Locations", details: [`+ ${addedLocs.join(", ")}`] });
  }
  if (removedLocs.length) {
    entries.push({ type: "removed", label: "Locations", details: [`- ${removedLocs.join(", ")}`] });
  }

  for (const baseLoc of base.locations ?? []) {
    const compareLoc = (compare.locations ?? []).find((l) => l.id === baseLoc.id);
    if (!compareLoc) continue;
    const details: string[] = [];
    if (baseLoc.description !== compareLoc.description) details.push("Description changed");
    if ((baseLoc.lighting ?? "") !== (compareLoc.lighting ?? "")) details.push("Lighting changed");
    if (details.length) {
      entries.push({ type: "modified", label: `Location: ${baseLoc.name}`, details });
    }
  }

  return entries;
}

/**
 * 通用差异调度器，自动识别内容类型并调用对应的 diff 函数
 * @returns 差异条目数组，无法识别内容类型时返回 null
 */
export function diffContents(baseContent: unknown, compareContent: unknown): DiffEntry[] | null {
  if (baseContent === null || baseContent === undefined || compareContent === null || compareContent === undefined) {
    return null;
  }

  if (isScriptContent(baseContent) && isScriptContent(compareContent)) {
    return diffScriptContents(baseContent, compareContent);
  }

  if (isStoryboardContent(baseContent) && isStoryboardContent(compareContent)) {
    return diffStoryboardContents(baseContent, compareContent);
  }

  if (isWorldBibleContent(baseContent) && isWorldBibleContent(compareContent)) {
    return diffWorldBibleContents(baseContent, compareContent);
  }

  if (JSON.stringify(baseContent) === JSON.stringify(compareContent)) {
    return [];
  }

  return [{ type: "modified", label: "Content", details: ["Content changed"] }];
}
