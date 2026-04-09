import type {
  CharacterProfile,
  CharacterVoiceConfig,
  LocationProfile,
  ScriptContent,
  ScriptScene,
  StyleGuideProfile,
  WorldBibleContent,
} from "./domain";

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

function sanitizeOptionalNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function ensureObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return {};
  }

  return value as Record<string, unknown>;
}

function sanitizeStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeString(item)).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function sanitizeStringRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const entries = Object.entries(value)
    .map(([key, rawValue]) => [sanitizeString(key), sanitizeString(rawValue)] as const)
    .filter(([key, rawValue]) => key && rawValue);

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

function normalizeScriptDialogue(value: unknown) {
  if (typeof value === "string") {
    return {
      speaker: "",
      line: value.trim(),
    };
  }

  const rawDialogue = ensureObject(value);

  return {
    speaker: sanitizeString(rawDialogue.speaker) || sanitizeString(rawDialogue.character),
    line: sanitizeString(rawDialogue.line) || sanitizeString(rawDialogue.text),
  };
}

function normalizeScriptCharacter(value: unknown): ScriptContent["characters"][number] {
  if (typeof value === "string") {
    return {
      name: value.trim(),
      profile: "",
    };
  }

  const rawCharacter = ensureObject(value);

  return {
    name: sanitizeString(rawCharacter.name),
    profile: sanitizeString(rawCharacter.profile),
    worldBibleCharId: sanitizeOptionalString(rawCharacter.worldBibleCharId),
  };
}

export function normalizeScriptScene(value: unknown, index = 0): ScriptScene {
  const rawScene = ensureObject(value);
  const dialogue = Array.isArray(rawScene.dialogue)
    ? rawScene.dialogue
      .map((item) => normalizeScriptDialogue(item))
      .filter((item) => item.speaker || item.line)
    : [];

  return {
    id: sanitizeString(rawScene.id) || `scene-${index + 1}`,
    heading: sanitizeString(rawScene.heading) || sanitizeString(rawScene.title),
    synopsis: sanitizeString(rawScene.synopsis) || sanitizeString(rawScene.summary) || sanitizeString(rawScene.description),
    characters: sanitizeStringArray(rawScene.characters),
    dialogue,
    directorNote: sanitizeOptionalString(rawScene.directorNote) || sanitizeOptionalString(rawScene.note),
    locationId: sanitizeOptionalString(rawScene.locationId),
  };
}

export function normalizeScriptContent(value: unknown): ScriptContent {
  const rawContent = ensureObject(value);
  const characters = Array.isArray(rawContent.characters)
    ? rawContent.characters
      .map((item) => normalizeScriptCharacter(item))
      .filter((item) => item.name || item.profile)
    : [];
  const scenes = Array.isArray(rawContent.scenes)
    ? rawContent.scenes.map((scene, index) => normalizeScriptScene(scene, index))
    : [];

  return {
    logline: sanitizeString(rawContent.logline),
    premise: sanitizeString(rawContent.premise),
    characters,
    scenes,
  };
}

function normalizeCharacterProfile(value: unknown, index = 0): CharacterProfile {
  const rawCharacter = ensureObject(value);

  return {
    id: sanitizeString(rawCharacter.id) || `character-${index + 1}`,
    name: sanitizeString(rawCharacter.name) || `Character ${index + 1}`,
    appearance: sanitizeString(rawCharacter.appearance),
    personality: sanitizeOptionalString(rawCharacter.personality),
    tags: sanitizeStringArray(rawCharacter.tags),
    referenceImages: sanitizeStringArray(rawCharacter.referenceImages),
    costumes: sanitizeStringRecord(rawCharacter.costumes),
    sortOrder: sanitizeNumber(rawCharacter.sortOrder, index),
  };
}

function normalizeLocationProfile(value: unknown, index = 0): LocationProfile {
  const rawLocation = ensureObject(value);

  return {
    id: sanitizeString(rawLocation.id) || `location-${index + 1}`,
    name: sanitizeString(rawLocation.name) || `Location ${index + 1}`,
    description: sanitizeString(rawLocation.description),
    lighting: sanitizeOptionalString(rawLocation.lighting),
    timeOfDay: sanitizeOptionalString(rawLocation.timeOfDay),
    referenceImages: sanitizeStringArray(rawLocation.referenceImages),
    sortOrder: sanitizeNumber(rawLocation.sortOrder, index),
  };
}

function normalizeStyleGuide(value: unknown): StyleGuideProfile {
  const rawGuide = ensureObject(value);

  return {
    visualStyle: sanitizeString(rawGuide.visualStyle),
    colorPalette: sanitizeOptionalString(rawGuide.colorPalette),
    compositionNote: sanitizeOptionalString(rawGuide.compositionNote),
    negativePrompt: sanitizeOptionalString(rawGuide.negativePrompt),
    referenceImages: sanitizeStringArray(rawGuide.referenceImages),
  };
}

function normalizeVoiceSettings(value: unknown) {
  const rawSettings = ensureObject(value);
  const speed = sanitizeOptionalNumber(rawSettings.speed);
  const volume = sanitizeOptionalNumber(rawSettings.volume);
  const emotion = sanitizeOptionalString(rawSettings.emotion);

  if (speed === undefined && volume === undefined && emotion === undefined) {
    return undefined;
  }

  return {
    speed,
    emotion,
    volume,
  };
}

function normalizeVoiceConfig(value: unknown): CharacterVoiceConfig | null {
  const rawConfig = ensureObject(value);
  const characterId = sanitizeString(rawConfig.characterId);

  if (!characterId) {
    return null;
  }

  const voiceId = sanitizeString(rawConfig.voiceId);
  const voiceName = sanitizeString(rawConfig.voiceName) || voiceId;

  return {
    characterId,
    ttsProvider: sanitizeString(rawConfig.ttsProvider) || "default",
    voiceId,
    voiceName,
    sampleUrl: sanitizeOptionalString(rawConfig.sampleUrl),
    settings: normalizeVoiceSettings(rawConfig.settings),
  };
}

export function normalizeWorldBibleContent(value: unknown): WorldBibleContent {
  const rawContent = ensureObject(value);
  const characters = Array.isArray(rawContent.characters)
    ? rawContent.characters.map((item, index) => normalizeCharacterProfile(item, index))
    : [];
  const locations = Array.isArray(rawContent.locations)
    ? rawContent.locations.map((item, index) => normalizeLocationProfile(item, index))
    : [];
  const voiceConfigs = Array.isArray(rawContent.voiceConfigs)
    ? rawContent.voiceConfigs
      .map((item) => normalizeVoiceConfig(item))
      .filter((item): item is CharacterVoiceConfig => Boolean(item))
    : [];

  return {
    characters,
    locations,
    styleGuide: rawContent.styleGuide && typeof rawContent.styleGuide === "object"
      ? normalizeStyleGuide(rawContent.styleGuide)
      : undefined,
    voiceConfigs: voiceConfigs.length > 0 ? voiceConfigs : undefined,
  };
}