// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
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
