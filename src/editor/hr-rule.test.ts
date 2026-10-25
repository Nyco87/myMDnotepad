// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { makeEditor, typeInto, pressKey, cursorAtEnd } from "./test-helpers";

describe("horizontal rule on Enter", () => {
  for (const marker of ["---", "***", "___"]) {
    it(`typing_${marker}_then_enter_creates_rule`, () => {
      const ed = makeEditor("");
      typeInto(ed.view, marker);
      expect(pressKey(ed.view, "Enter")).toBe(true);
      const names: string[] = [];
      ed.view.state.doc.forEach((n) => names.push(n.type.name));
      expect(names).toEqual(["horizontal_rule", "paragraph"]);
      expect(ed.view.state.selection.$from.parent.type.name).toBe("paragraph");
      expect(ed.view.state.selection.$from.pos).toBe(2);
    });
  }

  it("rule_after_existing_text", () => {
    const ed = makeEditor("hello\n");
    cursorAtEnd(ed.view);
    pressKey(ed.view, "Enter");
    typeInto(ed.view, "---");
    pressKey(ed.view, "Enter");
    const names: string[] = [];
    ed.view.state.doc.forEach((n) => names.push(n.type.name));
    expect(names).toEqual(["paragraph", "horizontal_rule", "paragraph"]);
  });

  it("not_in_code_block", () => {
    const ed = makeEditor("```\n\n```\n");
    cursorAtEnd(ed.view);
    typeInto(ed.view, "---");
    pressKey(ed.view, "Enter");
    expect(ed.view.state.doc.firstChild!.type.name).toBe("code_block");
    expect(ed.view.state.doc.firstChild!.textContent).toBe("---\n");
  });

  it("not_in_table_cell", () => {
    const ed = makeEditor("| a | b |\n| --- | --- |\n| 1 | 2 |\n");
    let pos = -1;
    ed.view.state.doc.descendants((n, p) => {
      if (pos < 0 && n.type.name === "table_cell") pos = p + 2;
    });
    ed.view.dispatch(ed.view.state.tr.setSelection(
      (ed.view.state.selection.constructor as any).near(ed.view.state.doc.resolve(pos + 1)),
    ));
    typeInto(ed.view, "---");
    pressKey(ed.view, "Enter");
    let hr = false;
    ed.view.state.doc.descendants((n) => { if (n.type.name === "horizontal_rule") hr = true; });
    expect(hr).toBe(false);
  });
});
