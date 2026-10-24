import { TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { createEditor, type EditorHandle } from "./editor";

export function makeEditor(markdown = ""): EditorHandle {
  return createEditor(document.createElement("div"), { markdown, onChange: () => {}, noteRel: "a.md" });
}

/** Types text one character at a time through `handleTextInput` so input rules fire. */
export function typeInto(view: EditorView, text: string): void {
  for (const ch of text) {
    const { from, to } = view.state.selection;
    const handled = view.someProp("handleTextInput", (f) => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)));
    if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to));
  }
}

/** Dispatches a keydown through the editor's key handlers. Returns true if handled. */
export function pressKey(
  view: EditorView,
  key: string,
  mods: { ctrl?: boolean; shift?: boolean } = {},
): boolean {
  const event = new KeyboardEvent("keydown", {
    key,
    keyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : undefined,
    ctrlKey: !!mods.ctrl,
    shiftKey: !!mods.shift,
    bubbles: true,
    cancelable: true,
  });
  return !!view.someProp("handleKeyDown", (f) => f(view, event));
}

export function setCursor(view: EditorView, pos: number): void {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
}

export function setRange(view: EditorView, from: number, to: number): void {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
}

/** Cursor at the end of the first or last textblock of the document. */
export function cursorAtEnd(view: EditorView, which: "first" | "last" = "last"): void {
  let target = -1;
  view.state.doc.descendants((node, pos) => {
    if (node.isTextblock && (which === "last" || target < 0)) target = pos + 1 + node.content.size;
  });
  setCursor(view, target);
}
