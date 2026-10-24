// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { makeEditor, typeInto, pressKey, cursorAtEnd, setCursor, setRange } from "./test-helpers";

describe("shortcuts", () => {
  const marks: [string, string, boolean][] = [
    ["b", "strong", false],
    ["i", "em", false],
    ["X", "strike", true],
    ["e", "code", false],
  ];
  for (const [key, mark, shift] of marks) {
    it(`toggle_${mark}`, () => {
      const ed = makeEditor("hello\n");
      setRange(ed.view, 1, 6);
      expect(pressKey(ed.view, key, { ctrl: true, shift })).toBe(true);
      expect(ed.view.state.doc.firstChild!.firstChild!.marks.map((m) => m.type.name)).toEqual([mark]);
      pressKey(ed.view, key, { ctrl: true, shift });
      expect(ed.view.state.doc.firstChild!.firstChild!.marks.length).toBe(0);
    });
  }

  it("ctrl_digits_set_heading_and_ctrl_0_paragraph", () => {
    const ed = makeEditor("hello\n");
    for (let l = 1; l <= 6; l++) {
      pressKey(ed.view, String(l), { ctrl: true });
      expect(ed.view.state.doc.firstChild!.type.name).toBe("heading");
      expect(ed.view.state.doc.firstChild!.attrs.level).toBe(l);
    }
    pressKey(ed.view, "0", { ctrl: true });
    expect(ed.view.state.doc.firstChild!.type.name).toBe("paragraph");
  });

  it("undo_redo", () => {
    const ed = makeEditor("");
    typeInto(ed.view, "abc");
    pressKey(ed.view, "z", { ctrl: true });
    expect(ed.view.state.doc.textContent).not.toBe("abc");
    pressKey(ed.view, "y", { ctrl: true });
    expect(ed.view.state.doc.textContent).toBe("abc");
    pressKey(ed.view, "z", { ctrl: true });
    expect(ed.view.state.doc.textContent).not.toBe("abc");
    pressKey(ed.view, "Z", { ctrl: true, shift: true });
    expect(ed.view.state.doc.textContent).toBe("abc");
  });

  it("ctrl_enter_toggles_task", () => {
    const ed = makeEditor("- [ ] a\n");
    cursorAtEnd(ed.view);
    pressKey(ed.view, "Enter", { ctrl: true });
    expect(ed.getMarkdown()).toContain("- [x] a");
    pressKey(ed.view, "Enter", { ctrl: true });
    expect(ed.getMarkdown()).toContain("- [ ] a");
  });
});

describe("sticky blocks", () => {
  it("enter_in_blockquote_stays", () => {
    const ed = makeEditor("> l1\n");
    cursorAtEnd(ed.view);
    expect(pressKey(ed.view, "Enter")).toBe(true);
    const bq = ed.view.state.doc.firstChild!;
    expect(ed.view.state.doc.childCount).toBe(1);
    expect(bq.type.name).toBe("blockquote");
    expect(bq.firstChild!.lastChild!.type.name).toBe("hard_break");
    expect(ed.view.state.selection.$from.node(-1).type.name).toBe("blockquote");
    typeInto(ed.view, "l2");
    expect(ed.getMarkdown().trim()).toBe("> l1\n> l2");
  });

  it("enter_in_code_block_stays", () => {
    const ed = makeEditor("```\nx\n```\n");
    cursorAtEnd(ed.view);
    pressKey(ed.view, "Enter");
    pressKey(ed.view, "Enter");
    pressKey(ed.view, "Enter");
    expect(ed.view.state.doc.childCount).toBe(1);
    expect(ed.view.state.doc.firstChild!.textContent).toBe("x\n\n\n");
  });

  it("arrow_down_leaves_block", () => {
    const ed = makeEditor("> q\n\nafter\n");
    cursorAtEnd(ed.view, "first");
    expect(pressKey(ed.view, "ArrowDown")).toBe(true);
    const $from = ed.view.state.selection.$from;
    expect($from.parent.type.name).toBe("paragraph");
    expect($from.parent.textContent).toBe("after");
    expect($from.depth).toBe(1);
  });

  it("arrow_down_not_on_last_line_is_left_alone", () => {
    const ed = makeEditor("```\na\nb\n```\n\nafter\n");
    setCursor(ed.view, 2);
    // jsdom has no layout: later key handlers (gapcursor) call endOfTextblock.
    ed.view.endOfTextblock = () => false;
    expect(pressKey(ed.view, "ArrowDown")).toBe(false);
    expect(ed.view.state.selection.$from.parent.type.name).toBe("code_block");
  });

  it("arrow_down_at_doc_end_creates_paragraph_after_blockquote", () => {
    const ed = makeEditor("> q\n");
    cursorAtEnd(ed.view);
    expect(pressKey(ed.view, "ArrowDown")).toBe(true);
    const doc = ed.view.state.doc;
    expect(doc.childCount).toBe(2);
    expect(doc.lastChild!.type.name).toBe("paragraph");
    expect(ed.view.state.selection.$from.parent).toBe(doc.lastChild);
  });

  it("arrow_down_at_doc_end_creates_paragraph_after_code_block", () => {
    const ed = makeEditor("```\ncode\n```\n");
    cursorAtEnd(ed.view);
    expect(pressKey(ed.view, "ArrowDown")).toBe(true);
    const doc = ed.view.state.doc;
    expect(doc.childCount).toBe(2);
    expect(doc.lastChild!.type.name).toBe("paragraph");
    expect(ed.view.state.selection.$from.parent).toBe(doc.lastChild);
  });

  it("enter_in_list_item_splits", () => {
    const ed = makeEditor("- a\n");
    cursorAtEnd(ed.view);
    pressKey(ed.view, "Enter");
    expect(ed.view.state.doc.firstChild!.childCount).toBe(2);
    typeInto(ed.view, "b");
    expect(ed.getMarkdown().trim()).toBe("- a\n- b");
  });

  it("enter_on_empty_list_item_exits_list", () => {
    const ed = makeEditor("- a\n");
    cursorAtEnd(ed.view);
    pressKey(ed.view, "Enter");
    pressKey(ed.view, "Enter");
    const doc = ed.view.state.doc;
    expect(doc.firstChild!.childCount).toBe(1);
    expect(doc.lastChild!.type.name).toBe("paragraph");
    expect(ed.view.state.selection.$from.parent).toBe(doc.lastChild);
  });

  it("enter_in_task_item_creates_unchecked_item", () => {
    const ed = makeEditor("- [x] a\n");
    cursorAtEnd(ed.view);
    pressKey(ed.view, "Enter");
    const list = ed.view.state.doc.firstChild!;
    expect(list.childCount).toBe(2);
    expect(list.child(1).attrs.checked).toBe(false);
  });
});

describe("exported commands", () => {
  it("factories_work_on_a_view", async () => {
    const { insertHorizontalRule, insertLink, wrapIn, insertCodeBlock } = await import("./keymap");
    const ed = makeEditor("hello\n");
    const run = (cmd: import("prosemirror-state").Command) => cmd(ed.view.state, ed.view.dispatch);
    setRange(ed.view, 1, 6);
    expect(run(insertLink("https://x.y"))).toBe(true);
    expect(ed.getMarkdown()).toContain("[hello](https://x.y)");
    expect(run(wrapIn("blockquote"))).toBe(true);
    expect(ed.view.state.doc.firstChild!.type.name).toBe("blockquote");
    const ed2 = makeEditor("hello\n");
    cursorAtEnd(ed2.view);
    expect(insertHorizontalRule()(ed2.view.state, ed2.view.dispatch)).toBe(true);
    expect(ed2.view.state.doc.child(1).type.name).toBe("horizontal_rule");
    expect(ed2.view.state.doc.lastChild!.type.name).toBe("paragraph");
    const ed3 = makeEditor("hello\n");
    expect(insertCodeBlock()(ed3.view.state, ed3.view.dispatch)).toBe(true);
    expect(ed3.view.state.doc.firstChild!.type.name).toBe("code_block");
  });

  it("enter_on_empty_task_item_exits_list", () => {
    const ed = makeEditor("- [ ] a\n");
    cursorAtEnd(ed.view);
    pressKey(ed.view, "Enter");
    pressKey(ed.view, "Enter");
    expect(ed.view.state.doc.lastChild!.type.name).toBe("paragraph");
    expect(ed.view.state.doc.firstChild!.childCount).toBe(1);
  });
});

describe("sticky blocks and wrapped lines", () => {
  it("arrow_down_on_wrapped_non_last_visual_line_does_not_leave", () => {
    const ed = makeEditor("> q\n\nafter\n");
    cursorAtEnd(ed.view, "first");
    ed.view.endOfTextblock = () => false;
    expect(pressKey(ed.view, "ArrowDown")).toBe(false);
    expect(ed.view.state.selection.$from.parent.textContent).toBe("q");
  });

  it("arrow_down_leaves_when_last_visual_line", () => {
    const ed = makeEditor("```\ncode\n```\n\nafter\n");
    cursorAtEnd(ed.view, "first");
    ed.view.endOfTextblock = () => true;
    expect(pressKey(ed.view, "ArrowDown")).toBe(true);
    expect(ed.view.state.selection.$from.parent.textContent).toBe("after");
  });

  it("stored_bold_survives_em_input_rule", () => {
    const ed = makeEditor("");
    pressKey(ed.view, "b", { ctrl: true });
    typeInto(ed.view, "*x*");
    const marks = ed.view.state.doc.firstChild!.firstChild!.marks.map((m) => m.type.name).sort();
    expect(marks).toEqual(["em", "strong"]);
  });
});
