import { describe, expect, test } from "vitest";
import { parseMarkdown } from "./parse";
import { serializeMarkdown } from "./serialize";
import { formatTable, visualWidth } from "./table-format";

const pretty = (md: string) => serializeMarkdown(parseMarkdown(md));

describe("formatTable (brief)", () => {
  test("aligned table", () =>
    expect(formatTable([["Quoi", "Statut"], ["Arborescence", "à faire"]], [null, null])).toBe(
      "| Quoi         | Statut  |\n| ------------ | ------- |\n| Arborescence | à faire |",
    ));
  test("alignment markers", () =>
    expect(formatTable([["a", "b", "c"]], ["left", "center", "right"]).split("\n")[1]).toBe("| :-- | :-: | --: |"));
  test("emoji counts as width 2", () => expect(formatTable([["✅"], ["ab"]], [null]).split("\n")[0]).toBe("| ✅  |"));
  test("table roundtrip via pretty", () =>
    expect(pretty("|a|b|\n|-|-|\n|1|22|\n")).toBe("| a   | b   |\n| --- | --- |\n| 1   | 22  |\n"));
});

describe("formatTable — extra", () => {
  test("pipes in cells are escaped", () => expect(formatTable([["a|b"]], [null])).toBe("| a\\|b |\n| ---- |"));
  test("short rows are padded with empty cells", () =>
    expect(formatTable([["a", "b"], ["1"]], [null, null])).toBe("| a   | b   |\n| --- | --- |\n| 1   |     |"));
  test("alignment markers grow with the column", () =>
    expect(formatTable([["abcde", "abcde", "abcde"]], ["left", "center", "right"]).split("\n")[1]).toBe(
      "| :---- | :---: | ----: |",
    ));
});

describe("visualWidth", () => {
  test("ascii and accents", () => expect(visualWidth("à faire")).toBe(7));
  test("combining mark is zero width", () => expect(visualWidth("é")).toBe(1));
  test("emoji presentation is 2", () => expect(visualWidth("✅")).toBe(2));
  test("variation selector makes a text pictograph wide, not wider", () => expect(visualWidth("❤️")).toBe(2));
  test("East Asian wide", () => expect(visualWidth("漢字")).toBe(4));
  test("ZWJ sequence counts once", () => expect(visualWidth("👨‍👩‍👧")).toBe(2));
  test("flag counts once", () => expect(visualWidth("🇫🇷")).toBe(2));
});

describe("tables in documents", () => {
  test("alignment survives a roundtrip", () => {
    const md = "| g   |  c  |   d |\n| :-- | :-: | --: |\n| 1   |  2  |   3 |\n";
    const once = pretty(md);
    expect(pretty(once)).toBe(once);
    const header = parseMarkdown(md).firstChild!.firstChild!;
    expect([0, 1, 2].map((i) => header.child(i).attrs.align)).toEqual(["left", "center", "right"]);
  });
  test("table nodes", () => {
    const table = parseMarkdown("| a | b |\n| - | - |\n| 1 | 2 |\n").firstChild!;
    expect(table.type.name).toBe("table");
    expect(table.child(0).child(0).type.name).toBe("table_header");
    expect(table.child(1).child(0).type.name).toBe("table_cell");
    expect(table.child(1).child(1).textContent).toBe("2");
  });
  test("inline formatting and escaped pipes in cells", () => {
    const md = "| a     | b      |\n| ----- | ------ |\n| **x** | `p\\|q` |\n";
    expect(pretty(md)).toBe(md);
    expect(parseMarkdown(md).firstChild!.child(1).child(1).textContent).toBe("p|q");
  });
  test("header-only table", () => expect(pretty("| a |\n|---|\n")).toBe("| a   |\n| --- |\n"));
  test("table between paragraphs", () =>
    expect(pretty("avant\n\n| a |\n|---|\n| é |\n\naprès\n")).toBe("avant\n\n| a   |\n| --- |\n| é   |\n\naprès\n"));
});
