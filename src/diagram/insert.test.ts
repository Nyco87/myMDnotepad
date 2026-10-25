// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { undo } from "prosemirror-history";

vi.mock("./render", () => ({
  renderMermaid: vi.fn(async () => ({ ok: true, svg: "<svg></svg>" })),
  diagramAccent: () => "#60cdff",
}));

import { createDiagram, editDiagramAt, insertDiagramCode, replaceDiagramCode } from "./insert";
import { makeEditor, setCursor } from "../editor/test-helpers";

const PIE = 'pie\n    "a" : 1\n';
const BLOCK = (code: string) => "```mermaid\n" + code + "```\n";

describe("inserting a diagram", () => {
  it("goes after the current block and leaves a paragraph to keep writing", () => {
    const ed = makeEditor("texte\n");
    setCursor(ed.view, 2);
    insertDiagramCode(ed.view, PIE);
    expect(ed.getMarkdown()).toBe("texte\n\n" + BLOCK(PIE));
    const doc = ed.view.state.doc;
    expect(doc.lastChild!.type.name).toBe("paragraph");
    expect(ed.view.state.selection.$from.parent).toBe(doc.lastChild);
  });

  it("replaces an empty paragraph", () => {
    const ed = makeEditor("a\n\n\n\nb\n"); // a, empty, empty, b
    setCursor(ed.view, 4);
    insertDiagramCode(ed.view, PIE);
    const names: string[] = [];
    ed.view.state.doc.forEach((n) => names.push(n.type.name));
    expect(names).toEqual(["paragraph", "code_block", "paragraph", "paragraph"]);
    expect(ed.view.state.doc.child(1).attrs.language).toBe("mermaid");
    expect(ed.view.state.doc.child(1).textContent).toBe('pie\n    "a" : 1');
  });

  it("inside a list item it goes after the list item's block, not inside text", () => {
    const ed = makeEditor("- a\n- b\n");
    setCursor(ed.view, 3);
    insertDiagramCode(ed.view, PIE);
    let found = false;
    ed.view.state.doc.descendants((n) => {
      if (n.type.name === "code_block") found = true;
    });
    expect(found).toBe(true);
    expect(ed.getMarkdown()).toContain("```mermaid");
  });

  it("createDiagram inserts what the workshop returns, and nothing on cancel", async () => {
    const ed = makeEditor("x\n");
    setCursor(ed.view, 2);
    await createDiagram(ed.view, vi.fn(), async () => null);
    expect(ed.getMarkdown()).toBe("x\n");
    await createDiagram(ed.view, vi.fn(), async () => PIE);
    expect(ed.getMarkdown()).toBe("x\n\n" + BLOCK(PIE));
  });
});

describe("editing a diagram", () => {
  const md = "avant\n\n" + BLOCK(PIE) + "\naprès\n";

  it("replaces the code in one undoable transaction", async () => {
    const ed = makeEditor(md);
    const pos = 7; // after "avant" (paragraph size 7)
    expect(ed.view.state.doc.nodeAt(pos)!.type.name).toBe("code_block");
    const open = vi.fn(async () => 'pie\n    "b" : 2\n');
    await editDiagramAt(ed.view, pos, 'pie\n    "a" : 1', vi.fn(), open);
    expect(open).toHaveBeenCalledWith({ code: 'pie\n    "a" : 1' });
    expect(ed.getMarkdown()).toBe("avant\n\n" + BLOCK('pie\n    "b" : 2\n') + "\naprès\n");
    undo(ed.view.state, ed.view.dispatch);
    expect(ed.getMarkdown()).toBe(md);
  });

  it("leaves the note alone when the workshop is cancelled or the code is unchanged", async () => {
    const ed = makeEditor(md);
    await editDiagramAt(ed.view, 7, 'pie\n    "a" : 1', vi.fn(), async () => null);
    await editDiagramAt(ed.view, 7, 'pie\n    "a" : 1', vi.fn(), async () => 'pie\n    "a" : 1');
    expect(ed.getMarkdown()).toBe(md);
    expect(ed.isDirty()).toBe(false);
  });

  it("finds the diagram again when the document moved while the workshop was open", async () => {
    const ed = makeEditor(md);
    const open = async (): Promise<string> => {
      ed.view.dispatch(ed.view.state.tr.insertText("Z", 1)); // shifts every position
      return 'pie\n    "c" : 3\n';
    };
    await editDiagramAt(ed.view, 7, 'pie\n    "a" : 1', vi.fn(), open);
    expect(ed.getMarkdown()).toContain('"c" : 3');
  });

  it("tells the user when the diagram is gone", async () => {
    const ed = makeEditor(md);
    const notify = vi.fn();
    const open = async (): Promise<string> => {
      ed.view.dispatch(ed.view.state.tr.delete(7, 7 + ed.view.state.doc.nodeAt(7)!.nodeSize));
      return 'pie\n    "c" : 3\n';
    };
    await editDiagramAt(ed.view, 7, 'pie\n    "a" : 1', notify, open);
    expect(notify).toHaveBeenCalled();
    expect(ed.getMarkdown()).not.toContain("mermaid");
  });

  it("replaceDiagramCode refuses a node that is not a diagram", () => {
    const ed = makeEditor("```ts\nx\n```\n");
    expect(replaceDiagramCode(ed.view, 0, "pie\n")).toBe(false);
  });
});
