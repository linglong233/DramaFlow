import { Inject, Injectable } from "@nestjs/common";
import type {
  CharacterProfile,
  LocationProfile,
  PromptPreviewResult,
  ScriptContent,
  StoryboardShot,
  StyleGuideProfile,
  WorldBibleContent,
} from "@dramaflow/shared";

import { DevDatabaseService } from "../common/dev-database.service";

const FRAMING_PROMPT_MAP: Record<string, string> = {
  ECU: "extreme close-up shot",
  CU: "close-up shot",
  MCU: "medium close-up shot",
  MS: "medium shot",
  MLS: "medium long shot",
  LS: "long shot, wide shot",
  ELS: "extreme long shot, establishing shot",
  OTS: "over-the-shoulder shot",
  POV: "point-of-view shot",
  "bird-eye": "bird's eye view",
  "low-angle": "low angle shot",
  "dutch-angle": "dutch angle shot",
};

const CAMERA_MOVE_PROMPT_MAP: Record<string, string> = {
  static: "static camera",
  "pan-left": "camera panning left",
  "pan-right": "camera panning right",
  "tilt-up": "camera tilting up",
  "tilt-down": "camera tilting down",
  "dolly-in": "dolly in, camera moving forward",
  "dolly-out": "dolly out, camera pulling back",
  "zoom-in": "slow zoom in",
  "zoom-out": "slow zoom out",
  handheld: "handheld camera, slight shake",
  crane: "crane shot, ascending camera movement",
  tracking: "tracking shot, following subject",
};

@Injectable()
export class PromptBuilderService {
  constructor(
    @Inject(DevDatabaseService) private readonly database: DevDatabaseService,
  ) {}

  async buildImagePrompt(
    projectId: string,
    shot: StoryboardShot,
    worldBible: WorldBibleContent,
  ): Promise<PromptPreviewResult> {
    const characters = this.resolveCharacters(shot, worldBible);
    const location = this.findMatchingLocation(shot, worldBible);
    const style = worldBible.styleGuide;

    const positiveSegments: string[] = [];

    if (style?.visualStyle) {
      positiveSegments.push(style.visualStyle);
    }

    const framingDesc = FRAMING_PROMPT_MAP[shot.framing] ?? shot.framing;
    if (framingDesc) {
      positiveSegments.push(framingDesc);
    }

    if (shot.visualDescription) {
      positiveSegments.push(shot.visualDescription);
    }

    for (const char of characters) {
      positiveSegments.push(`${char.name}: ${char.appearance}`);
    }

    if (location) {
      positiveSegments.push(location.description);
      if (location.lighting) {
        positiveSegments.push(location.lighting);
      }
    }

    if (style?.colorPalette) {
      positiveSegments.push(style.colorPalette);
    }

    if (style?.compositionNote) {
      positiveSegments.push(style.compositionNote);
    }

    const negativePrompt = style?.negativePrompt
      ?? "blurry, low quality, distorted, deformed, watermark, text";

    return {
      positivePrompt: positiveSegments.filter(Boolean).join(", "),
      negativePrompt,
      shotId: shot.id,
      injectedCharacters: characters.map((c) => c.name),
      injectedLocation: location?.name,
      injectedStyle: style?.visualStyle,
    };
  }

  async buildStoryboardSystemPrompt(worldBible: WorldBibleContent): Promise<string> {
    const parts: string[] = [
      "你是一位专业的分镜头脚本设计师。",
      "根据剧本场景内容，生成结构化的分镜头脚本。",
    ];

    if (worldBible.styleGuide?.visualStyle) {
      parts.push(`项目风格：${worldBible.styleGuide.visualStyle}`);
    }

    if (worldBible.characters.length > 0) {
      parts.push("\n可用角色：");
      for (const char of worldBible.characters) {
        parts.push(`- ${char.name}：${char.appearance}`);
      }
    }

    if (worldBible.locations.length > 0) {
      parts.push("\n可用场景：");
      for (const loc of worldBible.locations) {
        parts.push(`- ${loc.name}：${loc.description}`);
      }
    }

    parts.push(
      "\n请为每个镜头输出以下JSON结构：",
      "{ \"shotNumber\": number, \"shotSize\": \"WIDE\" | \"MEDIUM\" | \"CLOSE_UP\" | ..., \"cameraMovement\": \"STATIC\" | \"PAN_LEFT\" | ..., \"visualDescription\": \"详细的画面描述\", \"dialogue\": \"台词（如有）\", \"actionDescription\": \"动作描述\", \"soundNote\": \"音效提示\", \"durationSeconds\": number, \"characterNames\": [\"角色名\"] }",
    );

    return parts.join("\n");
  }

  async previewPrompt(projectId: string, shotId: string): Promise<PromptPreviewResult> {
    return this.database.query((db) => {
      const worldBible = this.extractWorldBibleFromDb(db, projectId);
      const shot = this.findShotInVersions(db, projectId, shotId);

      if (!shot) {
        return {
          positivePrompt: "",
          negativePrompt: worldBible.styleGuide?.negativePrompt ?? "blurry, low quality, distorted, deformed",
          shotId,
          injectedCharacters: [],
        };
      }

      const characters = this.resolveCharacters(shot, worldBible);
      const sceneLocationId = this.resolveSceneLocationId(db, projectId, shot.sceneId);
      const location = this.findMatchingLocation(shot, worldBible, sceneLocationId);
      const style = worldBible.styleGuide;

      const positiveSegments: string[] = [];

      if (style?.visualStyle) positiveSegments.push(style.visualStyle);

      const framingDesc = FRAMING_PROMPT_MAP[shot.framing] ?? shot.framing;
      if (framingDesc) positiveSegments.push(framingDesc);
      if (shot.visualDescription) positiveSegments.push(shot.visualDescription);

      for (const char of characters) {
        positiveSegments.push(`${char.name}: ${char.appearance}`);
      }

      if (location) {
        positiveSegments.push(location.description);
        if (location.lighting) positiveSegments.push(location.lighting);
      }

      if (style?.colorPalette) positiveSegments.push(style.colorPalette);
      if (style?.compositionNote) positiveSegments.push(style.compositionNote);

      return {
        positivePrompt: positiveSegments.filter(Boolean).join(", "),
        negativePrompt: style?.negativePrompt ?? "blurry, low quality, distorted, deformed, watermark, text",
        shotId,
        injectedCharacters: characters.map((c) => c.name),
        injectedLocation: location?.name,
        injectedStyle: style?.visualStyle,
      };
    });
  }

  async buildVideoPrompt(
    projectId: string,
    shot: StoryboardShot,
    worldBible: WorldBibleContent,
  ): Promise<PromptPreviewResult> {
    const imagePrompt = await this.buildImagePrompt(projectId, shot, worldBible);

    // Extend with video-specific context
    const videoSegments: string[] = [imagePrompt.positivePrompt];

    const cameraDesc = CAMERA_MOVE_PROMPT_MAP[shot.cameraMove] ?? shot.cameraMove;
    if (cameraDesc) {
      videoSegments.push(cameraDesc);
    }

    if (shot.durationSeconds) {
      videoSegments.push(`${shot.durationSeconds} seconds duration`);
    }

    if (shot.dialogue) {
      videoSegments.push(`character speaks: "${shot.dialogue}"`);
    }

    if (shot.soundDesign) {
      videoSegments.push(`ambient sound: ${shot.soundDesign}`);
    }

    return {
      ...imagePrompt,
      positivePrompt: videoSegments.filter(Boolean).join(", "),
    };
  }

  async previewVideoPrompt(projectId: string, shotId: string): Promise<PromptPreviewResult> {
    return this.database.query((db) => {
      const worldBible = this.extractWorldBibleFromDb(db, projectId);
      const shot = this.findShotInVersions(db, projectId, shotId);

      if (!shot) {
        return {
          positivePrompt: "",
          negativePrompt: worldBible.styleGuide?.negativePrompt ?? "blurry, low quality, distorted, deformed",
          shotId,
          injectedCharacters: [],
        };
      }

      const characters = this.resolveCharacters(shot, worldBible);
      const sceneLocationId = this.resolveSceneLocationId(db, projectId, shot.sceneId);
      const location = this.findMatchingLocation(shot, worldBible, sceneLocationId);
      const style = worldBible.styleGuide;

      const positiveSegments: string[] = [];

      if (style?.visualStyle) positiveSegments.push(style.visualStyle);
      const framingDesc = FRAMING_PROMPT_MAP[shot.framing] ?? shot.framing;
      if (framingDesc) positiveSegments.push(framingDesc);
      if (shot.visualDescription) positiveSegments.push(shot.visualDescription);
      for (const char of characters) {
        positiveSegments.push(`${char.name}: ${char.appearance}`);
      }
      if (location) {
        positiveSegments.push(location.description);
        if (location.lighting) positiveSegments.push(location.lighting);
      }
      if (style?.colorPalette) positiveSegments.push(style.colorPalette);

      // Video-specific additions
      const cameraDesc = CAMERA_MOVE_PROMPT_MAP[shot.cameraMove] ?? shot.cameraMove;
      if (cameraDesc) positiveSegments.push(cameraDesc);
      if (shot.durationSeconds) positiveSegments.push(`${shot.durationSeconds} seconds duration`);
      if (shot.dialogue) positiveSegments.push(`character speaks: "${shot.dialogue}"`);
      if (shot.soundDesign) positiveSegments.push(`ambient sound: ${shot.soundDesign}`);

      return {
        positivePrompt: positiveSegments.filter(Boolean).join(", "),
        negativePrompt: style?.negativePrompt ?? "blurry, low quality, distorted, deformed, watermark, text",
        shotId,
        injectedCharacters: characters.map((c) => c.name),
        injectedLocation: location?.name,
        injectedStyle: style?.visualStyle,
      };
    });
  }

  private resolveCharacters(shot: StoryboardShot, worldBible: WorldBibleContent): CharacterProfile[] {
    if (!shot.characterIds || shot.characterIds.length === 0) {
      return [];
    }
    return worldBible.characters.filter((c) => shot.characterIds!.includes(c.id));
  }

  private findMatchingLocation(shot: StoryboardShot, worldBible: WorldBibleContent, locationId?: string): LocationProfile | undefined {
    if (worldBible.locations.length === 0) {
      return undefined;
    }
    if (locationId) {
      const exact = worldBible.locations.find((loc) => loc.id === locationId);
      if (exact) return exact;
    }
    return worldBible.locations.find((loc) =>
      shot.visualDescription?.toLowerCase().includes(loc.name.toLowerCase()),
    );
  }

  private resolveSceneLocationId(
    db: import("../common/database.types").DevDatabase,
    projectId: string,
    sceneId?: string,
  ): string | undefined {
    if (!sceneId) return undefined;
    const scriptDocs = db.documents.filter(
      (doc) => doc.projectId === projectId && doc.type === "script",
    );
    for (const doc of scriptDocs) {
      if (!doc.currentVersionId) continue;
      const version = db.versions.find((v) => v.id === doc.currentVersionId);
      if (!version?.content || typeof version.content !== "object") continue;
      const content = version.content as ScriptContent;
      if (!Array.isArray(content.scenes)) continue;
      const scene = content.scenes.find((s) => s.id === sceneId);
      if (scene?.locationId) return scene.locationId;
    }
    return undefined;
  }

  private extractWorldBibleFromDb(db: import("../common/database.types").DevDatabase, projectId: string): WorldBibleContent {
    const wbDoc = db.documents.find(
      (doc) => doc.projectId === projectId && doc.type === "world_bible",
    );
    if (!wbDoc || !wbDoc.currentVersionId) {
      return { characters: [], locations: [] };
    }

    const version = db.versions.find((v) => v.id === wbDoc.currentVersionId);
    if (!version || !version.content || typeof version.content !== "object") {
      return { characters: [], locations: [] };
    }

    const content = version.content as Record<string, unknown>;
    return {
      characters: Array.isArray(content.characters) ? content.characters as WorldBibleContent["characters"] : [],
      locations: Array.isArray(content.locations) ? content.locations as WorldBibleContent["locations"] : [],
      styleGuide: content.styleGuide && typeof content.styleGuide === "object"
        ? content.styleGuide as WorldBibleContent["styleGuide"]
        : undefined,
    };
  }

  private findShotInVersions(
    db: import("../common/database.types").DevDatabase,
    projectId: string,
    shotId: string,
  ): StoryboardShot | undefined {
    const storyboardDocs = db.documents.filter(
      (doc) => doc.projectId === projectId && doc.type === "storyboard",
    );

    for (const doc of storyboardDocs) {
      if (!doc.currentVersionId) continue;
      const version = db.versions.find((v) => v.id === doc.currentVersionId);
      if (!version?.content || typeof version.content !== "object") continue;

      const content = version.content as { shots?: StoryboardShot[] };
      if (!Array.isArray(content.shots)) continue;

      const found = content.shots.find((s) => s.id === shotId);
      if (found) return found;
    }

    return undefined;
  }
}
