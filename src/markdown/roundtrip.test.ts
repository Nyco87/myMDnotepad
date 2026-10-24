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
  test("one blank line between blocks, single trailing newline", () =>
    expect(pretty("# A\n\n\n\npara\n\n\n")).toBe("# A\n\npara\n"));
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
    expect(pretty("- a\n\n\n* b\n")).toBe("- a\n- b\n"));
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
