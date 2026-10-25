import { describe, expect, test } from "vitest";
import { parseMarkdown } from "./parse";
import { serializeMarkdown } from "./serialize";

const pretty = (md: string) => serializeMarkdown(parseMarkdown(md));

const FIXTURE = `Compte rendu de réunion
=======================

Bonjour à tous, voici le **résumé** de la réunion du _jeudi_.
Les points __importants__ sont en gras, le ~~vieux plan~~ est barré,
et la commande \`npm test\` doit passer.

Sous-titre
----------

* premier point
* second point avec un [lien](https://exemple.fr "Exemple")
    + sous-point imbriqué
    + autre sous-point
* troisième point

3) étape trois
4) étape quatre

Tâches à faire :

- [ ] relire le document
- [x] envoyer l'invitation
- [X] réserver la salle

> Une citation sur
> deux lignes.
>
> Et un second paragraphe.

~~~ts
function add(a: number, b: number) {
  return a + b;


}
~~~

    code indenté

![schéma](images/schema.png) et <https://auto.lien>

***

1\\. ceci n'est pas une liste, ni # ceci un titre.
Ligne forcée\\
suivante et 5 * 3 = 15.



Fin de la note.
`;

describe("pretty markdown", () => {
  test("headings become ATX", () => expect(pretty("Titre\n=====\n")).toBe("# Titre\n"));
  test("extra blank lines between blocks are kept, single trailing newline", () =>
    expect(pretty("# A\n\n\n\npara\n\n\n")).toBe("# A\n\n\n\npara\n"));
  test("bullets normalised to -", () => expect(pretty("* a\n+ b\n")).toBe("- a\n- b\n"));
  test("ordered lists use 1.", () => expect(pretty("1) a\n2) b\n")).toBe("1. a\n1. b\n"));
  test("ordered list keeps a non-1 start", () => expect(pretty("3. a\n4. b\n")).toBe("3. a\n1. b\n"));
  test("emphasis styles", () => expect(pretty("__g__ _i_ ~~s~~ `c`\n")).toBe("**g** *i* ~~s~~ `c`\n"));
  test("blockquote multi-line keeps every line prefixed", () =>
    expect(pretty("> l1\n> l2\n")).toBe("> l1\n> l2\n"));
  test("fenced code keeps language and content verbatim", () =>
    expect(pretty("~~~js\n  x = 1\n~~~\n")).toBe("```js\n  x = 1\n```\n"));
  test("task list", () => expect(pretty("- [ ] a\n- [x] b\n")).toBe("- [ ] a\n- [x] b\n"));
  test("image and link", () =>
    expect(pretty("![alt](images/a.png) [t](https://x.y)\n")).toBe("![alt](images/a.png) [t](https://x.y)\n"));
  test("special chars are escaped only when needed", () =>
    expect(pretty("1\\. pas une liste\n")).toBe("1\\. pas une liste\n"));
  test("soft line breaks survive", () => expect(pretty("a\nb\n")).toBe("a\nb\n"));
  test("idempotent on a mixed fixture", () => {
    const once = pretty(FIXTURE);
    expect(pretty(once)).toBe(once);
  });
});

describe("pretty markdown — extra guarantees", () => {
  test("blank lines inside fenced code are kept verbatim", () =>
    expect(pretty("```\na\n\n\n\nb\n```\n")).toBe("```\na\n\n\n\nb\n```\n"));
  test("trailing blank line inside fenced code is kept", () =>
    expect(pretty("```\na\n\n```\n")).toBe("```\na\n\n```\n"));
  test("empty fenced code", () => expect(pretty("```\n```\n")).toBe("```\n\n```\n"));
  test("fence grows when the code contains backticks", () =>
    expect(pretty("````\n```\n````\n")).toBe("````\n```\n````\n"));
  test("indented code becomes a fence", () => expect(pretty("    x\n")).toBe("```\nx\n```\n"));
  test("nested tight lists", () => expect(pretty("* a\n    * b\n* c\n")).toBe("- a\n  - b\n- c\n"));
  test("loose lists stay loose", () => expect(pretty("- a\n\n- b\n")).toBe("- a\n\n- b\n"));
  test("soft break inside a list item is indented", () => expect(pretty("- a\nb\n")).toBe("- a\n  b\n"));
  test("blockquote paragraphs separated by a bare >", () =>
    expect(pretty("> a\n>\n> b\n")).toBe("> a\n>\n> b\n"));
  test("hard break with backslash becomes a plain newline", () => expect(pretty("a\\\nb\n")).toBe("a\nb\n"));
  test("block markers after a line break are escaped", () =>
    expect(pretty("a\n\\- b\n\\# c\n\\=\n")).toBe("a\n\\- b\n\\# c\n\\=\n"));
  test("thematic break normalised to ---", () => expect(pretty("***\n")).toBe("---\n"));
  test("autolink kept", () => expect(pretty("<https://x.y>\n")).toBe("<https://x.y>\n"));
  test("link title kept", () => expect(pretty('[t](u "T")\n')).toBe('[t](u "T")\n'));
  test("checked task with capital X normalised", () => expect(pretty("- [X] a\n")).toBe("- [x] a\n"));
  test("empty items keep a bare marker and the list stays tight", () =>
    expect(pretty("-\n- b\n")).toBe("-\n- b\n"));
  test("empty task item survives", () => expect(pretty("- [ ]\n- [x] b\n")).toBe("- [ ]\n- [x] b\n"));
  test("item starting with a heading keeps the list tight", () =>
    expect(pretty("- # h\n- b\n")).toBe("- # h\n- b\n"));
  test("mixed task list keeps the checkbox text", () =>
    expect(pretty("- [ ] a\n- b\n")).toBe("- \\[ \\] a\n- b\n"));
  test("entity-built html is escaped, not turned into html", () =>
    expect(pretty("&lt;b&gt; &amp;amp;\n")).toBe("\\<b> \\&amp;\n"));
  test("adjacent lists (different markers) merge as one tight list", () =>
    expect(pretty("* a\n+ b\n")).toBe("- a\n- b\n"));
  test("lone * between spaces is not escaped", () => expect(pretty("5 * 3 et a \\*b\\*\n")).toBe("5 * 3 et a \\*b\\*\n"));
  test("empty document gives empty string", () => expect(pretty("\n\n")).toBe(""));
  test("CRLF input gives LF output", () => expect(pretty("# A\r\n\r\nb\r\n")).toBe("# A\n\nb\n"));
});

describe("parse structure", () => {
  test("task list nodes", () => {
    const doc = parseMarkdown("- [ ] a\n- [x] b\n");
    const list = doc.firstChild!;
    expect(list.type.name).toBe("task_list");
    expect(list.child(0).type.name).toBe("task_item");
    expect(list.child(0).attrs.checked).toBe(false);
    expect(list.child(1).attrs.checked).toBe(true);
    expect(list.child(0).textContent).toBe("a");
  });
  test("soft break becomes hard_break", () => {
    const para = parseMarkdown("a\nb\n").firstChild!;
    expect(para.childCount).toBe(3);
    expect(para.child(1).type.name).toBe("hard_break");
  });
  test("fence language and ordered start", () => {
    const doc = parseMarkdown("```js\nx\n```\n\n3. a\n");
    expect(doc.child(0).attrs.language).toBe("js");
    expect(doc.child(1).attrs.start).toBe(3);
  });
  test("image attrs", () => {
    const img = parseMarkdown('![alt](a.png "T")\n').firstChild!.firstChild!;
    expect(img.type.name).toBe("image");
    expect(img.attrs).toEqual({ src: "a.png", alt: "alt", title: "T" });
  });
});

describe("adjacent lists stay apart (review fix R6)", () => {
  const types = (md: string) => {
    const names: string[] = [];
    parseMarkdown(md).forEach((n) => names.push(n.type.name + (n.attrs.tight === undefined ? "" : `:${n.childCount}`)));
    return names.join(",");
  };
  const stable = (md: string, expected: string) => {
    const once = pretty(md);
    expect(once).toBe(expected);
    expect(pretty(once)).toBe(once);
    expect(types(once)).toBe(types(md));
  };
  test("bullet + loose bullet", () => stable("- a\n- b\n\n* c\n\n* d\n", "- a\n- b\n\n* c\n\n* d\n"));
  test("task + bullet", () => stable("- [ ] t\n\n* b\n", "- [ ] t\n\n* b\n"));
  test("bullet + task", () => stable("- a\n\n+ [ ] t\n", "- a\n\n* [ ] t\n"));
  test("bullet + bullet (loose) alternate back to -", () =>
    stable("- a\n\n- a2\n\n* b\n\n* b2\n\n+ c\n\n+ c2\n", "- a\n\n- a2\n\n* b\n\n* b2\n\n- c\n\n- c2\n"));
  test("ordered + ordered uses 1)", () => stable("1. a\n\n1. a2\n\n1) b\n", "1. a\n\n1. a2\n\n1) b\n"));
  test("ordered with start + loose ordered", () => stable("3. a\n\n4) b\n\n5) c\n", "3. a\n\n4) b\n\n1) c\n"));
  test("task + loose task", () => stable("- [ ] a\n\n* [x] b\n\n* [ ] c\n", "- [ ] a\n\n* [x] b\n\n* [ ] c\n"));
  // Two *tight* same-type lists are one list for the reader (brief: "* a\n+ b" → "- a\n- b").
  test("tight same-type lists merge (task)", () => stable("- [ ] a\n\n* [x] b\n", "- [ ] a\n- [x] b\n"));
  test("tight same-type lists merge (ordered)", () => stable("3. a\n4) b\n", "3. a\n1. b\n"));
  test("lists separated by a paragraph keep -", () => stable("- a\n\np\n\n- b\n", "- a\n\np\n\n- b\n"));
});

describe("URLs are kept readable (review fix)", () => {
  for (const md of [
    "![s](images/schéma.png)\n",
    "[w](https://fr.wikipedia.org/wiki/Économie)\n",
    "<https://x.y/é>\n",
    "![s](<images/mon image.png>)\n",
    "[e](a%20b)\n",
  ])
    test(JSON.stringify(md), () => expect(pretty(md)).toBe(md));
  test("image src attr is the readable path", () =>
    expect(parseMarkdown("![s](images/schéma.png)\n").firstChild!.firstChild!.attrs.src).toBe("images/schéma.png"));
});

describe("highlight ==text==", () => {
  test("highlight roundtrip", () => expect(pretty("un ==mot== ici\n")).toBe("un ==mot== ici\n"));
  test("highlight with other marks", () => expect(pretty("**==a==** ~~==b==~~\n")).toBe("**==a==** ~~==b==~~\n"));
  test("a==b stays literal", () => expect(pretty("a==b\n")).toBe("a==b\n"));
  test("spaced == stays literal", () => expect(pretty("if x == y and y == z\n")).toBe("if x == y and y == z\n"));
  test("== in code stays literal", () =>
    expect(pretty("`a==b==c` and\n\n```\n==x==\n```\n")).toBe("`a==b==c` and\n\n```\n==x==\n```\n"));
  test("parsed highlight is a mark", () =>
    expect(parseMarkdown("==x==\n").firstChild!.firstChild!.marks[0].type.name).toBe("highlight"));
  test("closing-capable == without opener is not escaped", () => {
    expect(pretty("dGVzdA== tail\n")).toBe("dGVzdA== tail\n");
    expect(pretty("x ==\n")).toBe("x ==\n");
    expect(pretty("a ==b\n")).toBe("a ==b\n");
    expect(pretty("x ==\nb\n")).toBe("x ==\nb\n");
  });
  test("literal pair that would re-parse as a mark stays escaped and idempotent", () => {
    const once = pretty("a \\=\\=b c\\=\\= d\n");
    expect(once).toBe("a \\=\\=b c\\=\\= d\n");
    expect(parseMarkdown(once).firstChild!.childCount).toBe(1);
    expect(pretty(once)).toBe(once);
  });
  test("escaped == is text and stays escaped (no accidental highlight)", () => {
    expect(parseMarkdown("\\=\\=x\\=\\=\n").firstChild!.firstChild!.marks.length).toBe(0);
    expect(pretty("\\=\\=x\\=\\=\n")).toBe("\\=\\=x\\=\\=\n");
  });
});

describe("kept blank lines (at least one blank line between blocks)", () => {
  const empties = (md: string) => {
    const doc = parseMarkdown(md);
    let n = 0;
    doc.forEach((c) => {
      if (c.type.name === "paragraph" && c.content.size === 0) n++;
    });
    return n;
  };
  test("extra blank lines roundtrip byte-identical as empty paragraphs", () => {
    expect(pretty("a\n\n\n\nb\n")).toBe("a\n\n\n\nb\n");
    expect(empties("a\n\n\n\nb\n")).toBe(2);
  });
  test("a single blank line stays a plain separator", () => {
    expect(empties("a\n\nb\n")).toBe(0);
    expect(pretty("a\n\nb\n")).toBe("a\n\nb\n");
  });
  test("table, empty paragraph, alert", () => {
    const md = "| a   | b   |\n| --- | --- |\n| 1   | 2   |\n\n\n> [!NOTE]\n> x\n";
    expect(pretty(md)).toBe(md);
    expect(empties(md)).toBe(1);
  });
  test("fenced code and lists", () => {
    const md = "```\nx\n\n\ny\n```\n\n\n- a\n- b\n\n\n\n1. c\n";
    expect(pretty(md)).toBe(md);
  });
  test("two lists with the same marker stay apart across blank lines", () => {
    const md = "- a\n\n\n* b\n";
    const out = pretty(md);
    expect(out).toBe(md);
    expect(pretty(out)).toBe(out);
  });
  test("trailing and leading empty paragraphs are not kept", () => {
    expect(pretty("a\n\n\n\n")).toBe("a\n");
    expect(pretty("\n\n\na\n")).toBe("a\n");
  });
  test("idempotent", () => {
    const once = pretty("a\n\n\n\n\nb\n\n\nc\n");
    expect(pretty(once)).toBe(once);
  });
  test("raw blocks and headings keep the gap", () => {
    const md = "# T\n\n\n<div>\nx\n</div>\n\n\n\n## U\n";
    expect(pretty(md)).toBe(md);
  });
  test("editor-made empty paragraph is written as one extra blank line", () => {
    const doc = parseMarkdown("a\n\nb\n");
    const empty = doc.type.schema.nodes.paragraph.create();
    const withEmpty = doc.type.create(null, [doc.child(0), empty, doc.child(1)]);
    expect(serializeMarkdown(withEmpty)).toBe("a\n\n\nb\n");
  });
  test("an empty paragraph in a table cell does not leak", () => {
    expect(pretty("| a | b |\n| --- | --- |\n| 1 | 2 |\n")).toBe("| a   | b   |\n| --- | --- |\n| 1   | 2   |\n");
  });
});

describe("backslashes in link destinations and titles (CodeQL js/incomplete-sanitization)", () => {
  const hrefOf = (md: string) => {
    let href: string | null = null;
    parseMarkdown(md).descendants((n) => {
      for (const m of n.marks) if (m.type.name === "link") href = m.attrs.href;
      if (n.type.name === "image") href = n.attrs.src;
    });
    return href;
  };
  const hrefs = [String.raw`a\b`, String.raw`x\(y`, String.raw`x\)y`, String.raw`dir\ `.trim(), String.raw`C:\photos\(1).png`, String.raw`p\q r(1)`];
  for (const href of hrefs) {
    test(`href ${JSON.stringify(href)} survives serialize → parse`, () => {
      const escaped = href.replace(/[\\<>]/g, (c) => "\\" + c);
      const md = serializeMarkdown(parseMarkdown(`[t](<${escaped}>)\n`));
      expect(hrefOf(md)).toBe(href);
      expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
    });
  }
  test("plain backslash before a letter is left as written", () =>
    expect(serializeMarkdown(parseMarkdown(String.raw`[t](a\b)` + "\n"))).toBe(String.raw`[t](a\b)` + "\n"));
  test("title ending with a backslash survives", () => {
    const md = serializeMarkdown(parseMarkdown('[t](u "say \\\\")\n'));
    expect(md).toBe('[t](u "say \\\\")\n');
  });
});
