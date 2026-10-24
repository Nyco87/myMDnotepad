// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { TextSelection } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
import { makeEditor, pressKey, setCursor } from "./test-helpers";
import { insertionAt, insertAtBoundary, addRowBeforeCmd, insertTable, setColumnAlign, deleteColumnCmd, deleteRowCmd, addRowAfterCmd } from "./tables";

const MD3 = "| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n";

function findTable(doc: PMNode): { node: PMNode; pos: number } | null {
  let found: { node: PMNode; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (node.type.name === "table") found = { node, pos };
    return !found;
  });
  return found;
}

/** Document position inside the cell at (row, col). */
function cellPos(doc: PMNode, row: number, col: number): number {
  const t = findTable(doc)!;
  let pos = t.pos + 1;
  for (let r = 0; r < row; r++) pos += t.node.child(r).nodeSize;
  pos += 1; // into row
  for (let c = 0; c < col; c++) pos += t.node.child(row).child(c).nodeSize;
  return pos + 2; // into cell, into paragraph
}

describe("tables", () => {
  it("insertTable_creates_header_row_and_cursor_in_first_cell", () => {
    const ed = makeEditor("");
    expect(insertTable(3, 3)(ed.view.state, ed.view.dispatch)).toBe(true);
    const t = findTable(ed.view.state.doc)!;
    expect(t.node.childCount).toBe(3);
    expect(t.node.child(0).childCount).toBe(3);
    t.node.child(0).forEach((c) => expect(c.type.name).toBe("table_header"));
    t.node.child(1).forEach((c) => expect(c.type.name).toBe("table_cell"));
    expect(ed.view.state.selection.from).toBe(cellPos(ed.view.state.doc, 0, 0));
  });

  it("tab_moves_to_next_cell", () => {
    const ed = makeEditor(MD3);
    setCursor(ed.view, cellPos(ed.view.state.doc, 0, 0));
    expect(pressKey(ed.view, "Tab")).toBe(true);
    expect(ed.view.state.selection.$from.parent.textContent).toBe("b");
  });

  it("tab_in_last_cell_adds_row", () => {
    const ed = makeEditor(MD3);
    expect(findTable(ed.view.state.doc)!.node.childCount).toBe(3);
    setCursor(ed.view, cellPos(ed.view.state.doc, 2, 1));
    expect(pressKey(ed.view, "Tab")).toBe(true);
    const doc = ed.view.state.doc;
    expect(findTable(doc)!.node.childCount).toBe(4);
    expect(ed.view.state.selection.from).toBe(cellPos(doc, 3, 0));
  });

  it("shift_tab_moves_back", () => {
    const ed = makeEditor(MD3);
    setCursor(ed.view, cellPos(ed.view.state.doc, 0, 1));
    expect(pressKey(ed.view, "Tab", { shift: true })).toBe(true);
    expect(ed.view.state.selection.$from.parent.textContent).toBe("a");
  });

  it("tab_outside_table_is_not_captured", () => {
    const ed = makeEditor("hello\n");
    setCursor(ed.view, 2);
    expect(pressKey(ed.view, "Tab")).toBe(false);
    expect(pressKey(ed.view, "Tab", { shift: true })).toBe(false);
  });

  it("set_column_align_right_serializes_separator", () => {
    const ed = makeEditor(MD3);
    setCursor(ed.view, cellPos(ed.view.state.doc, 1, 1));
    expect(setColumnAlign("right")(ed.view.state, ed.view.dispatch)).toBe(true);
    const sep = ed.getMarkdown().split("\n")[1];
    expect(sep.split("|")[2].trim().endsWith(":")).toBe(true);
    expect(sep.split("|")[2]).toMatch(/--:/);
    expect(sep.split("|")[1]).not.toMatch(/:/);
  });

  it("delete_last_remaining_column_removes_table", () => {
    const ed = makeEditor("| a |\n| --- |\n| 1 |\n\nafter\n");
    setCursor(ed.view, cellPos(ed.view.state.doc, 1, 0));
    expect(deleteColumnCmd(ed.view.state, ed.view.dispatch)).toBe(true);
    expect(findTable(ed.view.state.doc)).toBeNull();
    expect(ed.view.state.doc.textContent).toBe("after");
  });

  it("delete_column_keeps_table_when_others_remain", () => {
    const ed = makeEditor(MD3);
    setCursor(ed.view, cellPos(ed.view.state.doc, 1, 1));
    deleteColumnCmd(ed.view.state, ed.view.dispatch);
    expect(findTable(ed.view.state.doc)!.node.child(0).childCount).toBe(1);
  });

  it("delete_only_row_removes_table_and_add_row_works", () => {
    const ed = makeEditor(MD3);
    setCursor(ed.view, cellPos(ed.view.state.doc, 1, 0));
    expect(addRowAfterCmd(ed.view.state, ed.view.dispatch)).toBe(true);
    expect(findTable(ed.view.state.doc)!.node.childCount).toBe(4);
    expect(deleteRowCmd(ed.view.state, ed.view.dispatch)).toBe(true);
    expect(findTable(ed.view.state.doc)!.node.childCount).toBe(3);
  });

  it("commands_are_false_outside_table", () => {
    const ed = makeEditor("hello\n");
    setCursor(ed.view, 2);
    expect(deleteColumnCmd(ed.view.state)).toBe(false);
    expect(TextSelection).toBeDefined();
  });

  const checkHeaderInvariant = (ed: ReturnType<typeof makeEditor>, texts: string[]) => {
    const t = findTable(ed.view.state.doc)!.node;
    t.child(0).forEach((c) => expect(c.type.name).toBe("table_header"));
    for (let r = 1; r < t.childCount; r++) t.child(r).forEach((c) => expect(c.type.name).toBe("table_cell"));
    const md = ed.getMarkdown();
    for (const x of texts) expect(md).toContain(x);
    expect(md.split("\n")[1]).toMatch(/^\|?\s*:?-+:?\s*\|/);
    const again = makeEditor(md);
    expect(again.getMarkdown()).toBe(md);
  };

  it("insert_row_above_header_keeps_valid_gfm_table", () => {
    const ed = makeEditor(MD3);
    setCursor(ed.view, cellPos(ed.view.state.doc, 0, 0));
    expect(addRowBeforeCmd(ed.view.state, ed.view.dispatch)).toBe(true);
    expect(findTable(ed.view.state.doc)!.node.childCount).toBe(4);
    checkHeaderInvariant(ed, ["a", "b", "1", "2", "3", "4"]);
  });

  it("delete_header_row_keeps_valid_gfm_table", () => {
    const ed = makeEditor(MD3);
    setCursor(ed.view, cellPos(ed.view.state.doc, 0, 0));
    expect(deleteRowCmd(ed.view.state, ed.view.dispatch)).toBe(true);
    expect(findTable(ed.view.state.doc)!.node.childCount).toBe(2);
    checkHeaderInvariant(ed, ["1", "2", "3", "4"]);
  });
});

describe("table boundary insertion", () => {
  it("insertionAt_maps_boundaries_to_before_after", () => {
    expect(insertionAt(0, 3)).toEqual({ index: 0, where: "before" });
    expect(insertionAt(1, 3)).toEqual({ index: 1, where: "before" });
    expect(insertionAt(2, 3)).toEqual({ index: 2, where: "before" });
    expect(insertionAt(3, 3)).toEqual({ index: 2, where: "after" });
  });

  const text = (doc: PMNode, row: number): string[] => {
    const out: string[] = [];
    findTable(doc)!.node.child(row).forEach((c) => out.push(c.textContent));
    return out;
  };

  it("insert_row_at_boundary_0_keeps_header_invariant", () => {
    const ed = makeEditor(MD3);
    const t = findTable(ed.view.state.doc)!;
    expect(insertAtBoundary(ed.view, t.pos, "row", 0)).toBe(true);
    const n = findTable(ed.view.state.doc)!.node;
    expect(n.childCount).toBe(4);
    n.child(0).forEach((c) => expect(c.type.name).toBe("table_header"));
    for (let r = 1; r < 4; r++) n.child(r).forEach((c) => expect(c.type.name).toBe("table_cell"));
    expect(text(ed.view.state.doc, 1)).toEqual(["a", "b"]);
  });

  it("insert_row_in_middle_and_at_end", () => {
    const ed = makeEditor(MD3);
    insertAtBoundary(ed.view, findTable(ed.view.state.doc)!.pos, "row", 2);
    expect(text(ed.view.state.doc, 1)).toEqual(["1", "2"]);
    expect(text(ed.view.state.doc, 2)).toEqual(["", ""]);
    expect(text(ed.view.state.doc, 3)).toEqual(["3", "4"]);
    insertAtBoundary(ed.view, findTable(ed.view.state.doc)!.pos, "row", 4);
    expect(findTable(ed.view.state.doc)!.node.childCount).toBe(5);
    expect(text(ed.view.state.doc, 4)).toEqual(["", ""]);
  });

  it("insert_column_at_boundaries", () => {
    const ed = makeEditor(MD3);
    insertAtBoundary(ed.view, findTable(ed.view.state.doc)!.pos, "col", 0);
    expect(text(ed.view.state.doc, 1)).toEqual(["", "1", "2"]);
    insertAtBoundary(ed.view, findTable(ed.view.state.doc)!.pos, "col", 3);
    expect(text(ed.view.state.doc, 1)).toEqual(["", "1", "2", ""]);
    insertAtBoundary(ed.view, findTable(ed.view.state.doc)!.pos, "col", 2);
    expect(text(ed.view.state.doc, 0)).toEqual(["", "a", "", "b", ""]);
  });
});
