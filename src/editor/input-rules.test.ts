// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { makeEditor, typeInto, pressKey, setCursor } from "./test-helpers";

function typed(text: string, md = "") {
  const ed = makeEditor(md);
  typeInto(ed.view, text);
  return ed;
}

describe("block input rules", () => {
  for (let level = 1; level <= 6; level++) {
    it(`heading_${level}`, () => {
      const ed = typed("#".repeat(level) + " ");
      const h = ed.view.state.doc.firstChild!;
      expect(h.type.name).toBe("heading");
      expect(h.attrs.level).toBe(level);
    });
  }

  it("blockquote", () => {
    expect(typed("> ").view.state.doc.firstChild!.type.name).toBe("blockquote");
  });

  it("bullet_list_dash_and_star", () => {
    expect(typed("- ").view.state.doc.firstChild!.type.name).toBe("bullet_list");
    expect(typed("* ").view.state.doc.firstChild!.type.name).toBe("bullet_list");
  });

  it("ordered_list", () => {
    const list = typed("1. ").view.state.doc.firstChild!;
    expect(list.type.name).toBe("ordered_list");
    expect(list.attrs.start).toBe(1);
  });

  it("task_marker_in_list_item_converts_to_task_item", () => {
    const list = typed("- [ ] ").view.state.doc.firstChild!;
    expect(list.type.name).toBe("task_list");
    expect(list.firstChild!.type.name).toBe("task_item");
    expect(list.firstChild!.attrs.checked).toBe(false);
  });

  it("task_marker_one_shot_in_empty_paragraph", () => {
    const { view } = makeEditor("");
    const handled = view.someProp("handleTextInput", (f) => f(view, 1, 1, "- [ ] ", () => view.state.tr));
    expect(handled).toBe(true);
    expect(view.state.doc.firstChild!.type.name).toBe("task_list");
  });

  it("task_marker_converts_only_that_item_of_a_longer_list", () => {
    const ed = makeEditor("- a\n- b\n- c\n");
    const { view } = ed;
    let pos = -1;
    view.state.doc.descendants((n, p) => {
      if (n.isText && n.text === "b") pos = p;
    });
    setCursor(view, pos);
    typeInto(view, "[ ] ");
    expect(view.state.doc.childCount).toBe(3);
    expect(view.state.doc.child(0).type.name).toBe("bullet_list");
    expect(view.state.doc.child(1).type.name).toBe("task_list");
    expect(view.state.doc.child(2).type.name).toBe("bullet_list");
    expect(ed.getMarkdown()).toContain("[ ] b");
  });

  it("code_fence_plus_enter", () => {
    const ed = typed("```js");
    expect(pressKey(ed.view, "Enter")).toBe(true);
    const cb = ed.view.state.doc.firstChild!;
    expect(cb.type.name).toBe("code_block");
    expect(cb.attrs.language).toBe("js");
  });

  it("hr_plus_enter", () => {
    const ed = typed("---");
    expect(pressKey(ed.view, "Enter")).toBe(true);
    expect(ed.view.state.doc.firstChild!.type.name).toBe("horizontal_rule");
    expect(ed.view.state.doc.lastChild!.type.name).toBe("paragraph");
    expect(ed.view.state.selection.$from.parent.type.name).toBe("paragraph");
  });

  it("backspace_undoes_input_rule", () => {
    const ed = typed("## ");
    expect(ed.view.state.doc.firstChild!.type.name).toBe("heading");
    pressKey(ed.view, "Backspace");
    expect(ed.view.state.doc.firstChild!.type.name).toBe("paragraph");
    expect(ed.view.state.doc.firstChild!.textContent).toBe("## ");
  });

  it("no_rule_inside_code_block", () => {
    const ed = makeEditor("```\nx\n```\n");
    setCursor(ed.view, 2);
    typeInto(ed.view, "# ");
    expect(ed.view.state.doc.firstChild!.type.name).toBe("code_block");
  });
});

describe("mark input rules", () => {
  const cases: [string, string, string][] = [
    ["**gras**", "strong", "gras"],
    ["*i*", "em", "i"],
    ["~~s~~", "strike", "s"],
    ["`c`", "code", "c"],
  ];
  for (const [input, mark, text] of cases) {
    it(`mark_${mark}`, () => {
      const p = typed(input).view.state.doc.firstChild!;
      expect(p.textContent).toBe(text);
      expect(p.firstChild!.marks.map((m) => m.type.name)).toEqual([mark]);
    });
  }

  it("text_typed_after_mark_is_not_marked", () => {
    const p = typed("**gras** x").view.state.doc.firstChild!;
    expect(p.textContent).toBe("gras x");
    expect(p.lastChild!.marks.length).toBe(0);
  });

  it("keeps_text_before_the_marker", () => {
    const p = typed("a **b**").view.state.doc.firstChild!;
    expect(p.textContent).toBe("a b");
    expect(p.child(0).text).toBe("a ");
    expect(p.child(1).marks[0].type.name).toBe("strong");
  });
});
