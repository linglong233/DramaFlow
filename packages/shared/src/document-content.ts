/**
 * @fileoverview 文档内容规范化工具函数
 * @module shared/document-content
 *
 * 提供 AI 生成结果到标准数据结构的规范化转换，包括：
 * - 剧本内容（ScriptContent）规范化
 * - 世界观设定（WorldBibleContent）规范化
 *
 * 所有 normalize 函数都具有容错能力，能处理 AI 返回的各种非标格式。
 */

import type {
  CharacterProfile,
  CharacterVoiceConfig,
  LocationProfile,
  ScriptContent,
  ScriptScene,
  StyleGuideProfile,
  WorldBibleContent,
} from "./domain";

/**
 * 将未知类型的值安全转换为字符串
 * @param value - 待转换的值
 * @returns 清理后的字符串，非字符串类型返回空串
 */
function sanitizeString(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

/**
 * 将未知类型的值安全转换为可选字符串
 * @returns 空串时返回 undefined
 */
function sanitizeOptionalString(value: unknown) {
  const normalized = sanitizeString(value);
  return normalized || undefined;
}

/**
 * 将未知类型的值安全转换为数字
 * @param fallback - 无法解析时的默认值
 */
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

/** 将未知类型的值安全转换为可选数字，无法解析时返回 undefined */
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

/** 确保值为对象类型，非对象返回空对象 */
function ensureObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return {};
  }

  return value as Record<string, unknown>;
}

/** 将未知类型的值转换为字符串数组，支持数组和逗号分隔字符串 */
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

/** 将未知类型的值转换为 Record<string, string>，用于服装等键值对数据 */
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

/** 规范化单条对白数据，兼容字符串和对象两种格式 */
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

/** 规范化剧本角色数据，兼容字符串和对象两种格式 */
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

/**
 * 规范化剧本场景数据
 * @param value - AI 返回的原始场景数据
 * @param index - 场景序号（用于生成默认 ID）
 * @returns 标准化的 ScriptScene
 */
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

/**
 * 规范化完整剧本内容
 * @param value - AI 返回的原始剧本数据
 * @returns 标准化的 ScriptContent
 */
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

/** 规范化角色档案数据 */
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

/** 规范化场景地点档案数据 */
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

/** 规范化视觉风格指南数据 */
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

/** 规范化语音参数设置 */
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

/** 规范化角色语音配置，缺少 characterId 时返回 null */
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

/**
 * 规范化完整世界观设定内容
 * @param value - 原始世界观数据
 * @returns 标准化的 WorldBibleContent
 */
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