// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { TextSelection } from "prosemirror-state";
import { createEditor } from "./editor";

describe("editor", () => {
  it("opening_a_note_never_writes", () => {
    const onChange = vi.fn();
    const mount = document.createElement("div");
    const ed = createEditor(mount, { markdown: "Titre\n===\n", onChange, noteRel: "a.md" });
    expect(onChange).not.toHaveBeenCalled();
    expect(ed.isDirty()).toBe(false);
    ed.setMarkdown("Autre\n===\n");
    expect(onChange).not.toHaveBeenCalled();
    expect(ed.isDirty()).toBe(false);
    ed.destroy();
  });

  it("click_below_content_moves_cursor_to_end", () => {
    const mount = document.createElement("div");
    mount.className = "editor-pane";
    document.body.appendChild(mount);
    const ed = createEditor(mount, { markdown: "un\n\ndeux\n", onChange: () => {}, noteRel: "a.md" });
    ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.create(ed.view.state.doc, 1)));
    mount.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(ed.view.state.selection.from).toBe(ed.view.state.doc.content.size - 1);
    expect(ed.view.hasFocus()).toBe(true);
    // Un clic dans le texte n'est pas détourné.
    ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.create(ed.view.state.doc, 1)));
    ed.view.dom.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(ed.view.state.selection.from).toBe(1);
    ed.destroy();
    mount.remove();
  });

  it("user_edit_calls_onChange_and_dirties", () => {
    const onChange = vi.fn();
    const mount = document.createElement("div");
    const ed = createEditor(mount, { markdown: "hello\n", onChange, noteRel: "a.md" });
    ed.view.dispatch(ed.view.state.tr.insertText("X", 1));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toContain("Xhello");
    expect(ed.isDirty()).toBe(true);
    ed.destroy();
  });
});
