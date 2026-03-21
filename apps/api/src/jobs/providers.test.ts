import test from "node:test";
import assert from "node:assert/strict";

import { OpenAiMediaProvider } from "./media-generation.provider";
import { OpenAiCompatTextProvider } from "./text-generation.provider";

test("text provider falls back to mock script content when no API key exists", async () => {
  const provider = new OpenAiCompatTextProvider();
  const script = await provider.generateScript({
    title: "追光夜行",
    genre: "都市悬疑",
    premise: "导演要在最后一晚救回流产项目",
    episodeGoal: "搭建首集冲突",
    tone: "克制、紧张",
    audience: "年轻都市观众",
  });

  assert.ok(script.logline.includes("追光夜行"));
  assert.ok(script.scenes.length >= 1);
});

test("media provider mock image returns inline SVG payload", async () => {
  const provider = new OpenAiMediaProvider();
  const result = await provider.generateImage({
    shotId: "shot-1-1",
    style: "电影剧照",
    aspectRatio: "16:9",
    prompt: "天台上的回头镜头",
  });

  assert.equal(result.provider.includes("image"), true);
  assert.equal(result.mimeType.startsWith("image"), true);
});
