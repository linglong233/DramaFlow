import React from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { I18nProvider } from "../apps/web/lib/i18n/provider";
import { StoryboardWorkbench } from "../apps/web/components/project-workspace/storyboard-workbench";

const queryClient = new QueryClient();
const content = {
  overview: "test overview",
  shots: [
    {
      id: "shot-1",
      sceneId: "scene-1",
      shotLabel: "1A",
      framing: "MS",
      cameraMove: "static",
      durationSeconds: 3,
      visualDescription: "A test shot",
      actionDescription: "Actor crosses frame",
      dialogue: "Hello",
      soundDesign: "Rain",
      notes: "note",
      characterIds: ["char-1"],
    },
  ],
} as const;

const project = {
  documents: [
    { id: "doc-script", projectId: "p1", type: "script", title: "Script", currentVersionId: "ver-script" },
    { id: "doc-storyboard", projectId: "p1", type: "storyboard", title: "Storyboard", currentVersionId: "ver-story" },
  ],
  versions: [
    { id: "ver-script", documentId: "doc-script", versionNumber: 1, status: "approved", title: "Script v1", content: { scenes: [{ id: "scene-1", heading: "INT. ROOM - NIGHT" }] }, metadata: {}, createdAt: new Date().toISOString() },
    { id: "ver-story", documentId: "doc-storyboard", versionNumber: 1, status: "approved", title: "Storyboard v1", content, metadata: {}, createdAt: new Date().toISOString() },
  ],
  jobs: [],
  worldBible: { characters: [{ id: "char-1", name: "Hero", appearance: "Tall", tags: [], referenceImages: [], sortOrder: 1 }], locations: [], voiceConfigs: [] },
} as const;

const html = renderToString(
  <QueryClientProvider client={queryClient}>
    <I18nProvider initialLocale="zh-CN">
      <StoryboardWorkbench content={content as any} projectId="p1" project={project as any} allowProjectMutations={false} />
    </I18nProvider>
  </QueryClientProvider>,
);

console.log(html.slice(0, 1200));