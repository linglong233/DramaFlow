/**
 * @fileoverview 标签输入组件
 * @module web/components/tiptap
 *
 * 支持标签输入和管理的通用组件。
 */

"use client";

import { useState } from "react";

export function TagInput({
  tags,
  onChange,
  placeholder,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder: string;
}) {
  const [input, setInput] = useState("");

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && input.trim()) {
      e.preventDefault();
      if (!tags.includes(input.trim())) {
        onChange([...tags, input.trim()]);
      }
      setInput("");
    }
    if (e.key === "Backspace" && !input && tags.length) {
      onChange(tags.slice(0, -1));
    }
  }

  return (
    <div className="wb-tag-input">
      {tags.map((tag) => (
        <span key={tag} className="wb-tag">
          {tag}
          <button
            type="button"
            className="wb-tag-remove"
            onClick={() => onChange(tags.filter((t) => t !== tag))}
          >
            x
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={tags.length === 0 ? placeholder : ""}
        className="wb-tag-input-field"
      />
    </div>
  );
}
