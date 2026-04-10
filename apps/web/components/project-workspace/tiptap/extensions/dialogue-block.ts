import { Node, mergeAttributes } from "@tiptap/core";

export interface DialogueBlockOptions {
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    dialogueBlock: {
      setDialogueBlock: (attrs?: { speaker: string }) => ReturnType;
      toggleDialogueBlock: () => ReturnType;
    };
  }
}

export const DialogueBlock = Node.create<DialogueBlockOptions>({
  name: "dialogueBlock",
  group: "block",
  content: "inline*",

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      speaker: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-speaker") ?? "",
        renderHTML: (attrs) => {
          if (!attrs.speaker) return {};
          return { "data-speaker": attrs.speaker as string };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="dialogue-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "dialogue-block",
        class: "tiptap-dialogue-block",
      }),
      0,
    ];
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Alt-d": () => this.editor.commands.setDialogueBlock({ speaker: "" }),
    };
  },

  addCommands() {
    return {
      setDialogueBlock:
        (attrs) =>
        ({ commands }) => {
          return commands.setNode(this.name, attrs ?? { speaker: "" });
        },
      toggleDialogueBlock:
        () =>
        ({ commands }) => {
          return commands.toggleNode(this.name, "paragraph");
        },
    };
  },
});
