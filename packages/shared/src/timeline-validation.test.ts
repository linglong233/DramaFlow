import test from "node:test";
import assert from "node:assert/strict";
import { validateTimelineInput, validateExportInput } from "./timeline-validation";

const timeline = () => ({ duration: 2, fps: 30, resolution: "1080x1920", tracks: [{ id: "video", type: "video", volume: 1, isMuted: false, clips: [{ id: "shot", startTime: 0, duration: 2, inPoint: 0 }] }] });

test("timeline validation accepts portrait editing and empty new timelines", () => {
  assert.equal(validateTimelineInput(timeline()), null);
  assert.equal(validateTimelineInput({ ...timeline(), duration: 0, tracks: [] }), null);
});
test("timeline validation rejects non-finite timings and clips beyond the end", () => {
  for (const value of [NaN, Infinity, -1, 4]) {
    const input = timeline();
    input.tracks[0].clips[0].startTime = value;
    assert.ok(validateTimelineInput(input));
  }
});
test("timeline validation rejects duplicate clip IDs and invalid volume", () => {
  const input = timeline();
  input.tracks[0].clips.push({ ...input.tracks[0].clips[0] });
  assert.ok(validateTimelineInput(input));
  const volume = timeline();
  volume.tracks[0].volume = 20;
  assert.ok(validateTimelineInput(volume));
});
test("export validation rejects malformed settings before starting work", () => {
  assert.equal(validateExportInput({ resolution: "1080x1920", fps: 30, format: "mp4" }), null);
  for (const input of [{ resolution: "1081x1920" }, { fps: Infinity }, { format: "exe" }, { allowMockFallback: "true" }, { bitrate: "-x" }]) {
    assert.ok(validateExportInput({ resolution: "1080x1920", fps: 30, format: "mp4", ...input }));
  }
});
