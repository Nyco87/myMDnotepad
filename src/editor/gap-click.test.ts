// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { GapCursor } from "prosemirror-gapcursor";
import { gapPosAt, gapValid, type BlockBox } from "./gap-click";
import { makeEditor, pressKey } from "./test-helpers";

const boxes: BlockBox[] = [
  { before: 0, after: 10, top: 0, bottom: 100 },
  { before: 10, after: 30, top: 112, bottom: 200 },
  { before: 30, after: 40, top: 200, bottom: 230 },
];

describe("gapPosAt", () => {
  it("returns the position between two blocks for a click in their margin", () => {
    expect(gapPosAt(boxes, 105)).toBe(10);
  });
  it("is null inside a block, above all blocks, below all blocks and when blocks touch", () => {
    expect(gapPosAt(boxes, 50)).toBeNull();
    expect(gapPosAt(boxes, -5)).toBeNull();
    expect(gapPosAt(boxes, 300)).toBeNull();
    expect(gapPosAt(boxes, 200)).toBeNull();
  });
});

describe("gap cursor", () => {
  const md = "| a | b |\n| --- | --- |\n| 1 | 2 |\n\n> [!NOTE]\n> x\n";
  function gapBetweenTableAndAlert() {
    const ed = makeEditor(md);
    const at = ed.view.state.doc.child(0).nodeSize;
    const $pos = ed.view.state.doc.resolve(at);
    expect(gapValid($pos)).toBe(true);
    ed.view.dispatch(ed.view.state.tr.setSelection(new GapCursor($pos)));
    return { ed, at };
  }

  it("is valid between a table and an alert (alert counts as closed)", () => {
    const { ed } = gapBetweenTableAndAlert();
    expect(ed.view.state.selection instanceof GapCursor).toBe(true);
  });
  it("is valid between two code blocks", () => {
    const ed = makeEditor("```\na\n```\n\n```\nb\n```\n");
    expect(gapValid(ed.view.state.doc.resolve(ed.view.state.doc.child(0).nodeSize))).toBe(true);
  });
  it("Enter on a gap cursor creates a paragraph there, and the note keeps the extra blank line", () => {
    const { ed, at } = gapBetweenTableAndAlert();
    expect(pressKey(ed.view, "Enter")).toBe(true);
    const doc = ed.view.state.doc;
    expect(doc.child(1).type.name).toBe("paragraph");
    expect(doc.child(1).content.size).toBe(0);
    expect(ed.view.state.selection.from).toBe(at + 1);
    expect(ed.getMarkdown()).toBe("| a   | b   |\n| --- | --- |\n| 1   | 2   |\n\n\n> [!NOTE]\n> x\n");
  });
});
