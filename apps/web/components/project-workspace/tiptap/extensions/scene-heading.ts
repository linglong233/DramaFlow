import { Node, mergeAttributes } from "@tiptap/core";

export interface SceneHeadingOptions {
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    sceneHeading: {
      setSceneHeading: () => ReturnType;
      toggleSceneHeading: () => ReturnType;
    };
  }
}

export const SceneHeading = Node.create<SceneHeadingOptions>({
  name: "sceneHeading",
  group: "block",
  content: "inline*",
  defining: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="scene-heading"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "scene-heading",
        class: "tiptap-scene-heading",
      }),
      0,
    ];
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Alt-0": () => this.editor.commands.toggleSceneHeading(),
    };
  },

  addCommands() {
    return {
      setSceneHeading:
        () =>
        ({ commands }) => {
          return commands.setNode(this.name);
        },
      toggleSceneHeading:
        () =>
        ({ commands }) => {
          return commands.toggleNode(this.name, "paragraph");
        },
    };
  },
});
