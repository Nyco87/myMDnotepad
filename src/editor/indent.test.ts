// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { makeEditor, pressKey, setCursor } from "./test-helpers";
import { parseMarkdown } from "../markdown/parse";
import { serializeMarkdown } from "../markdown/serialize";

/** Cursor inside the text of the n-th textblock whose text equals `text`. */
function cursorIn(ed: ReturnType<typeof makeEditor>, text: string): void {
  let pos = -1;
  ed.view.state.doc.descendants((n, p) => {
    if (pos < 0 && n.isTextblock && n.textContent === text) pos = p + 1;
  });
  setCursor(ed.view, pos);
}

describe("list indentation", () => {
  it("tab_sinks_a_bullet_item_and_shift_tab_lifts_it_back", () => {
    const ed = makeEditor("- a\n- b\n");
    cursorIn(ed, "b");
    expect(pressKey(ed.view, "Tab")).toBe(true);
    expect(ed.getMarkdown()).toBe("- a\n  - b\n");
    expect(pressKey(ed.view, "Tab", { shift: true })).toBe(true);
    expect(ed.getMarkdown()).toBe("- a\n- b\n");
  });

  it("tab_sinks_task_items_too", () => {
    const ed = makeEditor("- [ ] a\n- [x] b\n");
    cursorIn(ed, "b");
    expect(pressKey(ed.view, "Tab")).toBe(true);
    expect(ed.getMarkdown()).toBe("- [ ] a\n  - [x] b\n");
    pressKey(ed.view, "Tab", { shift: true });
    expect(ed.getMarkdown()).toBe("- [ ] a\n- [x] b\n");
  });

  it("tab_on_the_first_item_is_swallowed_without_change", () => {
    const ed = makeEditor("- a\n- b\n");
    cursorIn(ed, "a");
    expect(pressKey(ed.view, "Tab")).toBe(true);
    expect(ed.getMarkdown()).toBe("- a\n- b\n");
  });

  it("tab_outside_lists_and_tables_is_not_captured", () => {
    const ed = makeEditor("hello\n");
    setCursor(ed.view, 2);
    expect(pressKey(ed.view, "Tab")).toBe(false);
    expect(pressKey(ed.view, "Tab", { shift: true })).toBe(false);
  });

  it("table_cells_keep_their_tab_behaviour", () => {
    const ed = makeEditor("| a | b |\n| --- | --- |\n| 1 | 2 |\n");
    cursorIn(ed, "a");
    expect(pressKey(ed.view, "Tab")).toBe(true);
    expect(ed.view.state.selection.$from.parent.textContent).toBe("b");
  });

  it("nested_lists_and_tasks_roundtrip_idempotently", () => {
    for (const md of ["- a\n  - b\n    - c\n- d\n", "- [ ] a\n  - [x] b\n    - [ ] c\n- [ ] d\n", "1. a\n   1. b\n1. c\n"]) {
      const once = serializeMarkdown(parseMarkdown(md));
      expect(once).toBe(md);
      expect(serializeMarkdown(parseMarkdown(once))).toBe(once);
    }
  });
});
