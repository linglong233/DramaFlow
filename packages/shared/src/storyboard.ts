import type { StoryboardContent, StoryboardShot } from "./domain";

export const STORYBOARD_FRAMING_OPTIONS = [
  "ECU",
  "CU",
  "MCU",
  "MS",
  "MLS",
  "LS",
  "ELS",
  "OTS",
  "POV",
  "bird-eye",
  "low-angle",
  "dutch-angle",
] as const;

export const STORYBOARD_CAMERA_MOVE_OPTIONS = [
  "static",
  "pan-left",
  "pan-right",
  "tilt-up",
  "tilt-down",
  "dolly-in",
  "dolly-out",
  "tracking",
  "crane-up",
  "crane-down",
  "handheld",
  "steadicam",
  "whip-pan",
  "zoom-in",
  "zoom-out",
] as const;

type StoryboardLocale = "zh-CN" | "en";

const FRAMING_ALIAS_ENTRIES: Array<[string, string]> = [
  ["extreme close up", "ECU"],
  ["extreme close-up", "ECU"],
  ["extreme closeup", "ECU"],
  ["ecu", "ECU"],
  ["close up", "CU"],
  ["close-up", "CU"],
  ["closeup", "CU"],
  ["cu", "CU"],
  ["medium close up", "MCU"],
  ["medium close-up", "MCU"],
  ["medium closeup", "MCU"],
  ["mcu", "MCU"],
  ["medium shot", "MS"],
  ["medium", "MS"],
  ["ms", "MS"],
  ["medium long shot", "MLS"],
  ["mls", "MLS"],
  ["long shot", "LS"],
  ["wide shot", "LS"],
  ["wide", "LS"],
  ["ws", "LS"],
  ["ls", "LS"],
  ["extreme long shot", "ELS"],
  ["establishing shot", "ELS"],
  ["els", "ELS"],
  ["over the shoulder", "OTS"],
  ["over-the-shoulder", "OTS"],
  ["ots", "OTS"],
  ["point of view", "POV"],
  ["point-of-view", "POV"],
  ["pov", "POV"],
  ["bird eye", "bird-eye"],
  ["bird's eye", "bird-eye"],
  ["birds eye", "bird-eye"],
  ["bird-eye", "bird-eye"],
  ["low angle", "low-angle"],
  ["low-angle", "low-angle"],
  ["dutch angle", "dutch-angle"],
  ["dutch-angle", "dutch-angle"],
  ["特写", "CU"],
  ["大特写", "ECU"],
  ["中近景", "MCU"],
  ["中景", "MS"],
  ["中远景", "MLS"],
  ["远景", "LS"],
  ["大远景", "ELS"],
  ["过肩", "OTS"],
  ["主观", "POV"],
  ["俯拍", "bird-eye"],
  ["仰拍", "low-angle"],
  ["倾斜", "dutch-angle"],
];

const CAMERA_MOVE_ALIAS_ENTRIES: Array<[string, string]> = [
  ["static", "static"],
  ["locked off", "static"],
  ["locked-off", "static"],
  ["still", "static"],
  ["pan left", "pan-left"],
  ["pan-left", "pan-left"],
  ["left pan", "pan-left"],
  ["pan right", "pan-right"],
  ["pan-right", "pan-right"],
  ["right pan", "pan-right"],
  ["tilt up", "tilt-up"],
  ["tilt-up", "tilt-up"],
  ["tilt down", "tilt-down"],
  ["tilt-down", "tilt-down"],
  ["dolly in", "dolly-in"],
  ["dolly-in", "dolly-in"],
  ["push in", "dolly-in"],
  ["push-in", "dolly-in"],
  ["truck in", "dolly-in"],
  ["dolly out", "dolly-out"],
  ["dolly-out", "dolly-out"],
  ["pull out", "dolly-out"],
  ["pull-back", "dolly-out"],
  ["pull back", "dolly-out"],
  ["tracking", "tracking"],
  ["tracking shot", "tracking"],
  ["follow", "tracking"],
  ["crane up", "crane-up"],
  ["crane-up", "crane-up"],
  ["boom up", "crane-up"],
  ["crane down", "crane-down"],
  ["crane-down", "crane-down"],
  ["boom down", "crane-down"],
  ["handheld", "handheld"],
  ["hand held", "handheld"],
  ["steadicam", "steadicam"],
  ["steadycam", "steadicam"],
  ["whip pan", "whip-pan"],
  ["whip-pan", "whip-pan"],
  ["zoom in", "zoom-in"],
  ["zoom-in", "zoom-in"],
  ["zoom out", "zoom-out"],
  ["zoom-out", "zoom-out"],
  ["静止", "static"],
  ["左摇", "pan-left"],
  ["右摇", "pan-right"],
  ["上摇", "tilt-up"],
  ["下摇", "tilt-down"],
  ["推进", "dolly-in"],
  ["拉远", "dolly-out"],
  ["跟拍", "tracking"],
  ["升降上移", "crane-up"],
  ["升降下移", "crane-down"],
  ["手持", "handheld"],
  ["稳定器", "steadicam"],
  ["甩摇", "whip-pan"],
  ["推焦", "zoom-in"],
  ["拉焦", "zoom-out"],
];

const STORYBOARD_FRAMING_LABELS: Record<StoryboardLocale, Record<string, string>> = {
  "zh-CN": {
    ECU: "大特写",
    CU: "特写",
    MCU: "中近景",
    MS: "中景",
    MLS: "中远景",
    LS: "远景",
    ELS: "大远景",
    OTS: "过肩镜头",
    POV: "主观镜头",
    "bird-eye": "俯拍",
    "low-angle": "仰拍",
    "dutch-angle": "倾斜镜头",
  },
  en: {
    ECU: "Extreme close-up",
    CU: "Close-up",
    MCU: "Medium close-up",
    MS: "Medium shot",
    MLS: "Medium long shot",
    LS: "Long shot",
    ELS: "Extreme long shot",
    OTS: "Over-the-shoulder",
    POV: "Point of view",
    "bird-eye": "Bird's eye",
    "low-angle": "Low angle",
    "dutch-angle": "Dutch angle",
  },
};

const STORYBOARD_CAMERA_MOVE_LABELS: Record<StoryboardLocale, Record<string, string>> = {
  "zh-CN": {
    static: "固定机位",
    "pan-left": "左摇",
    "pan-right": "右摇",
    "tilt-up": "上摇",
    "tilt-down": "下摇",
    "dolly-in": "推进",
    "dolly-out": "拉远",
    tracking: "跟拍",
    "crane-up": "升降上移",
    "crane-down": "升降下移",
    handheld: "手持",
    steadicam: "稳定器",
    "whip-pan": "甩摇",
    "zoom-in": "推焦",
    "zoom-out": "拉焦",
  },
  en: {
    static: "Static",
    "pan-left": "Pan left",
    "pan-right": "Pan right",
    "tilt-up": "Tilt up",
    "tilt-down": "Tilt down",
    "dolly-in": "Dolly in",
    "dolly-out": "Dolly out",
    tracking: "Tracking",
    "crane-up": "Crane up",
    "crane-down": "Crane down",
    handheld: "Handheld",
    steadicam: "Steadicam",
    "whip-pan": "Whip pan",
    "zoom-in": "Zoom in",
    "zoom-out": "Zoom out",
  },
};

function sanitizeString(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function sanitizeOptionalString(value: unknown) {
  const normalized = sanitizeString(value);
  return normalized || undefined;
}

function sanitizeNumber(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function aliasLookup(value: string, aliases: Array<[string, string]>) {
  const normalized = value.toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();

  for (const [alias, canonical] of aliases) {
    if (normalized === alias) {
      return canonical;
    }
  }

  return value.trim();
}

function ensureShotObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return {};
  }

  return value as Record<string, unknown>;
}

function normalizeStoryboardSceneId(rawShot: Record<string, unknown>, index: number) {
  const direct = sanitizeString(rawShot.sceneId);
  if (direct) {
    return direct;
  }

  const numericScene = sanitizeString(rawShot.sceneNumber);
  if (numericScene) {
    return `scene-${numericScene}`;
  }

  const scene = rawShot.scene;
  if (scene && typeof scene === "object") {
    const sceneObject = scene as Record<string, unknown>;
    const nestedId = sanitizeString(sceneObject.id);
    if (nestedId) {
      return nestedId;
    }
  }

  return `scene-${index + 1}`;
}

function normalizeStoryboardShotLabel(rawShot: Record<string, unknown>, sceneId: string, index: number) {
  const direct = sanitizeString(rawShot.shotLabel);
  if (direct) {
    return direct;
  }

  const shotNumber = sanitizeString(rawShot.shotNumber)
    || sanitizeString(rawShot.shotNo)
    || sanitizeString(rawShot.number);
  if (shotNumber) {
    return shotNumber;
  }

  const sceneSuffix = sceneId.replace(/^scene-/, "") || "1";
  return `${sceneSuffix}-${index + 1}`;
}

function normalizeStoryboardShotId(rawShot: Record<string, unknown>, sceneId: string, shotLabel: string, index: number) {
  const direct = sanitizeString(rawShot.id);
  if (direct) {
    return direct;
  }

  const safeScene = sceneId.replace(/[^a-zA-Z0-9_-]+/g, "-");
  const safeLabel = shotLabel.replace(/[^a-zA-Z0-9_-]+/g, "-");
  return `shot-${safeScene}-${safeLabel || index + 1}`;
}

function normalizeCharacterIds(rawShot: Record<string, unknown>) {
  const direct = rawShot.characterIds;
  if (Array.isArray(direct)) {
    const cleaned = direct
      .map((item) => sanitizeString(item))
      .filter(Boolean);
    return cleaned.length > 0 ? cleaned : undefined;
  }

  return undefined;
}

export function normalizeStoryboardFraming(value: unknown) {
  const raw = sanitizeString(value);
  if (!raw) {
    return "MS";
  }

  const normalized = aliasLookup(raw, FRAMING_ALIAS_ENTRIES);
  return sanitizeString(normalized) || "MS";
}

export function normalizeStoryboardCameraMove(value: unknown) {
  const raw = sanitizeString(value);
  if (!raw) {
    return "static";
  }

  const normalized = aliasLookup(raw, CAMERA_MOVE_ALIAS_ENTRIES);
  return sanitizeString(normalized) || "static";
}

export function normalizeStoryboardShot(value: unknown, index = 0): StoryboardShot {
  const rawShot = ensureShotObject(value);
  const sceneId = normalizeStoryboardSceneId(rawShot, index);
  const shotLabel = normalizeStoryboardShotLabel(rawShot, sceneId, index);
  const visualDescription = sanitizeString(rawShot.visualDescription)
    || sanitizeString(rawShot.description)
    || sanitizeString(rawShot.visuals);
  const actionDescription = sanitizeOptionalString(rawShot.actionDescription)
    || sanitizeOptionalString(rawShot.action)
    || sanitizeOptionalString(rawShot.blocking);
  const dialogue = sanitizeOptionalString(rawShot.dialogue)
    || sanitizeOptionalString(rawShot.line);
  const soundDesign = sanitizeOptionalString(rawShot.soundDesign)
    || sanitizeOptionalString(rawShot.soundNote)
    || sanitizeOptionalString(rawShot.sound);
  const notes = sanitizeOptionalString(rawShot.notes)
    || sanitizeOptionalString(rawShot.note)
    || sanitizeOptionalString(rawShot.remarks);

  return {
    id: normalizeStoryboardShotId(rawShot, sceneId, shotLabel, index),
    sceneId,
    shotLabel,
    framing: normalizeStoryboardFraming(rawShot.framing ?? rawShot.shotSize),
    cameraMove: normalizeStoryboardCameraMove(rawShot.cameraMove ?? rawShot.cameraMovement ?? rawShot.movement),
    durationSeconds: Math.max(1, sanitizeNumber(rawShot.durationSeconds ?? rawShot.duration, 3)),
    visualDescription,
    actionDescription,
    dialogue,
    soundDesign,
    notes,
    imagePrompt: sanitizeOptionalString(rawShot.imagePrompt),
    videoPrompt: sanitizeOptionalString(rawShot.videoPrompt),
    characterIds: normalizeCharacterIds(rawShot),
  };
}

export function normalizeStoryboardContent(value: unknown): StoryboardContent {
  const rawContent = ensureShotObject(value);
  const rawShots = Array.isArray(rawContent.shots) ? rawContent.shots : [];

  return {
    overview: sanitizeString(rawContent.overview),
    shots: rawShots.map((shot, index) => normalizeStoryboardShot(shot, index)),
  };
}

export function isStoryboardContent(value: unknown): value is StoryboardContent {
  if (!value || typeof value !== "object") {
    return false;
  }

  const normalized = value as Partial<StoryboardContent>;
  return typeof normalized.overview === "string" && Array.isArray(normalized.shots);
}

export function getStoryboardFramingLabel(value: string, locale: StoryboardLocale = "zh-CN") {
  return STORYBOARD_FRAMING_LABELS[locale][value] ?? value;
}

export function getStoryboardCameraMoveLabel(value: string, locale: StoryboardLocale = "zh-CN") {
  return STORYBOARD_CAMERA_MOVE_LABELS[locale][value] ?? value;
}

export function getStoryboardShotVisualSummary(shot: StoryboardShot) {
  return [shot.visualDescription, shot.actionDescription].filter(Boolean).join("\n");
}

export function getStoryboardShotAudioSummary(shot: StoryboardShot) {
  return [shot.dialogue, shot.soundDesign].filter(Boolean).join("\n");
}

export function getStoryboardSceneIds(content: StoryboardContent) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const shot of content.shots) {
    if (!seen.has(shot.sceneId)) {
      seen.add(shot.sceneId);
      result.push(shot.sceneId);
    }
  }

  return result;
}

export function getStoryboardEstimatedDuration(content: StoryboardContent) {
  return content.shots.reduce((total, shot) => total + Math.max(0, shot.durationSeconds || 0), 0);
}