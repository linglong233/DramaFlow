import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { TimelineRecord, ExportTimelineInput, TimelineClipRecord } from "@dramaflow/shared";
import { ExportService } from "./export.service";
import { buildTimelineRenderArgs, type RenderClip } from "./timeline-renderer";

const bin = process.env.FFMPEG_PATH ?? "ffmpeg";
let available = true;
try { execFileSync(bin, ["-version"], { stdio: "ignore" }); } catch { available = false; }

test("real render preserves clip positions and gaps instead of concatenating images", { skip: !available }, async () => {
  const root = await mkdtemp(join(tmpdir(), "dramaflow-render-test-"));
  try {
    const red = join(root, "red.png");
    const blue = join(root, "blue.png");
    await sharp({ create: { width: 160, height: 240, channels: 3, background: "red" } }).png().toFile(red);
    await sharp({ create: { width: 160, height: 240, channels: 3, background: "blue" } }).png().toFile(blue);
    const clip = (id: string, startTime: number): TimelineClipRecord => ({ id, startTime, duration: 0.5, inPoint: 0, sortOrder: 0 });
    const timeline: TimelineRecord = { id: "timeline", projectId: "project", duration: 2, fps: 10, resolution: "160x240", tracks: [], createdAt: "", updatedAt: "" };
    const service = new ExportService({} as never, {} as never);
    const output = join(root, "result.mp4");
    await (service as unknown as { runFfmpeg: (clips: unknown[], timeline: TimelineRecord, config: ExportTimelineInput, path: string) => Promise<void> }).runFfmpeg([
      { clip: clip("red", 0.5), trackType: "video", localPath: red },
      { clip: clip("blue", 1.5), trackType: "video", localPath: blue },
    ], timeline, { projectId: "project", resolution: "160x240", fps: 10, format: "mp4" }, output);
    const pixelAt = (time: number) => execFileSync(bin, ["-v", "error", "-ss", String(time), "-i", output, "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
    const gap = pixelAt(0.1);
    assert.ok(gap[0] < 60 && gap[1] < 60 && gap[2] < 60, "initial gap must remain dark");
    const redPixel = pixelAt(0.6);
    assert.ok(redPixel[0] > 180 && redPixel[2] < 60, "red image must start at 0.5 seconds");
    const bluePixel = pixelAt(1.6);
    assert.ok(bluePixel[2] > 180 && bluePixel[0] < 60, "blue image must start at 1.5 seconds");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("asset collection retains text subtitles without a media URL", async () => {
  const root = await mkdtemp(join(tmpdir(), "dramaflow-subtitle-test-"));
  try {
    await mkdir(join(root, "assets"));
    const timeline: TimelineRecord = { id: "timeline", projectId: "project", duration: 1, fps: 10, resolution: "160x240", createdAt: "", updatedAt: "", tracks: [{ id: "subs", type: "subtitle", name: "字幕", sortOrder: 0, isMuted: false, volume: 1, clips: [{ id: "text", startTime: 0, duration: 1, inPoint: 0, sortOrder: 0, subtitleText: "你好，导演！" }] }] };
    const service = new ExportService({} as never, {} as never);
    const resolved = await (service as unknown as { collectAssets: (timeline: TimelineRecord, root: string) => Promise<unknown[]> }).collectAssets(timeline, root);
    assert.equal(resolved.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("real render burns UTF-8 subtitles and preserves trimmed embedded audio through the full timeline", { skip: !available }, async () => {
  const root = await mkdtemp(join(tmpdir(), "dramaflow-av-test-"));
  try {
    const source = join(root, "source.mp4");
    execFileSync(bin, ["-v", "error", "-f", "lavfi", "-i", "color=blue:s=160x240:r=10:d=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-c:a", "aac", "-shortest", "-y", source]);
    const timeline: TimelineRecord = { id: "tl", projectId: "project", duration: 2, fps: 10, resolution: "160x240", tracks: [], createdAt: "", updatedAt: "" };
    const clips: RenderClip[] = [
      { clip: { id: "video", startTime: 0.5, duration: 0.5, inPoint: 1, outPoint: 1.5, sortOrder: 0 }, trackType: "video", localPath: source, volume: 0.5 },
      { clip: { id: "text", startTime: 0.5, duration: 0.5, inPoint: 0, sortOrder: 0, subtitleText: "你好 100%: '[]" }, trackType: "subtitle", localPath: "" },
      { clip: { id: "muted", startTime: 0, duration: 2, inPoint: 0, sortOrder: 0 }, trackType: "music", localPath: "must-not-be-read.wav", isMuted: true },
    ];
    const output = join(root, "result.mp4");
    const args = await buildTimelineRenderArgs(clips, timeline, { projectId: "project", resolution: "160x240", fps: 10, format: "mp4" }, output);
    execFileSync(bin, args, { cwd: root, stdio: "pipe" });
    const frame = execFileSync(bin, ["-v", "error", "-ss", "0.6", "-i", output, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
    let whitePixels = 0;
    for (let i = 0; i < frame.length; i += 3) if (frame[i] > 170 && frame[i + 1] > 170 && frame[i + 2] > 170) whitePixels++;
    assert.ok(whitePixels > 20, "subtitle must be visible in the rendered frame");
    const pcm = execFileSync(bin, ["-v", "error", "-i", output, "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "pipe:1"]);
    assert.ok(pcm.length >= 31_000, "short source audio must not shorten the two-second export");
    const rms = (start: number, end: number) => {
      let sum = 0;
      for (let index = start; index < end; index++) sum += pcm.readInt16LE(index * 2) ** 2;
      return Math.sqrt(sum / (end - start));
    };
    assert.ok(rms(4800, 6400) > 100, "embedded video audio must survive trimming and timeline assembly");
    assert.ok(rms(800, 2400) < 10, "audio must not play before the clip starts");
    assert.ok(rms(11200, 14400) < 10, "audio must stop at the clip out point");
  } finally { await rm(root, { recursive: true, force: true }); }
});
