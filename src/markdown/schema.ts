import { Schema, type NodeSpec, type MarkSpec } from "prosemirror-model";
import { tableNodes } from "prosemirror-tables";
import { alertKindOf } from "./alert-kinds";

/**
 * Document schema shared by the editor, the markdown parser and the serializer.
 *
 * Node/mark names match the markdown-it token names where possible so the
 * parser table in `parse.ts` stays a plain mapping. `doc` must remain the
 * first entry (it is the top node).
 */
export const nodes: Record<string, NodeSpec> = {
  doc: { content: "block+" },

  paragraph: {
    content: "inline*",
    group: "block",
    parseDOM: [{ tag: "p" }],
    toDOM: () => ["p", 0],
  },

  heading: {
    attrs: { level: { default: 1 } },
    content: "inline*",
    group: "block",
    defining: true,
    parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
    toDOM: (node) => [`h${node.attrs.level}`, 0],
  },

  blockquote: {
    content: "block+",
    group: "block",
    defining: true,
    parseDOM: [
      { tag: "blockquote" },
      // Pasted alert of an unknown kind: a plain quote (known kinds are handled by the alert rule).
      { tag: "div[data-alert]", getAttrs: (dom) => (alertKindOf((dom as HTMLElement).getAttribute("data-alert") ?? "") ? false : null) },
    ],
    toDOM: () => ["blockquote", 0],
  },

  /**
   * GitHub alert (`> [!NOTE]` …). `marker` keeps the original marker text (`[!note]`) so an untouched alert is written back
   * as it was; null once the kind was changed or for a new alert. `inline` is true when text followed the marker on its line.
   */
  alert: {
    attrs: { kind: { default: "note" }, marker: { default: null }, inline: { default: false } },
    content: "block+",
    group: "block",
    defining: true,
    createGapCursor: true,
    parseDOM: [
      {
        tag: "div[data-alert]",
        getAttrs: (dom) => {
          const kind = alertKindOf((dom as HTMLElement).getAttribute("data-alert") ?? "");
          return kind ? { kind } : false; // unknown kind: falls back to the blockquote rule below
        },
      },
    ],
    toDOM: (node) => ["div", { "data-alert": node.attrs.kind, class: `alert alert-${node.attrs.kind}` }, 0],
  },

  code_block: {
    attrs: { language: { default: "" } },
    content: "text*",
    marks: "",
    group: "block",
    code: true,
    defining: true,
    createGapCursor: true,
    parseDOM: [
      {
        tag: "pre",
        preserveWhitespace: "full",
        getAttrs: (dom) => ({ language: (dom as HTMLElement).getAttribute("data-language") || "" }),
      },
    ],
    toDOM: (node) => ["pre", { "data-language": node.attrs.language || null }, ["code", 0]],
  },

  horizontal_rule: {
    group: "block",
    parseDOM: [{ tag: "hr" }],
    toDOM: () => ["hr"],
  },

  bullet_list: {
    attrs: { tight: { default: true } },
    content: "list_item+",
    group: "block",
    parseDOM: [{ tag: "ul:not([data-type=task_list])" }],
    toDOM: () => ["ul", 0],
  },

  ordered_list: {
    attrs: { start: { default: 1 }, tight: { default: true } },
    content: "list_item+",
    group: "block",
    parseDOM: [
      {
        tag: "ol",
        getAttrs: (dom) => {
          const start = (dom as HTMLElement).getAttribute("start");
          return { start: start ? Number(start) || 1 : 1 };
        },
      },
    ],
    toDOM: (node) => ["ol", { start: node.attrs.start === 1 ? null : node.attrs.start }, 0],
  },

  // `block+` (not `paragraph block*`) so items starting with a heading, code
  // block, quote… (valid markdown) parse without an injected empty paragraph.
  list_item: {
    content: "block+",
    defining: true,
    parseDOM: [{ tag: "li:not([data-type=task_item])" }],
    toDOM: () => ["li", 0],
  },

  task_list: {
    attrs: { tight: { default: true } },
    content: "task_item+",
    group: "block",
    parseDOM: [{ tag: "ul[data-type=task_list]", priority: 60 }],
    toDOM: () => ["ul", { "data-type": "task_list" }, 0],
  },

  // A task item always starts with a paragraph: it is the line holding the checkbox.
  task_item: {
    attrs: { checked: { default: false } },
    content: "paragraph block*",
    defining: true,
    parseDOM: [
      {
        tag: "li[data-type=task_item]",
        priority: 60,
        getAttrs: (dom) => ({ checked: (dom as HTMLElement).getAttribute("data-checked") === "true" }),
      },
    ],
    toDOM: (node) => ["li", { "data-type": "task_item", "data-checked": String(node.attrs.checked) }, 0],
  },

  text: { group: "inline" },

  image: {
    inline: true,
    attrs: { src: {}, alt: { default: "" }, title: { default: null } },
    group: "inline",
    draggable: true,
    parseDOM: [
      {
        tag: "img[src]",
        getAttrs: (dom) => {
          const el = dom as HTMLElement;
          return { src: el.getAttribute("src"), alt: el.getAttribute("alt") || "", title: el.getAttribute("title") };
        },
      },
    ],
    toDOM: (node) => ["img", { src: node.attrs.src, alt: node.attrs.alt, title: node.attrs.title }],
  },

  hard_break: {
    inline: true,
    group: "inline",
    selectable: false,
    parseDOM: [{ tag: "br" }],
    toDOM: () => ["br"],
  },

  /**
   * Markdown the editor does not model (HTML blocks, front matter, math,
   * footnotes, reference definitions…): kept as its exact source lines and
   * written back unchanged. Not editable as rich text.
   */
  raw_block: {
    attrs: { source: { default: "" } },
    group: "block",
    atom: true,
    selectable: true,
    parseDOM: [
      {
        tag: "pre[data-type=raw_block]",
        priority: 60,
        preserveWhitespace: "full",
        getAttrs: (dom) => ({ source: (dom as HTMLElement).textContent ?? "" }),
      },
    ],
    toDOM: (node) => ["pre", { "data-type": "raw_block", class: "raw-block" }, node.attrs.source],
  },

  /** Inline HTML tag (`<kbd>`, `</kbd>`, `<br>`…), written back unchanged. */
  raw_inline: {
    attrs: { source: { default: "" } },
    inline: true,
    group: "inline",
    atom: true,
    parseDOM: [
      {
        tag: "span[data-type=raw_inline]",
        getAttrs: (dom) => ({ source: (dom as HTMLElement).textContent ?? "" }),
      },
    ],
    toDOM: (node) => ["span", { "data-type": "raw_inline", class: "raw-inline" }, node.attrs.source],
  },

  // GFM tables (prosemirror-tables compatible). A cell holds exactly one
  // paragraph: a GFM cell is a single line of inline content.
  ...tableNodes({
    tableGroup: "block",
    cellContent: "paragraph",
    cellAttributes: {
      align: {
        default: null,
        getFromDOM: (dom) => {
          const value = (dom as HTMLElement).style.textAlign;
          return value === "left" || value === "center" || value === "right" ? value : null;
        },
        setDOMAttr: (value, attrs) => {
          if (value) attrs.style = ((attrs.style as string) || "") + `text-align: ${value};`;
        },
      },
    },
  }),
};

// Order matters: it is the nesting order of marks in the serialized output.
// (prosemirror-markdown convention). `code` must stay last (innermost)
// because its content is not escaped.
export const marks: Record<string, MarkSpec> = {
  em: {
    parseDOM: [{ tag: "i" }, { tag: "em" }, { style: "font-style=italic" }],
    toDOM: () => ["em", 0],
  },

  strong: {
    parseDOM: [{ tag: "strong" }, { tag: "b" }, { style: "font-weight=bold" }],
    toDOM: () => ["strong", 0],
  },

  strike: {
    parseDOM: [{ tag: "s" }, { tag: "del" }, { style: "text-decoration=line-through" }],
    toDOM: () => ["s", 0],
  },

  highlight: {
    parseDOM: [{ tag: "mark" }],
    toDOM: () => ["mark", 0],
  },

  link: {
    attrs: { href: {}, title: { default: null } },
    inclusive: false,
    parseDOM: [
      {
        tag: "a[href]",
        getAttrs: (dom) => {
          const el = dom as HTMLElement;
          return { href: el.getAttribute("href"), title: el.getAttribute("title") };
        },
      },
    ],
    toDOM: (mark) => ["a", { href: mark.attrs.href, title: mark.attrs.title }, 0],
  },

  code: {
    parseDOM: [{ tag: "code" }],
    toDOM: () => ["code", 0],
  },
};

export const schema = new Schema({ nodes, marks });
