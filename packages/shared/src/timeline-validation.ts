import type { TimelineSavePayload } from "./api-contracts";
import type { ExportTimelineInput, TimelineRecord, TimelineDeliverySummary } from "./domain";

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function validateRenderSettings(value: unknown): string | null {
  if (!record(value)) return "Render settings are required";
  if (typeof value.resolution !== "string" || !/^\d+x\d+$/.test(value.resolution)) return "Resolution must use WIDTHxHEIGHT";
  const [width, height] = value.resolution.split("x").map(Number);
  if (![width, height].every(size => size >= 16 && size <= 4096 && size % 2 === 0)) return "Resolution dimensions must be even integers between 16 and 4096";
  if (!finite(value.fps) || value.fps < 1 || value.fps > 60) return "Frame rate must be between 1 and 60";
  return null;
}

export function validateExportInput(value: ExportTimelineInput | unknown): string | null {
  const error = validateRenderSettings(value);
  if (error) return error;
  const input = value as Record<string, unknown>;
  if (!["mp4", "mov", "webm"].includes(input.format as string)) return "Unsupported export format";
  if (input.allowMockFallback !== undefined && typeof input.allowMockFallback !== "boolean") return "Mock fallback must be a boolean";
  if (input.bitrate !== undefined && (typeof input.bitrate !== "string" || !/^\d+(?:\.\d+)?[kKmM]?$/.test(input.bitrate))) return "Invalid video bitrate";
  return null;
}

export function validateTimelineInput(value: TimelineSavePayload | unknown): string | null {
  const settingsError = validateRenderSettings(value);
  if (settingsError) return settingsError;
  const input = value as Record<string, unknown>;
  if (!finite(input.duration) || input.duration < 0 || input.duration > 21_600) return "Timeline duration must be between 0 and 21600 seconds";
  if (!Array.isArray(input.tracks) || input.tracks.length > 32) return "Timeline supports up to 32 tracks";
  const ids = new Set<string>();
  let clipCount = 0;
  for (const track of input.tracks) {
    if (!record(track) || typeof track.id !== "string" || !track.id || ids.has(track.id)) return "Track identifiers must be unique non-empty strings";
    ids.add(track.id);
    if (!["video", "dialogue", "music", "sfx", "subtitle"].includes(track.type as string)) return "Invalid timeline track type";
    if (!finite(track.volume) || track.volume < 0 || track.volume > 1 || typeof track.isMuted !== "boolean") return "Invalid track volume or mute state";
    if (!Array.isArray(track.clips)) return "Track clips must be an array";
    for (const clip of track.clips) {
      if (++clipCount > 2000) return "Timeline supports up to 2000 clips";
      if (!record(clip) || typeof clip.id !== "string" || !clip.id || ids.has(clip.id)) return "Clip identifiers must be unique non-empty strings";
      ids.add(clip.id);
      if (!finite(clip.startTime) || clip.startTime < 0 || !finite(clip.duration) || clip.duration <= 0 || !finite(clip.inPoint) || clip.inPoint < 0) return "Clip timing must contain finite non-negative values and a positive duration";
      if (clip.startTime + clip.duration > input.duration + 0.001) return "Clip extends beyond the timeline duration";
      if (clip.outPoint !== undefined && (!finite(clip.outPoint) || clip.outPoint <= clip.inPoint)) return "Clip out point must be after its in point";
      if (clip.transitionDuration !== undefined && (!finite(clip.transitionDuration) || clip.transitionDuration < 0)) return "Invalid transition duration";
      for (const transition of [clip.transitionIn, clip.transitionOut]) {
        if (transition !== undefined && !["none", "fade", "dissolve", "wipe"].includes(transition as string)) return "Invalid transition type";
      }
      if (track.type === "subtitle" && (typeof clip.subtitleText !== "string" || !clip.subtitleText.trim() || clip.subtitleText.length > 10000)) return "Subtitle text must contain between 1 and 10000 characters";
      if (clip.assetUrl !== undefined && (typeof clip.assetUrl !== "string" || clip.assetUrl.length > 8192)) return "Invalid asset URL";
    }
  }
  return null;
}

export function getTimelineDeliverySummary(timeline: TimelineRecord): TimelineDeliverySummary {
  const visual = timeline.tracks.filter(track => track.type === "video").flatMap(track => track.clips);
  const active = timeline.tracks.filter(track => !track.isMuted || track.type === "video");
  const missingAssetCount = active.filter(track => track.type !== "subtitle").flatMap(track => track.clips).filter(clip => !clip.assetId && !clip.assetUrl).length;
  const intervals = visual.filter(clip => clip.assetId || clip.assetUrl).map(clip => [clip.startTime, clip.startTime + clip.duration]).sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let end = 0;
  for (const [start, stop] of intervals) {
    covered += Math.max(0, Math.min(stop, timeline.duration) - Math.max(start, end));
    end = Math.max(end, stop);
  }
  return {
    visualClipCount: visual.length,
    missingAssetCount,
    subtitleCount: active.filter(track => track.type === "subtitle").flatMap(track => track.clips).filter(clip => clip.subtitleText?.trim()).length,
    audibleClipCount: active.filter(track => track.type !== "video" && track.type !== "subtitle" && track.volume > 0).flatMap(track => track.clips).length,
    uncoveredSeconds: Math.max(0, timeline.duration - covered),
    canExport: timeline.duration > 0 && visual.length > 0 && missingAssetCount === 0 && validateTimelineInput(timeline) === null,
  };
}

export function buildTimelineSubtitles(timeline: TimelineRecord): string {
  const timestamp = (seconds: number) => {
    const milliseconds = Math.max(0, Math.round(seconds * 1000));
    const hours = Math.floor(milliseconds / 3_600_000);
    const minutes = Math.floor(milliseconds / 60_000) % 60;
    const remainingSeconds = Math.floor(milliseconds / 1000) % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")},${String(milliseconds % 1000).padStart(3, "0")}`;
  };
  return timeline.tracks.filter(track => track.type === "subtitle" && !track.isMuted).flatMap(track => track.clips)
    .filter(clip => clip.subtitleText?.trim()).sort((a, b) => a.startTime - b.startTime)
    .map((clip, index) => `${index + 1}\n${timestamp(clip.startTime)} --> ${timestamp(Math.min(timeline.duration, clip.startTime + clip.duration))}\n${clip.subtitleText!.trim()}\n`)
    .join("\n");
}
