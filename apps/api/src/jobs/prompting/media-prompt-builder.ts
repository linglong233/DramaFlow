/** @fileoverview 媒体提示词构建器（图片/视频） */
import type {
  CharacterProfile,
  LocationProfile,
  StoryboardShot,
  StyleGuideProfile,
  VideoReferenceMode,
} from "@dramaflow/shared";

export interface MediaPromptInput {
  shot: StoryboardShot;
  characters: CharacterProfile[];
  location?: LocationProfile;
  styleGuide?: StyleGuideProfile;
}

export interface MediaVideoPromptInput extends MediaPromptInput {
  videoReferenceMode?: VideoReferenceMode;
}

export interface MediaPromptResult {
  positivePrompt: string;
  negativePrompt: string;
  sections: {
    subject?: string;
    characters?: string[];
    location?: string;
    shot?: string;
    lighting?: string;
    style?: string;
    composition?: string;
    continuity?: string;
  };
  metadata: {
    contractId: string;
    contractVersion: string;
    injectedCharacters: string[];
    injectedLocation?: string;
    injectedStyle?: string;
  };
}

export function buildMediaImagePrompt(input: MediaPromptInput): MediaPromptResult {
  const sections = buildBaseSections(input);
  const positivePrompt = [
    sections.style ? `Style: ${sections.style}` : "",
    sections.shot ? `Shot: ${sections.shot}` : "",
    sections.subject ? `Subject: ${sections.subject}` : "",
    ...(sections.characters ?? []).map((item) => `Character: ${item}`),
    sections.location ? `Location: ${sections.location}` : "",
    sections.lighting ? `Lighting: ${sections.lighting}` : "",
    sections.composition ? `Composition: ${sections.composition}` : "",
  ].filter(Boolean).join("\n");

  return {
    positivePrompt,
    negativePrompt: input.styleGuide?.negativePrompt ?? "blurry, low quality, distorted, deformed, watermark, text",
    sections,
    metadata: {
      contractId: "media.image_prompt.v1",
      contractVersion: "1.0.0",
      injectedCharacters: input.characters.map((character) => character.name),
      injectedLocation: input.location?.name,
      injectedStyle: input.styleGuide?.visualStyle,
    },
  };
}

export function buildMediaVideoPrompt(input: MediaVideoPromptInput): MediaPromptResult {
  const image = buildMediaImagePrompt(input);
  const continuity = getVideoReferenceContinuityInstruction(input.videoReferenceMode ?? "none");
  const motion = [
    input.shot.cameraMove ? `Camera movement: ${input.shot.cameraMove}` : "",
    input.shot.actionDescription ? `Action continuity: ${input.shot.actionDescription}` : "",
    input.shot.durationSeconds ? `Duration: ${input.shot.durationSeconds} seconds` : "",
    input.shot.dialogue ? `Dialogue intent: ${input.shot.dialogue}` : "",
    input.shot.soundDesign ? `Sound intent: ${input.shot.soundDesign}` : "",
    continuity,
  ].filter(Boolean).join("\n");

  return {
    ...image,
    positivePrompt: [image.positivePrompt, motion].filter(Boolean).join("\n"),
    sections: {
      ...image.sections,
      continuity,
    },
    metadata: {
      ...image.metadata,
      contractId: "media.video_prompt.v1",
    },
  };
}

function buildBaseSections(input: MediaPromptInput): MediaPromptResult["sections"] {
  return {
    subject: input.shot.visualDescription,
    characters: input.characters.map((character) => `${character.name}: ${character.appearance}`),
    location: input.location?.description,
    shot: input.shot.framing,
    lighting: input.location?.lighting,
    style: input.styleGuide?.visualStyle,
    composition: [input.styleGuide?.colorPalette, input.styleGuide?.compositionNote].filter(Boolean).join("; ") || undefined,
  };
}

export function getVideoReferenceContinuityInstruction(mode: VideoReferenceMode): string {
  if (mode === "single") {
    return "Maintain the referenced subject identity, wardrobe, hairstyle, composition, and color tone throughout the shot.";
  }
  if (mode === "first_last") {
    return "Bridge motion from the first frame to the last frame with a clear continuous action path; do not simply copy either frame.";
  }
  if (mode === "multiple") {
    return "Treat the reference images as a consistency set for character, setting, wardrobe, props, and style; do not collage them together.";
  }
  return "Use only the text description for continuity; no visual reference image is provided.";
}

export function augmentVideoPromptWithReferenceMode(prompt: string, mode: VideoReferenceMode): string {
  const trimmed = prompt.trim();
  if (!trimmed || mode === "none") {
    return trimmed;
  }

  const continuity = getVideoReferenceContinuityInstruction(mode);
  if (trimmed.includes(continuity)) {
    return trimmed;
  }

  return [trimmed, `Reference continuity: ${continuity}`].join("\n");
}
