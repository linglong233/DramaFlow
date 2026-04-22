/**
 * @fileoverview 时间线编辑器
 * @module web/components/project-workspace
 *
 * 视频时间线的可视化编辑器。
 */

"use client";

import { useCallback, useMemo, useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import type { TimelineRecord, TimelineTrackRecord, TimelineClipRecord, ExportRecord, ProjectWorkspacePayload } from "@dramaflow/shared";

import { useI18n } from "../../lib/i18n";
import { apiFetch, formatApiError } from "../../lib/api";
import { InlineFeedback } from "../inline-feedback";
import { MediaLibrary } from "./media-library";

/* ── Types ── */
interface TimelineEditorProps {
  projectId: string;
  data: ProjectWorkspacePayload;
  onRefresh: () => void;
}

type TrackType = TimelineTrackRecord["type"];

/* ── Constants ── */
const TRACK_HEIGHT = 48;
const HEADER_WIDTH = 120;
const MIN_ZOOM = 20;   // px per second
const MAX_ZOOM = 200;
const DEFAULT_ZOOM = 60;

const TRACK_COLORS: Record<string, string> = {
  video: "var(--color-accent-primary, #6366f1)",
  dialogue: "var(--color-accent-warm, #f59e0b)",
  music: "var(--color-accent-cool, #06b6d4)",
  sfx: "var(--color-accent-green, #10b981)",
  subtitle: "var(--color-accent-rose, #f43f5e)",
};

/* ── Inline Icons ── */
function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 2.5v11l9-5.5L4 2.5z" fill="currentColor" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3" y="2" width="3.5" height="12" rx="0.5" fill="currentColor" />
      <rect x="9.5" y="2" width="3.5" height="12" rx="0.5" fill="currentColor" />
    </svg>
  );
}
function ZoomInIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M4 6h4M6 4v4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}
function ZoomOutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M4 6h4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}
function MagnetIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3 3v4a4 4 0 008 0V3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M3 3h2M9 3h2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/* ── Helpers ── */
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(2, "0")}`;
}

/* ── Component ── */
export function TimelineEditor({ projectId, data, onRefresh }: TimelineEditorProps) {
  const { t } = useI18n();

  // State
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [playheadTime, setPlayheadTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ message: string | null; error: string | null }>({ message: null, error: null });
  const scrollRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);

  // Export config state
  const [exportFormat, setExportFormat] = useState<"mp4" | "mov" | "webm">("mp4");
  const [exportResolution, setExportResolution] = useState("1080x1920");
  const [exportFps, setExportFps] = useState(30);
  const [showExportPanel, setShowExportPanel] = useState(false);
  const [showMockConfirm, setShowMockConfirm] = useState(false);
  const [mediaPanelOpen, setMediaPanelOpen] = useState(true);

  // Timeline data from parent or API
  const timeline: TimelineRecord | undefined = data.timeline as TimelineRecord | undefined;
  const tracks: TimelineTrackRecord[] = timeline?.tracks ?? [];
  const totalDuration = timeline?.duration ?? 0;

  // Auto-assemble mutation
  const autoAssemble = useMutation({
    mutationFn: () => apiFetch<TimelineRecord>(`/projects/${projectId}/timeline/auto-assemble`, { method: "POST" }),
    onSuccess: () => {
      setFeedback({ message: "时间线已从分镜自动装配完成", error: null });
      onRefresh();
    },
    onError: (err) => setFeedback({ message: null, error: formatApiError(err, t) }),
  });

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: (payload: { duration: number; fps: number; resolution: string; tracks: TimelineTrackRecord[] }) =>
      apiFetch<TimelineRecord>(`/projects/${projectId}/timeline`, { method: "PUT", body: payload }),
    onSuccess: () => {
      setFeedback({ message: "时间线已保存", error: null });
      onRefresh();
    },
    onError: (err) => setFeedback({ message: null, error: formatApiError(err, t) }),
  });

  // Export mutation
  const exportMutation = useMutation({
    mutationFn: (input: { resolution: string; fps: number; format: "mp4" | "mov" | "webm"; allowMockFallback?: boolean }) =>
      apiFetch<{ id: string }>(`/projects/${projectId}/export-jobs`, { method: "POST", body: input }),
    onSuccess: (result) => {
      setFeedback({ message: `导出任务已提交：${result.id}`, error: null });
      setShowExportPanel(false);
      setShowMockConfirm(false);
      onRefresh();
    },
    onError: (err) => setFeedback({ message: null, error: formatApiError(err, t) }),
  });

  // Check FFmpeg capabilities and start export flow
  async function handleExportClick() {
    setShowExportPanel(true);
  }

  async function handleExportSubmit(allowMockFallback?: boolean) {
    try {
      const caps = await apiFetch<{ ffmpegAvailable: boolean }>("/export/capabilities");
      if (!caps.ffmpegAvailable && !allowMockFallback) {
        setShowMockConfirm(true);
        return;
      }
      exportMutation.mutate({
        resolution: exportResolution,
        fps: exportFps,
        format: exportFormat,
        allowMockFallback: allowMockFallback ?? caps.ffmpegAvailable,
      });
    } catch {
      // If capabilities check fails, try anyway
      exportMutation.mutate({
        resolution: exportResolution,
        fps: exportFps,
        format: exportFormat,
        allowMockFallback: allowMockFallback,
      });
    }
  }

  // Playhead animation
  useEffect(() => {
    if (isPlaying && totalDuration > 0) {
      lastTimeRef.current = performance.now();
      const animate = (now: number) => {
        const delta = (now - lastTimeRef.current) / 1000;
        lastTimeRef.current = now;
        setPlayheadTime((prev) => {
          const next = prev + delta;
          if (next >= totalDuration) {
            setIsPlaying(false);
            return totalDuration;
          }
          return next;
        });
        animationRef.current = requestAnimationFrame(animate);
      };
      animationRef.current = requestAnimationFrame(animate);
      return () => {
        if (animationRef.current) cancelAnimationFrame(animationRef.current);
      };
    }
  }, [isPlaying, totalDuration]);

  // Zoom handler
  const handleZoom = useCallback((delta: number) => {
    setZoom((prev) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev + delta)));
  }, []);

  // Calculate timeline width based on duration and zoom
  const timelineWidth = Math.max(totalDuration * zoom, 800);

  // Ruler ticks
  const rulerTicks = useMemo(() => {
    const ticks: Array<{ position: number; label: string; major: boolean }> = [];
    if (totalDuration <= 0) return ticks;
    const interval = zoom >= 100 ? 1 : zoom >= 50 ? 2 : 5;
    for (let s = 0; s <= totalDuration; s += interval) {
      ticks.push({
        position: s * zoom,
        label: formatTime(s),
        major: s % (interval * 5) === 0 || s === 0,
      });
    }
    return ticks;
  }, [totalDuration, zoom]);

  // Handle playhead click on ruler
  const handleRulerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const time = Math.max(0, Math.min(totalDuration, x / zoom));
    setPlayheadTime(time);
  };

  // Find selected clip
  const selectedClip = useMemo(() => {
    if (!selectedClipId) return null;
    for (const track of tracks) {
      const clip = track.clips.find((c) => c.id === selectedClipId);
      if (clip) return { clip, track };
    }
    return null;
  }, [selectedClipId, tracks]);

  // Track mute toggle
  const handleTrackMute = (trackId: string) => {
    if (!timeline) return;
    const updatedTracks = tracks.map((t) =>
      t.id === trackId ? { ...t, isMuted: !t.isMuted } : t,
    );
    saveMutation.mutate({
      duration: timeline.duration,
      fps: timeline.fps,
      resolution: timeline.resolution,
      tracks: updatedTracks,
    });
  };

  // Drop handler for media assets onto track lanes
  function handleTrackDrop(e: React.DragEvent, trackType: string) {
    e.preventDefault();
    const raw = e.dataTransfer.getData("application/json");
    if (!raw) return;
    const asset: { id?: string; type?: string; title?: string; assetUrl?: string; duration?: number } = JSON.parse(raw);

    const scrollEl = (e.currentTarget as HTMLElement).closest(".timeline-scroll");
    const rect = scrollEl?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left + (scrollEl?.scrollLeft ?? 0);
    const startTime = Math.max(0, x / zoom);
    const duration = asset.duration ?? 5;

    const updatedTracks = tracks.map((track) => {
      if (track.type !== trackType) return track;
      return {
        ...track,
        clips: [
          ...track.clips,
          {
            id: `clip-${Date.now()}`,
            startTime,
            duration,
            inPoint: 0,
            outPoint: duration,
            assetUrl: asset.assetUrl,
            label: asset.title ?? "",
            sortOrder: track.clips.length,
          },
        ],
      };
    });

    saveMutation.mutate({
      duration: totalDuration,
      fps: timeline?.fps ?? 30,
      resolution: timeline?.resolution ?? "1080x1920",
      tracks: updatedTracks,
    });
  }

  return (
    <div className="timeline-editor">
      {/* Toolbar */}
      <div className="timeline-toolbar">
        <div className="timeline-toolbar-left">
          <button
            className="timeline-btn timeline-btn-primary"
            onClick={() => autoAssemble.mutate()}
            disabled={autoAssemble.isPending}
          >
            {autoAssemble.isPending ? "装配中..." : "⚡ 自动装配"}
          </button>
          <button
            className="timeline-btn"
            onClick={() => {
              if (!timeline) return;
              saveMutation.mutate({
                duration: timeline.duration,
                fps: timeline.fps,
                resolution: timeline.resolution,
                tracks,
              });
            }}
            disabled={saveMutation.isPending || !timeline}
          >
            {saveMutation.isPending ? "保存中..." : "💾 保存"}
          </button>
        </div>

        <div className="timeline-toolbar-center">
          <button
            className="timeline-btn timeline-btn-icon"
            onClick={() => { setPlayheadTime(0); setIsPlaying(false); }}
            title="回到起点"
          >
            ⏮
          </button>
          <button
            className="timeline-btn timeline-btn-play"
            onClick={() => {
              if (playheadTime >= totalDuration) setPlayheadTime(0);
              setIsPlaying(!isPlaying);
            }}
            disabled={totalDuration <= 0}
          >
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
          </button>
          <span className="timeline-time-display">{formatTime(playheadTime)} / {formatTime(totalDuration)}</span>
        </div>

        <div className="timeline-toolbar-right">
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            onClick={() => setMediaPanelOpen(!mediaPanelOpen)}
            title={mediaPanelOpen ? "Hide media library" : "Show media library"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8M12 17v4" />
            </svg>
          </button>
          <button className="timeline-btn timeline-btn-icon" onClick={() => handleZoom(-10)} title="缩小">
            <ZoomOutIcon />
          </button>
          <span className="timeline-zoom-label">{Math.round(zoom)}px/s</span>
          <button className="timeline-btn timeline-btn-icon" onClick={() => handleZoom(10)} title="放大">
            <ZoomInIcon />
          </button>
          <button
            className="timeline-btn timeline-btn-primary"
            onClick={handleExportClick}
            disabled={exportMutation.isPending || totalDuration <= 0}
          >
            {exportMutation.isPending ? "导出中..." : "🎬 导出视频"}
          </button>
        </div>
      </div>

      <InlineFeedback message={feedback.message} error={feedback.error} />

      <div className="timeline-content-row">
        {mediaPanelOpen && <MediaLibrary projectId={projectId} data={data} onRefresh={onRefresh} />}
        <div className="timeline-editor-main" style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
      {/* Timeline body */}
      <div className="timeline-body">
        {/* Track headers */}
        <div className="timeline-headers">
          <div className="timeline-ruler-spacer" />
          {tracks.map((track) => (
            <div key={track.id} className="timeline-track-header" style={{ height: TRACK_HEIGHT }}>
              <span
                className="timeline-track-color"
                style={{ backgroundColor: TRACK_COLORS[track.type] ?? "#888" }}
              />
              <span className="timeline-track-name">{track.name}</span>
              <button
                className={`timeline-track-mute ${track.isMuted ? "muted" : ""}`}
                onClick={() => handleTrackMute(track.id)}
                title={track.isMuted ? "取消静音" : "静音"}
              >
                {track.isMuted ? "🔇" : "🔊"}
              </button>
            </div>
          ))}
        </div>

        {/* Scrollable tracks area */}
        <div className="timeline-scroll" ref={scrollRef}>
          {/* Ruler */}
          <div
            className="timeline-ruler"
            style={{ width: timelineWidth }}
            onClick={handleRulerClick}
          >
            {rulerTicks.map((tick, i) => (
              <div
                key={i}
                className={`timeline-ruler-tick ${tick.major ? "major" : ""}`}
                style={{ left: tick.position }}
              >
                {tick.major && <span className="timeline-ruler-label">{tick.label}</span>}
              </div>
            ))}
            {/* Playhead on ruler */}
            <div
              className="timeline-playhead-marker"
              style={{ left: playheadTime * zoom }}
            />
          </div>

          {/* Track lanes */}
          <div className="timeline-lanes" style={{ width: timelineWidth }}>
            {tracks.map((track) => (
              <div
                key={track.id}
                className={`timeline-track-lane ${track.isMuted ? "muted" : ""}`}
                style={{ height: TRACK_HEIGHT }}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
                onDrop={(e) => handleTrackDrop(e, track.type)}
              >
                {track.clips.map((clip) => (
                  <div
                    key={clip.id}
                    className={`timeline-clip ${selectedClipId === clip.id ? "selected" : ""}`}
                    style={{
                      left: clip.startTime * zoom,
                      width: Math.max(clip.duration * zoom, 4),
                      backgroundColor: TRACK_COLORS[track.type] ?? "#888",
                    }}
                    onClick={() => setSelectedClipId(clip.id)}
                    title={clip.label ?? clip.id}
                  >
                    <span className="timeline-clip-label">
                      {clip.label ?? clip.subtitleText ?? clip.id.slice(0, 8)}
                    </span>
                  </div>
                ))}
              </div>
            ))}

            {/* Playhead line */}
            <div
              className="timeline-playhead"
              style={{ left: playheadTime * zoom }}
            />
          </div>
        </div>
      </div>

      {/* Properties panel */}
      {selectedClip && (
        <div className="timeline-properties">
          <h4 className="timeline-properties-title">属性面板</h4>
          <div className="timeline-properties-grid">
            <label>标签</label>
            <span>{selectedClip.clip.label ?? "—"}</span>
            <label>轨道</label>
            <span>{selectedClip.track.name}</span>
            <label>开始时间</label>
            <span>{formatTime(selectedClip.clip.startTime)}</span>
            <label>时长</label>
            <span>{selectedClip.clip.duration.toFixed(1)}s</span>
            {selectedClip.clip.subtitleText && (
              <>
                <label>字幕</label>
                <span>{selectedClip.clip.subtitleText}</span>
              </>
            )}
            {selectedClip.clip.assetUrl && (
              <>
                <label>资产</label>
                <span className="timeline-asset-url">{selectedClip.clip.assetUrl}</span>
              </>
            )}
          </div>
          <button
            className="timeline-btn timeline-btn-sm"
            onClick={() => setSelectedClipId(null)}
          >
            关闭
          </button>
        </div>
      )}

      {/* Export config panel */}
      {showExportPanel && (
        <div className="timeline-export-config">
          <h4 className="timeline-exports-title">导出设置</h4>
          <div className="timeline-export-config-grid">
            <label>格式</label>
            <select
              className="timeline-export-select"
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value as "mp4" | "mov" | "webm")}
            >
              <option value="mp4">MP4 (H.264)</option>
              <option value="mov">MOV (QuickTime)</option>
              <option value="webm">WebM (VP9)</option>
            </select>
            <label>分辨率</label>
            <select
              className="timeline-export-select"
              value={exportResolution}
              onChange={(e) => setExportResolution(e.target.value)}
            >
              <option value="1080x1920">1080×1920 (竖屏)</option>
              <option value="1920x1080">1920×1080 (横屏)</option>
              <option value="720x1280">720×1280 (竖屏低清)</option>
              <option value="1280x720">1280×720 (横屏低清)</option>
            </select>
            <label>帧率</label>
            <select
              className="timeline-export-select"
              value={exportFps}
              onChange={(e) => setExportFps(Number(e.target.value))}
            >
              <option value={24}>24 FPS</option>
              <option value={25}>25 FPS</option>
              <option value={30}>30 FPS</option>
              <option value={60}>60 FPS</option>
            </select>
          </div>
          <div className="timeline-export-config-actions">
            <button
              className="timeline-btn timeline-btn-primary"
              onClick={() => handleExportSubmit()}
              disabled={exportMutation.isPending}
            >
              {exportMutation.isPending ? "提交中..." : "开始导出"}
            </button>
            <button
              className="timeline-btn"
              onClick={() => { setShowExportPanel(false); setShowMockConfirm(false); }}
            >
              取消
            </button>
          </div>

          {/* Mock fallback confirmation */}
          {showMockConfirm && (
            <div className="timeline-mock-confirm">
              <p className="timeline-mock-confirm-text">
                ⚠️ 系统未检测到 FFmpeg，无法生成真实视频。是否使用预览模式导出？
              </p>
              <div className="timeline-export-config-actions">
                <button
                  className="timeline-btn timeline-btn-primary"
                  onClick={() => handleExportSubmit(true)}
                  disabled={exportMutation.isPending}
                >
                  使用预览模式
                </button>
                <button
                  className="timeline-btn"
                  onClick={() => { setShowMockConfirm(false); setShowExportPanel(false); }}
                >
                  取消导出
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Export records */}
      {(data.exports as ExportRecord[] | undefined)?.length ? (
        <div className="timeline-exports">
          <h4 className="timeline-exports-title">导出记录</h4>
          <div className="timeline-exports-list">
            {(data.exports as ExportRecord[]).slice(0, 5).map((exp) => (
              <div key={exp.id} className="timeline-export-item">
                <span className={`timeline-export-status status-${exp.status}`}>
                  {exp.status === "processing" ? "导出中" : exp.status === "completed" ? "已完成" : exp.status === "failed" ? "失败" : exp.status}
                </span>
                <span className="timeline-export-format">{exp.format.toUpperCase()}</span>
                <span className="timeline-export-res">{exp.resolution}</span>
                <span className="timeline-export-date">
                  {new Date(exp.createdAt).toLocaleDateString()}
                </span>
                {exp.fileSize ? (
                  <span className="timeline-export-size">
                    {(exp.fileSize / 1024 / 1024).toFixed(1)} MB
                  </span>
                ) : null}
                {exp.outputUrl && (
                  <a href={exp.outputUrl} className="timeline-export-download" download>
                    ⬇ 下载
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
        </div>
      </div>
    </div>
  );
}
