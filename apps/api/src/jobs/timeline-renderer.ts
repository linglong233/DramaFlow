import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { promisify } from "node:util";
import type { ExportTimelineInput, TimelineClipRecord, TimelineRecord, TrackType } from "@dramaflow/shared";

const exec = promisify(execFile);

export interface RenderClip {
  clip: TimelineClipRecord;
  trackType: TrackType;
  localPath: string;
  volume?: number;
  isMuted?: boolean;
}

export async function buildTimelineRenderArgs(
  clips: RenderClip[], timeline: TimelineRecord, config: ExportTimelineInput, outputPath: string,
): Promise<string[]> {
  const [width, height] = config.resolution.split("x").map(Number);
  const duration = timeline.duration;
  const args = ["-nostdin", "-hide_banner", "-f", "lavfi", "-i", `color=c=0x0f172a:s=${width}x${height}:d=${duration}:r=${config.fps}`];
  const filters: string[] = ["[0:v]format=yuv420p[base0]"];
  const audioLabels: string[] = [];
  let inputIndex = 1;
  let visualIndex = 0;
  let audioIndex = 0;
  const ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg";
  const ffprobe = process.env.FFPROBE_PATH ?? (dirname(ffmpeg) === "." ? "ffprobe" : join(dirname(ffmpeg), process.platform === "win32" ? "ffprobe.exe" : "ffprobe"));

  for (const item of clips) {
    if (item.trackType === "subtitle") continue;
    const { clip } = item;
    const image = item.trackType === "video" && [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".svg", ".gif"].includes(extname(item.localPath).toLowerCase());
    const isVideo = item.trackType === "video";
    if (!isVideo && item.isMuted) continue;
    let hasAudio = !isVideo;
    if (isVideo && !image && !item.isMuted && item.volume !== 0) {
      const probe = await exec(ffprobe, ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "json", item.localPath], { timeout: 30_000, windowsHide: true, maxBuffer: 1024 * 1024 });
      const data = JSON.parse(probe.stdout) as { streams: unknown[] };
      hasAudio = Array.isArray(data.streams) && data.streams.length > 0;
    }
    if (image) args.push("-loop", "1", "-framerate", String(config.fps), "-t", String(clip.duration));
    args.push("-i", item.localPath);
    const index = inputIndex++;
    const sourceDuration = clip.outPoint === undefined ? clip.duration : Math.min(clip.duration, clip.outPoint - clip.inPoint);
    if (isVideo) {
      const label = `visual${visualIndex}`;
      const transitionDuration = Math.min(clip.transitionDuration ?? 0.5, clip.duration / 2);
      const fadeIn = clip.transitionIn === "fade" || clip.transitionIn === "dissolve" ? `,fade=t=in:st=0:d=${transitionDuration}` : "";
      const fadeOut = clip.transitionOut === "fade" || clip.transitionOut === "dissolve" ? `,fade=t=out:st=${clip.duration - transitionDuration}:d=${transitionDuration}` : "";
      filters.push(`[${index}:v]trim=start=${image ? 0 : clip.inPoint}:duration=${sourceDuration},setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x0f172a,setsar=1,fps=${config.fps},tpad=stop_mode=clone:stop_duration=${clip.duration},trim=duration=${clip.duration}${fadeIn}${fadeOut},setpts=PTS+${clip.startTime}/TB[${label}]`);
      filters.push(`[base${visualIndex}][${label}]overlay=eof_action=pass:repeatlast=0:enable='gte(t,${clip.startTime})*lt(t,${clip.startTime + clip.duration})'[base${visualIndex + 1}]`);
      visualIndex++;
    }
    if (hasAudio && !item.isMuted) {
      const label = `audio${audioIndex++}`;
      filters.push(`[${index}:a]atrim=start=${clip.inPoint}:duration=${sourceDuration},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=${item.volume ?? 1},adelay=${Math.round(clip.startTime * 1000)}:all=1[${label}]`);
      audioLabels.push(`[${label}]`);
    }
  }

  let outputVideo = `[base${visualIndex}]`;
  const subtitles = clips.filter(item => item.trackType === "subtitle" && !item.isMuted && item.clip.subtitleText?.trim());
  for (const [index, item] of subtitles.entries()) {
    const filename = `subtitle_${index}.txt`;
    await writeFile(join(dirname(outputPath), filename), item.clip.subtitleText!, "utf8");
    const fontPath = process.env.FFMPEG_FONT_PATH;
    const font = fontPath ? `:fontfile='${fontPath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'")}'` : "";
    const fontsize = Math.max(14, Math.round(height * 0.032));
    const label = `[subtitle${index}]`;
    filters.push(`${outputVideo}drawtext=textfile=${filename}:expansion=none${font}:fontsize=${fontsize}:fontcolor=white:borderw=2:bordercolor=black:x=(w-text_w)/2:y=h-text_h-h*0.08:enable='gte(t,${item.clip.startTime})*lt(t,${item.clip.startTime + item.clip.duration})'${label}`);
    outputVideo = label;
  }
  if (audioLabels.length) {
    filters.push(`${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=longest:normalize=0,alimiter=limit=0.95:level=0,apad,atrim=duration=${duration}[audioout]`);
  }
  args.push("-filter_complex", filters.join(";"), "-map", outputVideo);
  if (audioLabels.length) args.push("-map", "[audioout]", "-c:a", config.format === "webm" ? "libopus" : "aac");
  args.push("-c:v", config.format === "webm" ? "libvpx-vp9" : "libx264", "-pix_fmt", "yuv420p", "-r", String(config.fps));
  if (config.bitrate) args.push("-b:v", config.bitrate);
  if (config.format !== "webm") args.push("-movflags", "+faststart");
  args.push("-t", String(duration), "-y", basename(outputPath));
  return args;
}
