/**
 * @fileoverview TipTap 导演注释扩展
 * @module web/components/tiptap
 *
 * 实现剧本中导演注释的自定义 TipTap 节点。
 */

import { Node, mergeAttributes } from "@tiptap/core";

export interface DirectorNoteOptions {
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    directorNote: {
      setDirectorNote: () => ReturnType;
      toggleDirectorNote: () => ReturnType;
    };
  }
}

export const DirectorNote = Node.create<DirectorNoteOptions>({
  name: "directorNote",
  group: "block",
  content: "inline*",

  addOptions() {
    return { HTMLAttributes: {} };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="director-note"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "director-note",
        class: "tiptap-director-note",
      }),
      0,
    ];
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Alt-n": () => this.editor.commands.toggleDirectorNote(),
    };
  },

  addCommands() {
    return {
      setDirectorNote:
        () =>
        ({ commands }) => {
          return commands.setNode(this.name);
        },
      toggleDirectorNote:
        () =>
        ({ commands }) => {
          return commands.toggleNode(this.name, "paragraph");
        },
    };
  },
});
