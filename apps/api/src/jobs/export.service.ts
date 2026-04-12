/**
 * @fileoverview 视频导出服务
 * @module api/jobs
 *
 * 基于 FFmpeg 实现项目时间线的视频导出和拼接。
 */

import { Inject, Injectable, BadRequestException } from "@nestjs/common";
import { spawn } from "node:child_process";
import { mkdir, rm, stat, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { ExportRecord, ExportTimelineInput, TimelineRecord, TimelineTrackRecord, TimelineClipRecord } from "@dramaflow/shared";

import { DevDatabaseService } from "../common/dev-database.service";
import { createId } from "../common/id";
import { StorageService } from "../storage/storage.service";

export type ExportProgressCallback = (percent: number) => void;

interface ResolvedClip {
  clip: TimelineClipRecord;
  trackType: TimelineTrackRecord["type"];
  localPath: string;
}

@Injectable()
export class ExportService {
  constructor(
    @Inject(DevDatabaseService) private readonly database: DevDatabaseService,
    @Inject(StorageService) private readonly storageService: StorageService,
  ) {}

  /** Check whether ffmpeg is available on the system. */
  async checkFfmpegAvailable(): Promise<boolean> {
    if (process.env.FFMPEG_PATH === "mock") {
      return false;
    }

    const bin = process.env.FFMPEG_PATH ?? "ffmpeg";
    return new Promise<boolean>((resolve) => {
      const child = spawn(bin, ["-version"], { stdio: "pipe" });
      child.on("error", () => resolve(false));
      child.on("close", (code) => resolve(code === 0));
    });
  }

  async exportTimeline(
    userId: string,
    timeline: TimelineRecord,
    config: ExportTimelineInput,
    taskId: string,
    onProgress?: ExportProgressCallback,
  ): Promise<ExportRecord> {
    const ffmpegAvailable = await this.checkFfmpegAvailable();

    if (!ffmpegAvailable && !config.allowMockFallback) {
      throw new BadRequestException(
        "FFmpeg is not installed or not found in PATH. Set FFMPEG_PATH or allow mock fallback.",
      );
    }

    const now = new Date().toISOString();
    const exportId = createId("export");

    // Create initial export record as processing
    const exportRecord: ExportRecord = {
      id: exportId,
      projectId: config.projectId,
      taskId,
      resolution: config.resolution,
      fps: config.fps,
      bitrate: config.bitrate,
      format: config.format,
      outputUrl: undefined,
      fileSize: undefined,
      duration: timeline.duration,
      status: "processing",
      createdBy: userId,
      createdAt: now,
    };

    await this.database.mutate((db) => {
      db.exports.push(exportRecord);
    });

    // Use mock if ffmpeg is not available
    if (!ffmpegAvailable) {
      return this.mockExport(userId, exportRecord, timeline, config);
    }

    // Real FFmpeg export
    const workDir = join(tmpdir(), `dramaflow-export-${exportId}`);
    try {
      await mkdir(workDir, { recursive: true });
      await mkdir(join(workDir, "assets"), { recursive: true });
      onProgress?.(5);

      // Step 1: Collect assets
      const resolvedClips = await this.collectAssets(timeline, workDir);
      onProgress?.(20);

      // Step 2: Build and run ffmpeg
      const outputFilename = `export_${exportId}.${config.format}`;
      const outputPath = join(workDir, outputFilename);

      await this.runFfmpeg(
        resolvedClips,
        timeline,
        config,
        outputPath,
        (ffmpegPercent) => {
          // Map ffmpeg progress (0-100) to overall (20-90)
          onProgress?.(20 + Math.round(ffmpegPercent * 0.7));
        },
      );
      onProgress?.(90);

      // Step 3: Upload result
      const outputBuffer = await readFile(outputPath);
      const fileStat = await stat(outputPath);
      const mimeType = config.format === "webm" ? "video/webm"
        : config.format === "mov" ? "video/quicktime"
        : "video/mp4";

      const stored = await this.storageService.storeGeneratedAsset(userId, {
        projectId: config.projectId,
        filename: outputFilename,
        contentType: mimeType,
        body: outputBuffer,
      });
      onProgress?.(95);

      // Step 4: Update export record
      await this.database.mutate((db) => {
        const record = db.exports.find((e) => e.id === exportId);
        if (record) {
          record.status = "completed";
          record.outputUrl = stored.url;
          record.fileSize = fileStat.size;
          record.completedAt = new Date().toISOString();
        }
      });

      onProgress?.(100);

      return this.database.query((db) =>
        db.exports.find((e) => e.id === exportId)!,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown export error";
      await this.database.mutate((db) => {
        const record = db.exports.find((e) => e.id === exportId);
        if (record) {
          record.status = "failed";
          record.completedAt = new Date().toISOString();
        }
      });
      throw error;
    } finally {
      // Cleanup temp dir
      if (process.env.EXPORT_KEEP_TEMP !== "true") {
        await rm(workDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  /** Mock export: generates a placeholder video-like file when FFmpeg is unavailable. */
  private async mockExport(
    userId: string,
    exportRecord: ExportRecord,
    timeline: TimelineRecord,
    config: ExportTimelineInput,
  ): Promise<ExportRecord> {
    const [width, height] = config.resolution.split("x").map(Number);
    const w = width || 1080;
    const h = height || 1920;

    // Generate an SVG placeholder as the "export result"
    const trackSummary = timeline.tracks
      .map((t) => `${t.name}: ${t.clips.length} clips`)
      .join("\\n");

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#0f172a" />
      <stop offset="100%" stop-color="#1e293b" />
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)" />
  <rect x="40" y="40" width="${w - 80}" height="${h - 80}" rx="24" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.1)" />
  <text x="${w / 2}" y="${h * 0.3}" fill="#f1f5f9" font-size="48" font-family="sans-serif" text-anchor="middle" font-weight="bold">DramaFlow Export Preview</text>
  <text x="${w / 2}" y="${h * 0.35}" fill="#94a3b8" font-size="24" font-family="sans-serif" text-anchor="middle">FFmpeg not installed — mock mode</text>
  <text x="${w / 2}" y="${h * 0.45}" fill="#cbd5e1" font-size="20" font-family="sans-serif" text-anchor="middle">Resolution: ${config.resolution} | FPS: ${config.fps} | Format: ${config.format}</text>
  <text x="${w / 2}" y="${h * 0.50}" fill="#cbd5e1" font-size="20" font-family="sans-serif" text-anchor="middle">Duration: ${timeline.duration.toFixed(1)}s | Tracks: ${timeline.tracks.length}</text>
  <text x="${w / 2}" y="${h * 0.60}" fill="#64748b" font-size="16" font-family="sans-serif" text-anchor="middle">Install FFmpeg and restart the API to enable real video export.</text>
</svg>`.trim();

    const stored = await this.storageService.storeGeneratedAsset(userId, {
      projectId: config.projectId,
      filename: `export_mock_${exportRecord.id}.svg`,
      contentType: "image/svg+xml",
      body: svg,
    });

    await this.database.mutate((db) => {
      const record = db.exports.find((e) => e.id === exportRecord.id);
      if (record) {
        record.status = "completed";
        record.outputUrl = stored.url;
        record.fileSize = Buffer.byteLength(svg);
        record.completedAt = new Date().toISOString();
      }
    });

    return this.database.query((db) =>
      db.exports.find((e) => e.id === exportRecord.id)!,
    );
  }

  /**
   * Download / locate all clip assets into the work directory.
   * Returns only clips that have resolvable assets.
   */
  private async collectAssets(
    timeline: TimelineRecord,
    workDir: string,
  ): Promise<ResolvedClip[]> {
    const resolved: ResolvedClip[] = [];
    let index = 0;

    for (const track of timeline.tracks) {
      for (const clip of track.clips) {
        if (!clip.assetUrl) {
          continue;
        }

        const ext = this.inferExtension(clip.assetUrl, track.type);
        const localName = `asset_${index++}${ext}`;
        const localPath = join(workDir, "assets", localName);

        try {
          if (clip.assetUrl.startsWith("http://") || clip.assetUrl.startsWith("https://")) {
            await this.downloadFile(clip.assetUrl, localPath);
          } else {
            // Local file reference — resolve relative to uploads dir
            const uploadsDir = process.env.UPLOADS_DIR ?? "apps/api/uploads";
            const relativePath = clip.assetUrl.replace(/^\/uploads\//, "");
            const fullPath = join(process.cwd(), uploadsDir, relativePath);
            // Verify the file exists
            await stat(fullPath);
            resolved.push({ clip, trackType: track.type, localPath: fullPath });
            continue;
          }

          resolved.push({ clip, trackType: track.type, localPath });
        } catch {
          // Skip clips whose assets cannot be resolved
          process.stdout.write(`[export] skipping unresolvable asset: ${clip.assetUrl}\n`);
        }
      }
    }

    return resolved;
  }

  /** Run FFmpeg to compose the final video. */
  private async runFfmpeg(
    clips: ResolvedClip[],
    timeline: TimelineRecord,
    config: ExportTimelineInput,
    outputPath: string,
    onProgress?: (percent: number) => void,
  ): Promise<void> {
    const [width, height] = config.resolution.split("x").map(Number);
    const w = width || 1080;
    const h = height || 1920;
    const totalDuration = timeline.duration || 1;

    const videoClips = clips.filter((c) => c.trackType === "video");
    const audioClips = clips.filter((c) =>
      c.trackType === "dialogue" || c.trackType === "music" || c.trackType === "sfx",
    );

    const args: string[] = [];
    const filterParts: string[] = [];

    // No clips at all → generate a solid color video
    if (videoClips.length === 0 && audioClips.length === 0) {
      args.push(
        "-f", "lavfi",
        "-i", `color=c=0x0f172a:s=${w}x${h}:d=${totalDuration}:r=${config.fps}`,
        "-c:v", this.getVideoCodec(config.format),
        "-pix_fmt", "yuv420p",
        "-t", String(totalDuration),
        "-y", outputPath,
      );
      return this.spawnFfmpeg(args, totalDuration, onProgress);
    }

    // --- Build input list and filter graph ---
    let inputIndex = 0;

    // Add video inputs
    const videoInputIndices: Array<{ idx: number; clip: ResolvedClip }> = [];
    for (const vc of videoClips) {
      const isImage = this.isImageFile(vc.localPath);
      if (isImage) {
        args.push("-loop", "1", "-t", String(vc.clip.duration));
      }
      args.push("-i", vc.localPath);
      videoInputIndices.push({ idx: inputIndex++, clip: vc });
    }

    // Add audio inputs
    const audioInputIndices: Array<{ idx: number; clip: ResolvedClip }> = [];
    for (const ac of audioClips) {
      args.push("-i", ac.localPath);
      audioInputIndices.push({ idx: inputIndex++, clip: ac });
    }

    // --- Video filter chain ---
    if (videoInputIndices.length > 0) {
      // Scale and pad each video input, then concat
      const scaledLabels: string[] = [];
      for (const { idx } of videoInputIndices) {
        const label = `v${idx}`;
        filterParts.push(
          `[${idx}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=0x0f172a,setsar=1,fps=${config.fps}[${label}]`,
        );
        scaledLabels.push(`[${label}]`);
      }

      if (scaledLabels.length === 1) {
        filterParts.push(`${scaledLabels[0]}copy[outv]`);
      } else {
        filterParts.push(
          `${scaledLabels.join("")}concat=n=${scaledLabels.length}:v=1:a=0[outv]`,
        );
      }
    } else {
      // No video clips, generate blank
      args.unshift("-f", "lavfi", "-i", `color=c=0x0f172a:s=${w}x${h}:d=${totalDuration}:r=${config.fps}`);
      filterParts.push(`[0:v]copy[outv]`);
      // Shift audio indices
      for (const ai of audioInputIndices) {
        ai.idx += 1;
      }
      inputIndex += 1;
    }

    // --- Audio filter chain ---
    if (audioInputIndices.length > 0) {
      const delayedLabels: string[] = [];
      for (const { idx, clip } of audioInputIndices) {
        const delayMs = Math.round(clip.clip.startTime * 1000);
        const label = `a${idx}`;
        filterParts.push(
          `[${idx}:a]adelay=${delayMs}|${delayMs},apad=pad_dur=0[${label}]`,
        );
        delayedLabels.push(`[${label}]`);
      }

      if (delayedLabels.length === 1) {
        filterParts.push(`${delayedLabels[0]}acopy[outa]`);
      } else {
        filterParts.push(
          `${delayedLabels.join("")}amix=inputs=${delayedLabels.length}:duration=longest:normalize=0[outa]`,
        );
      }
    }

    // --- Subtitle overlays via drawtext ---
    const subtitleClips = clips.filter((c) => c.trackType === "subtitle" && c.clip.subtitleText);
    let videoOutput = "[outv]";
    for (let i = 0; i < subtitleClips.length; i++) {
      const sc = subtitleClips[i];
      const text = sc.clip.subtitleText!.replace(/'/g, "\\'").replace(/:/g, "\\:");
      const enable = `between(t,${sc.clip.startTime},${sc.clip.startTime + sc.clip.duration})`;
      const nextLabel = i === subtitleClips.length - 1 ? "[outvfinal]" : `[subv${i}]`;
      filterParts.push(
        `${videoOutput}drawtext=text='${text}':fontsize=36:fontcolor=white:borderw=2:bordercolor=black:x=(w-text_w)/2:y=h-80:enable='${enable}'${nextLabel}`,
      );
      videoOutput = nextLabel;
    }

    if (subtitleClips.length === 0) {
      // Rename outv to final
      filterParts.push(`[outv]copy[outvfinal]`);
    }

    // --- Assemble final command ---
    if (filterParts.length > 0) {
      args.push("-filter_complex", filterParts.join(";"));
    }

    args.push("-map", "[outvfinal]");
    if (audioInputIndices.length > 0) {
      args.push("-map", "[outa]");
    }

    args.push(
      "-c:v", this.getVideoCodec(config.format),
      "-pix_fmt", "yuv420p",
    );

    if (audioInputIndices.length > 0) {
      args.push("-c:a", this.getAudioCodec(config.format));
    }

    if (config.bitrate) {
      args.push("-b:v", config.bitrate);
    }

    args.push(
      "-t", String(totalDuration),
      "-shortest",
      "-y", outputPath,
    );

    return this.spawnFfmpeg(args, totalDuration, onProgress);
  }

  /** Spawn ffmpeg child process with progress parsing. */
  private spawnFfmpeg(
    args: string[],
    totalDuration: number,
    onProgress?: (percent: number) => void,
  ): Promise<void> {
    const bin = process.env.FFMPEG_PATH ?? "ffmpeg";

    return new Promise<void>((resolve, reject) => {
      const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";

      child.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;

        // Parse progress: "time=00:01:23.45"
        const timeMatch = text.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
        if (timeMatch && totalDuration > 0) {
          const hours = parseInt(timeMatch[1], 10);
          const minutes = parseInt(timeMatch[2], 10);
          const seconds = parseInt(timeMatch[3], 10);
          const centis = parseInt(timeMatch[4], 10);
          const currentTime = hours * 3600 + minutes * 60 + seconds + centis / 100;
          const percent = Math.min(100, Math.round((currentTime / totalDuration) * 100));
          onProgress?.(percent);
        }
      });

      child.on("error", (err) => {
        reject(new Error(`FFmpeg process error: ${err.message}`));
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          // Extract the last few lines of stderr for diagnostics
          const lastLines = stderr.split("\n").slice(-10).join("\n").trim();
          reject(new Error(`FFmpeg exited with code ${code}: ${lastLines}`));
        }
      });
    });
  }

  /** Download a remote file to a local path. */
  private async downloadFile(url: string, destPath: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download asset: ${url} (HTTP ${response.status})`);
    }
    const fileStream = createWriteStream(destPath);
    await pipeline(Readable.fromWeb(response.body as any), fileStream);
  }

  /** Infer file extension from URL or track type. */
  private inferExtension(url: string, trackType: string): string {
    const urlExt = extname(new URL(url, "http://localhost").pathname).toLowerCase();
    if (urlExt && urlExt !== ".") {
      return urlExt;
    }

    switch (trackType) {
      case "video": return ".mp4";
      case "dialogue":
      case "music":
      case "sfx": return ".mp3";
      default: return ".bin";
    }
  }

  /** Check if a file path looks like an image. */
  private isImageFile(filePath: string): boolean {
    const ext = extname(filePath).toLowerCase();
    return [".png", ".jpg", ".jpeg", ".svg", ".webp", ".bmp", ".gif"].includes(ext);
  }

  /** Get the appropriate video codec for the output format. */
  private getVideoCodec(format: string): string {
    if (format === "webm") return "libvpx-vp9";
    return "libx264";
  }

  /** Get the appropriate audio codec for the output format. */
  private getAudioCodec(format: string): string {
    if (format === "webm") return "libopus";
    return "aac";
  }

  async listExports(projectId: string): Promise<ExportRecord[]> {
    return this.database.query((db) => {
      return db.exports
        .filter((e) => e.projectId === projectId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
  }

  async getExport(exportId: string): Promise<ExportRecord | undefined> {
    return this.database.query((db) => {
      return db.exports.find((e) => e.id === exportId);
    });
  }
}
