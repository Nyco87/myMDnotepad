import { describe, expect, test } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { parseMarkdown } from "./parse";
import { serializeMarkdown } from "./serialize";
import { schema } from "./schema";
import { setAlertKind } from "../editor/alerts";

const pretty = (md: string) => serializeMarkdown(parseMarkdown(md));

describe("GitHub alerts", () => {
  test("alert roundtrip", () => expect(pretty("> [!WARNING]\n> Attention ici.\n")).toBe("> [!WARNING]\n> Attention ici.\n"));
  test("parsed as an alert node", () => {
    const n = parseMarkdown("> [!WARNING]\n> Attention ici.\n").firstChild!;
    expect(n.type.name).toBe("alert");
    expect(n.attrs).toMatchObject({ kind: "warning", marker: "[!WARNING]", inline: false });
    expect(n.textContent).toBe("Attention ici.");
  });
  test("lowercase marker preserved", () => expect(pretty("> [!note]\n> x\n")).toBe("> [!note]\n> x\n"));
  test("lowercase marker is a note alert", () => expect(parseMarkdown("> [!note]\n> x\n").firstChild!.attrs.kind).toBe("note"));
  test("same-line text preserved", () => {
    expect(pretty("> [!TIP] astuce\n")).toBe("> [!TIP] astuce\n");
    const n = parseMarkdown("> [!TIP] astuce\n").firstChild!;
    expect(n.attrs.inline).toBe(true);
    expect(n.textContent).toBe("astuce");
  });
  test("same-line text with marks and following paragraph", () =>
    expect(pretty("> [!TIP] a **b** c\n>\n> second\n")).toBe("> [!TIP] a **b** c\n>\n> second\n"));
  test("unknown kind stays a quote, byte-identical", () => {
    expect(parseMarkdown("> [!FOO]\n> x\n").firstChild!.type.name).toBe("blockquote");
    expect(pretty("> [!FOO]\n> x\n")).toBe("> [!FOO]\n> x\n");
  });
  test("known marker glued to text is not an alert", () => {
    expect(parseMarkdown("> [!NOTE]x\n").firstChild!.type.name).toBe("blockquote");
    expect(pretty("> [!NOTE]x\n")).toBe("> \\[!NOTE\\]x\n");
  });
  test("empty alert", () => expect(pretty("> [!NOTE]\n")).toBe("> [!NOTE]\n"));
  test("alert in list", () =>
    expect(pretty("- item\n\n  > [!CAUTION]\n  > danger\n")).toBe("- item\n\n  > [!CAUTION]\n  > danger\n"));
  test("alert with list inside", () =>
    expect(pretty("> [!IMPORTANT]\n> - a\n> - b\n")).toBe("> [!IMPORTANT]\n> - a\n> - b\n"));
  test("alert with several paragraphs and a code block", () => {
    const md = "> [!NOTE]\n> un\n>\n> deux\n>\n> ```js\n> x\n> ```\n";
    expect(pretty(md)).toBe(md);
  });
  test("alert between other blocks", () => {
    const md = "avant\n\n> [!TIP]\n> mid\n\naprès\n";
    expect(pretty(md)).toBe(md);
  });
  test("plain quotes are untouched", () => expect(pretty("> citation\n> suite\n")).toBe("> citation\n> suite\n"));
  test("idempotent", () => {
    const once = pretty("> [!Warning] a\n> b\n>\n> c\n");
    expect(pretty(once)).toBe(once);
  });
  test("changing kind writes uppercase canonical marker", () => {
    const doc = parseMarkdown("> [!note]\n> x\n");
    let state = EditorState.create({ schema, doc });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3)));
    let next = state;
    expect(setAlertKind("caution")(state, (tr) => (next = state.apply(tr)))).toBe(true);
    expect(serializeMarkdown(next.doc)).toBe("> [!CAUTION]\n> x\n");
  });
});
