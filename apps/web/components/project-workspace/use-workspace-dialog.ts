"use client";

import { useEffect, useRef } from "react";

const dialogStack: HTMLElement[] = [];
let previousBodyOverflow = "";

export function useWorkspaceDialog(open: boolean, onClose: () => void) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialogStack.length === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    dialogStack.push(dialog);

    const getFocusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), video[controls], audio[controls], [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.getClientRects().length > 0 && !element.closest("[hidden]"));

    const focusFrame = requestAnimationFrame(() => {
      if (dialogStack.at(-1) === dialog) (getFocusable()[0] ?? dialog).focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (dialogStack.at(-1) !== dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
      } else if (event.key === "Tab") {
        const elements = getFocusable();
        const first = elements[0];
        const last = elements.at(-1);
        if (!first || !last) {
          event.preventDefault();
          dialog.focus();
        } else if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown, true);
      const wasTopDialog = dialogStack.at(-1) === dialog;
      const index = dialogStack.indexOf(dialog);
      if (index !== -1) dialogStack.splice(index, 1);
      if (dialogStack.length === 0) document.body.style.overflow = previousBodyOverflow;
      if (wasTopDialog && previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  return dialogRef;
}
