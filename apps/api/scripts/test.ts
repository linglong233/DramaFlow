import assert from "node:assert/strict";

import { createEmptyDatabase } from "../src/common/database.types";
import { OpenAiMediaProvider } from "../src/jobs/media-generation.provider";
import { OpenAiCompatTextProvider } from "../src/jobs/text-generation.provider";

async function main() {
  const db = createEmptyDatabase();
  assert.equal(db.users.length, 0);
  assert.equal(db.projects.length, 0);

  const textProvider = new OpenAiCompatTextProvider();
  const script = await textProvider.generateScript({
    title: "追光夜行",
    genre: "都市悬疑",
    premise: "导演要在最后一晚救回流产项目",
    episodeGoal: "搭建首集冲突",
    tone: "克制、紧张",
    audience: "年轻都市观众",
  });
  assert.ok(script.logline.includes("追光夜行"));
  assert.ok(script.scenes.length >= 1);

  const mediaProvider = new OpenAiMediaProvider();
  const image = await mediaProvider.generateImage({
    shotId: "shot-1-1",
    style: "电影剧照",
    aspectRatio: "16:9",
    prompt: "天台上的回头镜头",
  });
  assert.equal(image.mimeType.startsWith("image"), true);
  assert.ok(image.provider.length > 0);

  console.log("api tests passed");
}

void main();
