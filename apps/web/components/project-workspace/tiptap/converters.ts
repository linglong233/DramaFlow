/**
 * @fileoverview TipTap 内容转换器
 * @module web/components/tiptap
 *
 * 剧本内容在 TipTap JSON 和领域模型之间的双向转换。
 */

import type { JSONContent } from "@tiptap/react";
import type { ScriptContent, ScriptScene } from "@dramaflow/shared";

/**
 * Convert ScriptContent (API format) to TipTap JSONContent.
 * Scenes become structured blocks: sceneHeading → action paragraphs → dialogue blocks → director notes.
 */
export function scriptContentToTiptap(content: ScriptContent): JSONContent {
  const sceneNodes: JSONContent[] = [];

  for (const scene of content.scenes) {
    // Scene heading
    if (scene.heading) {
      sceneNodes.push({
        type: "sceneHeading",
        content: [{ type: "text", text: scene.heading }],
      });
    }

    // Scene synopsis as paragraph
    if (scene.synopsis) {
      sceneNodes.push({
        type: "paragraph",
        content: [{ type: "text", text: scene.synopsis }],
      });
    }

    // Dialogue blocks
    for (const d of scene.dialogue) {
      sceneNodes.push({
        type: "dialogueBlock",
        attrs: { speaker: d.speaker },
        content: d.line ? [{ type: "text", text: d.line }] : undefined,
      });
    }

    // Director note
    if (scene.directorNote) {
      sceneNodes.push({
        type: "directorNote",
        content: [{ type: "text", text: scene.directorNote }],
      });
    }

    // Separator between scenes
    sceneNodes.push({ type: "paragraph" });
  }

  return {
    type: "doc",
    content: sceneNodes.length > 0 ? sceneNodes : [{ type: "paragraph" }],
  };
}

/**
 * Convert TipTap JSONContent back to ScriptContent (API format).
 * Extracts metadata (logline, premise, characters) from separate fields,
 * and reconstructs scenes from the document structure.
 */
export function tiptapToScriptContent(
  doc: JSONContent,
  meta: { logline: string; premise: string; characters: ScriptContent["characters"] },
): ScriptContent {
  const nodes = doc.content ?? [];
  const scenes: ScriptScene[] = [];
  let currentScene: ScriptScene | null = null;

  function flushScene() {
    if (currentScene) {
      scenes.push(currentScene);
      currentScene = null;
    }
  }

  function ensureScene(): ScriptScene {
    if (!currentScene) {
      currentScene = {
        id: `scene-${scenes.length + 1}-${Date.now()}`,
        heading: "",
        synopsis: "",
        characters: [],
        dialogue: [],
      };
    }
    return currentScene;
  }

  for (const node of nodes) {
    if (node.type === "sceneHeading") {
      // Start a new scene
      flushScene();
      currentScene = {
        id: `scene-${scenes.length + 1}-${Date.now()}`,
        heading: extractText(node),
        synopsis: "",
        characters: [],
        dialogue: [],
      };
    } else if (node.type === "paragraph") {
      const text = extractText(node);
      if (text && currentScene) {
        // If scene has synopsis, this might be additional action text
        if (!currentScene.synopsis) {
          currentScene.synopsis = text;
        }
        // Additional paragraphs could be appended to synopsis with newlines,
        // but for simplicity we keep the first one
      } else if (text && !currentScene) {
        // Text before any scene heading — create implicit scene
        ensureScene();
        currentScene!.synopsis = text;
      }
    } else if (node.type === "dialogueBlock") {
      ensureScene();
      const speaker = (node.attrs?.speaker as string) ?? "";
      const line = extractText(node);
      currentScene!.dialogue.push({ speaker, line });
    } else if (node.type === "directorNote") {
      ensureScene();
      currentScene!.directorNote = extractText(node);
    }
  }

  flushScene();

  return {
    logline: meta.logline,
    premise: meta.premise,
    characters: meta.characters.filter((c) => c.name.trim()),
    scenes: scenes.map((s) => ({
      ...s,
      heading: s.heading.trim(),
      synopsis: s.synopsis.trim(),
      dialogue: s.dialogue.filter((d) => d.speaker.trim() || d.line.trim()),
    })),
  };
}

function extractText(node: JSONContent): string {
  if (!node.content) return "";
  return node.content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");
}
