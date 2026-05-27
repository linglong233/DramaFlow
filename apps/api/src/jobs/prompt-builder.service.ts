/**
 * @fileoverview 提示词构建服务
 * @module api/jobs
 *
 * 根据世界观设定和镜头信息构建图片/视频生成提示词。
 */

import { Inject, Injectable } from "@nestjs/common";
import type {
  CharacterProfile,
  LocationProfile,
  PromptPreviewResult,
  ScriptContent,
  StoryboardShot,
  StyleGuideProfile,
  VideoReferenceMode,
  WorldBibleContent,
} from "@dramaflow/shared";

import { PrismaService } from "../common/prisma.service";
import { jsonOutput } from "../common/prisma-json";
import { buildMediaImagePrompt, buildMediaVideoPrompt } from "./prompting/media-prompt-builder";

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
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async buildImagePrompt(
    projectId: string,
    shot: StoryboardShot,
    worldBible: WorldBibleContent,
  ): Promise<PromptPreviewResult> {
    const characters = this.resolveCharacters(shot, worldBible);
    const location = this.findMatchingLocation(shot, worldBible);
    const style = worldBible.styleGuide;

    const mediaPrompt = buildMediaImagePrompt({
      shot,
      characters,
      location: location ?? undefined,
      styleGuide: style ?? undefined,
    });

    return {
      positivePrompt: mediaPrompt.positivePrompt,
      negativePrompt: mediaPrompt.negativePrompt,
      shotId: shot.id,
      injectedCharacters: mediaPrompt.metadata.injectedCharacters,
      injectedLocation: mediaPrompt.metadata.injectedLocation,
      injectedStyle: mediaPrompt.metadata.injectedStyle,
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
    const worldBible = await this.extractWorldBible(projectId);
    const shot = await this.findShotInVersions(projectId, shotId);

    if (!shot) {
      return {
        positivePrompt: "",
        negativePrompt: worldBible.styleGuide?.negativePrompt ?? "blurry, low quality, distorted, deformed",
        shotId,
        injectedCharacters: [],
      };
    }

    const characters = this.resolveCharacters(shot, worldBible);
    const sceneLocationId = await this.resolveSceneLocationId(projectId, shot.sceneId);
    const location = this.findMatchingLocation(shot, worldBible, sceneLocationId);
    const style = worldBible.styleGuide;

    const mediaPrompt = buildMediaImagePrompt({
      shot,
      characters,
      location: location ?? undefined,
      styleGuide: style ?? undefined,
    });

    return {
      positivePrompt: mediaPrompt.positivePrompt,
      negativePrompt: mediaPrompt.negativePrompt,
      shotId,
      injectedCharacters: mediaPrompt.metadata.injectedCharacters,
      injectedLocation: mediaPrompt.metadata.injectedLocation,
      injectedStyle: mediaPrompt.metadata.injectedStyle,
    };
  }

  async buildVideoPrompt(
    projectId: string,
    shot: StoryboardShot,
    worldBible: WorldBibleContent,
    videoReferenceMode: VideoReferenceMode = "none",
  ): Promise<PromptPreviewResult> {
    const characters = this.resolveCharacters(shot, worldBible);
    const location = this.findMatchingLocation(shot, worldBible);
    const style = worldBible.styleGuide;

    const mediaPrompt = buildMediaVideoPrompt({
      shot,
      characters,
      location: location ?? undefined,
      styleGuide: style ?? undefined,
      videoReferenceMode,
    });

    return {
      positivePrompt: mediaPrompt.positivePrompt,
      negativePrompt: mediaPrompt.negativePrompt,
      shotId: shot.id,
      injectedCharacters: mediaPrompt.metadata.injectedCharacters,
      injectedLocation: mediaPrompt.metadata.injectedLocation,
      injectedStyle: mediaPrompt.metadata.injectedStyle,
    };
  }

  async previewVideoPrompt(
    projectId: string,
    shotId: string,
    videoReferenceMode: VideoReferenceMode = "none",
  ): Promise<PromptPreviewResult> {
    const worldBible = await this.extractWorldBible(projectId);
    const shot = await this.findShotInVersions(projectId, shotId);

    if (!shot) {
      return {
        positivePrompt: "",
        negativePrompt: worldBible.styleGuide?.negativePrompt ?? "blurry, low quality, distorted, deformed",
        shotId,
        injectedCharacters: [],
      };
    }

    const characters = this.resolveCharacters(shot, worldBible);
    const sceneLocationId = await this.resolveSceneLocationId(projectId, shot.sceneId);
    const location = this.findMatchingLocation(shot, worldBible, sceneLocationId);
    const style = worldBible.styleGuide;

    const mediaPrompt = buildMediaVideoPrompt({
      shot,
      characters,
      location: location ?? undefined,
      styleGuide: style ?? undefined,
      videoReferenceMode,
    });

    return {
      positivePrompt: mediaPrompt.positivePrompt,
      negativePrompt: mediaPrompt.negativePrompt,
      shotId,
      injectedCharacters: mediaPrompt.metadata.injectedCharacters,
      injectedLocation: mediaPrompt.metadata.injectedLocation,
      injectedStyle: mediaPrompt.metadata.injectedStyle,
    };
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

  private async resolveSceneLocationId(
    projectId: string,
    sceneId?: string,
  ): Promise<string | undefined> {
    if (!sceneId) return undefined;
    const scriptDocs = await this.prisma.document.findMany({
      where: { projectId, type: "script" },
    });
    for (const doc of scriptDocs) {
      if (!doc.currentVersionId) continue;
      const version = await this.prisma.version.findUnique({ where: { id: doc.currentVersionId } });
      if (!version?.content || typeof version.content !== "object") continue;
      const content = jsonOutput<ScriptContent>(version.content);
      if (!Array.isArray(content.scenes)) continue;
      const scene = content.scenes.find((s) => s.id === sceneId);
      if (scene?.locationId) return scene.locationId;
    }
    return undefined;
  }

  private async extractWorldBible(projectId: string): Promise<WorldBibleContent> {
    const wbDoc = await this.prisma.document.findFirst({
      where: { projectId, type: "world_bible" },
    });
    if (!wbDoc?.currentVersionId) return { characters: [], locations: [] };

    const version = await this.prisma.version.findUnique({ where: { id: wbDoc.currentVersionId } });
    if (!version?.content || typeof version.content !== "object") return { characters: [], locations: [] };

    const content = jsonOutput<Record<string, unknown>>(version.content);
    return {
      characters: Array.isArray(content.characters) ? content.characters as WorldBibleContent["characters"] : [],
      locations: Array.isArray(content.locations) ? content.locations as WorldBibleContent["locations"] : [],
      styleGuide: content.styleGuide && typeof content.styleGuide === "object"
        ? content.styleGuide as WorldBibleContent["styleGuide"] : undefined,
    };
  }

  private async getStoryboardVersionCandidates(
    documentId: string,
    currentVersionId?: string,
    draftVersionId?: string,
  ) {
    const candidateIds = [currentVersionId, draftVersionId].filter((id): id is string => Boolean(id));
    const versions = [];
    for (const id of candidateIds) {
      const version = await this.prisma.version.findUnique({ where: { id } });
      if (version && version.documentId === documentId) versions.push(version);
    }
    const seen = new Set(versions.map((v) => v.id));
    const newestVersions = await this.prisma.version.findMany({
      where: { documentId, id: { notIn: [...seen] } },
      orderBy: { versionNumber: "desc" },
    });
    return [...versions, ...newestVersions];
  }

  private async findShotInVersions(
    projectId: string,
    shotId: string,
  ): Promise<StoryboardShot | undefined> {
    const storyboardDocs = await this.prisma.document.findMany({
      where: { projectId, type: "storyboard" },
    });

    for (const doc of storyboardDocs) {
      const versions = await this.getStoryboardVersionCandidates(
        doc.id,
        doc.currentVersionId ?? undefined,
        doc.draftVersionId ?? undefined,
      );

      for (const version of versions) {
        if (!version.content || typeof version.content !== "object") continue;

        const content = jsonOutput<{ shots?: StoryboardShot[] }>(version.content);
        if (!Array.isArray(content.shots)) continue;

        const found = content.shots.find((s) => s.id === shotId);
        if (found) return found;
      }
    }

    return undefined;
  }
}
