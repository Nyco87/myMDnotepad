// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const showContextMenu = vi.fn();
vi.mock("../ui/context-menu", () => ({ showContextMenu: (...a: unknown[]) => showContextMenu(...a) }));

import { createEditor, type EditorHandle } from "./editor";
import { insertAlert } from "./alerts";
import { pressKey, setCursor, cursorAtEnd } from "./test-helpers";

let made: EditorHandle[] = [];
function mk(md: string): EditorHandle {
  const mount = document.createElement("div");
  const ed = createEditor(mount, { markdown: md, onChange: () => {}, noteRel: "a.md" });
  made.push(ed);
  return ed;
}
afterEach(() => {
  made.forEach((e) => e.destroy());
  made = [];
  document.body.innerHTML = "";
  showContextMenu.mockClear();
});

describe("alert editing", () => {
  it("insertAlert in an empty paragraph creates an empty alert holding the cursor", () => {
    const ed = mk("\n");
    expect(insertAlert("note")(ed.view.state, ed.view.dispatch)).toBe(true);
    const alert = ed.view.state.doc.firstChild!;
    expect(alert.type.name).toBe("alert");
    expect(alert.attrs.kind).toBe("note");
    expect(alert.textContent).toBe("");
    const $from = ed.view.state.selection.$from;
    expect($from.node($from.depth - 1).type.name).toBe("alert");
    expect(ed.getMarkdown()).toBe("> [!NOTE]\n");
  });

  it("insertAlert on text wraps it", () => {
    const ed = mk("bonjour\n");
    setCursor(ed.view, 3);
    insertAlert("tip")(ed.view.state, ed.view.dispatch);
    expect(ed.getMarkdown()).toBe("> [!TIP]\n> bonjour\n");
  });

  it("insertAlert inside an alert changes its kind instead of nesting", () => {
    const ed = mk("> [!WARNING]\n> x\n");
    setCursor(ed.view, 3);
    insertAlert("caution")(ed.view.state, ed.view.dispatch);
    expect(ed.getMarkdown()).toBe("> [!CAUTION]\n> x\n");
  });

  it("Enter stays in the alert", () => {
    const ed = mk("> [!NOTE]\n> ab\n");
    setCursor(ed.view, 3);
    expect(pressKey(ed.view, "Enter")).toBe(true);
    expect(ed.view.state.doc.childCount).toBe(1);
    expect(ed.view.state.doc.firstChild!.type.name).toBe("alert");
    expect(ed.view.state.doc.firstChild!.firstChild!.childCount).toBeGreaterThan(1); // a hard_break was inserted
  });

  it("ArrowDown on the last line leaves the alert", () => {
    const ed = mk("> [!NOTE]\n> ab\n\nsuite\n");
    setCursor(ed.view, 3);
    expect(pressKey(ed.view, "ArrowDown")).toBe(true);
    const $from = ed.view.state.selection.$from;
    expect($from.parent.textContent).toBe("suite");
  });

  it("ArrowDown on the last line of a final alert creates a paragraph", () => {
    const ed = mk("> [!NOTE]\n> ab\n");
    cursorAtEnd(ed.view, "last");
    expect(pressKey(ed.view, "ArrowDown")).toBe(true);
    expect(ed.view.state.doc.childCount).toBe(2);
    expect(ed.view.state.doc.lastChild!.type.name).toBe("paragraph");
    expect(ed.view.state.selection.$from.parent).toBe(ed.view.state.doc.lastChild);
  });

  it("renders a header and clicking it opens the kind menu", () => {
    const ed = mk("> [!WARNING]\n> ab\n");
    const title = ed.view.dom.querySelector(".alert-title") as HTMLElement;
    expect(title).not.toBeNull();
    expect(title.textContent).toContain("Attention");
    title.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(showContextMenu).toHaveBeenCalledTimes(1);
    const items = showContextMenu.mock.calls[0][2] as { label: string; action: () => void }[];
    expect(items.map((i) => i.label)).toEqual(["Note", "Astuce", "Important", "Attention", "Danger"]);
    items[4].action();
    expect(ed.getMarkdown()).toBe("> [!CAUTION]\n> ab\n");
    expect(ed.view.dom.querySelector(".alert-title")!.textContent).toContain("Danger");
  });
});

describe("alert paste (parseDOM)", () => {
  it("unknown_kind_becomes_blockquote_known_kind_stays_alert", async () => {
    const { DOMParser: PMParser } = await import("prosemirror-model");
    const { schema } = await import("../markdown/schema");
    const parse = (html: string) => {
      const d = document.createElement("div");
      d.innerHTML = html;
      return PMParser.fromSchema(schema).parse(d);
    };
    expect(parse('<div data-alert="bogus"><p>x</p></div>').firstChild!.type.name).toBe("blockquote");
    const ok = parse('<div data-alert="TIP"><p>x</p></div>').firstChild!;
    expect(ok.type.name).toBe("alert");
    expect(ok.attrs.kind).toBe("tip");
  });
});
