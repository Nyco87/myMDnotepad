import { describe, expect, test } from "vitest";
import type { Node } from "prosemirror-model";
import { parseMarkdown } from "./parse";
import { serializeMarkdown } from "./serialize";
import { schema } from "./schema";

const pretty = (md: string) => serializeMarkdown(parseMarkdown(md));

// Normal markdown around the raw part: it must be normalised…
const BEFORE = "Titre\n=====\n\nUn __gras__ ici.\n\n";
const BEFORE_PRETTY = "# Titre\n\nUn **gras** ici.\n\n";
const AFTER = "\n\n* fin\n";
const AFTER_PRETTY = "\n\n- fin\n";

/** …while the raw part comes out byte for byte. */
function verbatim(raw: string) {
  const out = pretty(BEFORE + raw + AFTER);
  expect(out).toBe(BEFORE_PRETTY + raw + AFTER_PRETTY);
  expect(pretty(out)).toBe(out);
}

function names(doc: Node): string[] {
  const out: string[] = [];
  doc.descendants((n) => {
    out.push(n.type.name);
  });
  return out;
}

const RAW_CASES: Record<string, string> = {
  "HTML block": "<details>\n<summary>s</summary>\n\nx\n</details>",
  "reference link and its definition": "voir [doc][1]\n\n[1]: https://a.b",
  footnote: "texte[^1]\n\n[^1]: note",
  "math block": "$$\na^2\n$$",
  "inline math": "Soit $x$ et _y_.",
};

describe("raw markdown is kept verbatim (brief)", () => {
  test("front matter at the very start", () => {
    const md = "---\ntitle: x\n---\n\nTitre\n=====\n\n* a\n";
    expect(pretty(md)).toBe("---\ntitle: x\n---\n\n# Titre\n\n- a\n");
    expect(parseMarkdown(md).firstChild!.type.name).toBe("raw_block");
  });
  test("front matter after a UTF-8 BOM (BOM dropped)", () => {
    const md = "﻿---\ntitle: x\n---\n\ntext\n";
    expect(pretty(md)).toBe("---\ntitle: x\n---\n\ntext\n");
    expect(parseMarkdown(md).firstChild!.type.name).toBe("raw_block");
  });
  for (const [name, raw] of Object.entries(RAW_CASES)) test(name, () => verbatim(raw));
  test("inline HTML becomes raw_inline", () => {
    const md = "a <kbd>Ctrl</kbd> __b__\n";
    expect(pretty(md)).toBe("a <kbd>Ctrl</kbd> **b**\n");
    const para = parseMarkdown(md).firstChild!;
    const raws: string[] = [];
    para.forEach((n) => {
      if (n.type.name === "raw_inline") raws.push(n.attrs.source);
    });
    expect(raws).toEqual(["<kbd>", "</kbd>"]);
  });
  test("idempotent on everything at once", () => {
    const md = "---\ntitle: x\n---\n\n" + BEFORE + Object.values(RAW_CASES).join("\n\n") + "\n\na <kbd>Ctrl</kbd> b" + AFTER;
    const once = pretty(md);
    expect(pretty(once)).toBe(once);
    for (const raw of Object.values(RAW_CASES)) expect(once).toContain(raw);
    expect(once.startsWith("---\ntitle: x\n---\n\n# Titre\n")).toBe(true);
  });
});

describe("reference definitions (ruling R7)", () => {
  test("unused definition is kept", () => expect(pretty("[x]: /unused\n\ntext\n")).toBe("[x]: /unused\n\ntext\n"));
  test("used definition and its paragraph are kept", () =>
    expect(pretty("voir [doc][1]\n\n[1]: https://a.b\n")).toBe("voir [doc][1]\n\n[1]: https://a.b\n"));
  // Review fix: every definition markdown-it accepts is kept, wherever it is.
  for (const md of ["- [a]: /u\n- b\n", "> - [a]: /u\n", "[a]:\n/url\n\ntext\n", "   [a]: /u\n\ntext\n", "> [a]: /u\n> [b]: /v\n"])
    test(`definition kept byte for byte ${JSON.stringify(md)}`, () => expect(pretty(md)).toBe(md));
  test("multi-line definition that is used is kept", () => {
    const once = pretty("voir [a]\n\n[a]:\n/url\n");
    expect(once).toBe("voir [a](/url)\n\n[a]:\n/url\n");
    expect(pretty(once)).toBe(once);
  });
  test("definition is a raw_block", () =>
    expect(names(parseMarkdown("[x]: /unused\n"))).toEqual(["raw_block"]));
  test("shortcut reference still resolves through a raw definition", () => {
    const doc = parseMarkdown("un [lien]\n\n[lien]: https://a.b\n");
    expect(doc.firstChild!.child(1).marks[0]?.attrs.href).toBe("https://a.b");
    expect(pretty("un [lien]\n\n[lien]: https://a.b\n")).toBe("un [lien](https://a.b)\n\n[lien]: https://a.b\n");
  });
});

describe("raw — extra guarantees", () => {
  test("multi-line footnote with indented continuation", () =>
    verbatim("texte[^n]\n\n[^n]: première ligne\n\n    suite indentée"));
  test("blank lines inside an HTML comment are kept", () => verbatim("<!--\na\n\n\n\nb\n-->"));
  test("fence-like lines inside raw do not confuse the blank-line tidy", () =>
    expect(pretty("<div>\n```\n</div>\n\n\n\npara\n")).toBe("<div>\n```\n</div>\n\npara\n"));
  test("math inside fenced code is not raw", () =>
    expect(names(parseMarkdown("```\n$x$ [^1] [a][b]\n```\n"))).toEqual(["code_block", "text"]));
  test("raw block inside a blockquote", () => {
    const md = "> a\n>\n> <div>\n> x\n> </div>\n";
    expect(pretty(md)).toBe(md);
  });
  test("raw paragraph inside a list item keeps the list", () => {
    const md = "- a\n\n  voir [doc][1]\n\n[1]: https://a.b\n";
    expect(pretty(md)).toBe(md);
    expect(parseMarkdown(md).firstChild!.type.name).toBe("bullet_list");
  });
  for (const md of ["- a\n  <div>x</div>\n- b\n", "- a\n  ```\n  x\n  ```\n- b\n", "- [ ] a\n  > q\n- [x] b\n"])
    test(`blocks in a tight item stay tight ${JSON.stringify(md)}`, () => expect(pretty(md)).toBe(md));
  test("task list item with inline math stays a task list", () => {
    const md = "- [ ] a\n\n- [ ] b $x$\n";
    const once = pretty(md);
    expect(pretty(once)).toBe(once);
    expect(parseMarkdown(md).firstChild!.type.name).toBe("task_list");
    expect(once).toContain("$x$");
  });
  test("dollar amounts are not math", () => expect(pretty("de $5 à $10 __ok__\n")).toBe("de $5 à $10 **ok**\n"));
  test("unclosed $$ only makes its own paragraph raw", () => {
    const md = "$$\na __b__\n\nc __d__\n";
    expect(pretty(md)).toBe("$$\na __b__\n\nc **d**\n");
  });
  // Revue finale #4 : markdown-it tronque les lignes plus larges que l'en-tête ; le tableau reste donc brut.
  test("table row with more cells than the header is kept byte for byte", () => {
    expect(pretty("| a |\n|---|\n| b | extra |\n")).toBe("| a |\n|---|\n| b | extra |\n");
    verbatim("| a | b |\n|:--|--:|\n| 1 | 2 | 3 |\n| 4 |");
    expect(names(parseMarkdown("| a |\n|---|\n| b | extra |\n"))).toEqual(["raw_block"]);
    for (const md of ["> | a |\n> |---|\n> | b | c |\n", "- x\n\n  | a |\n  |---|\n  | b | c |\n"])
      expect(pretty(md)).toBe(md);
    // Un pipe échappé n'est pas une cellule de plus.
    expect(parseMarkdown("| a |\n|---|\n| `x\\|y` |\n").firstChild!.type.name).toBe("table");
  });
  test("table with fewer cells than the header stays a table", () =>
    expect(parseMarkdown("| a | b |\n|---|---|\n| 1 |\n").firstChild!.type.name).toBe("table"));
  test("CRLF raw source comes out with LF", () =>
    expect(pretty("<div>\r\nx\r\n</div>\r\n")).toBe("<div>\nx\n</div>\n"));
});

describe("parseMarkdown never throws (review)", () => {
  const NASTY = [
    "```\nnon fermé\n",
    "~~~\n<!-- x -->\n",
    "<!-- x -->\n",
    "a<br>b\n\n<br>\n",
    "> <div>\n> > <span>x\n> > </span>\n> </div>\n",
    "> > <!-- c -->\n> > texte <b>gras</b>\n",
    "- <div>\n  x\n  </div>\n- <i>y</i>\n",
    "$$\n",
    "---\n",
    "---\ntitle: x\n",
    "[^]: x\n[]: y\n[a]:\n",
    "| a |\n|---|\n| <b>x</b> | y |\n",
    "<details>\n\n```\n</details>\n```\n",
    "\u0000<\u0000>",
    "| a |\n|---|\n| b | extra |\n",
  ];
  for (const md of NASTY)
    test(JSON.stringify(md), () => {
      const once = pretty(md);
      expect(pretty(once)).toBe(once);
    });
});

describe("U+0000 never reaches the saved file (final review #8)", () => {
  const NUL = String.fromCharCode(0);
  const REPL = String.fromCharCode(0xfffd);
  test("NUL in a text node is written as U+FFFD", () => {
    const doc = schema.node("doc", null, [schema.node("paragraph", null, [schema.text(`a ${NUL}0${NUL} b`)])]);
    expect(serializeMarkdown(doc)).toBe(`a ${REPL}0${REPL} b\n`);
    const lone = schema.node("doc", null, [schema.node("paragraph", null, [schema.text(`a${NUL}b`)])]);
    expect(serializeMarkdown(lone)).toBe(`a${REPL}b\n`);
  });
  test("NUL in a code block is written as U+FFFD", () => {
    const doc = schema.node("doc", null, [schema.node("code_block", { language: "" }, [schema.text(`x${NUL}3${NUL}`)])]);
    expect(serializeMarkdown(doc)).toBe("```\nx" + REPL + "3" + REPL + "\n```\n");
  });
  test("unknown raw placeholder is never written as undefined", () => {
    const link = schema.marks.link.create({ href: `u${NUL}7${NUL}`, title: null });
    const doc = schema.node("doc", null, [schema.node("paragraph", null, [schema.text("lien", [link])])]);
    const out = serializeMarkdown(doc);
    expect(out).not.toContain("undefined");
    expect(out).toContain("7");
  });
});
