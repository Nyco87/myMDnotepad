import MarkdownIt from "markdown-it";
import type StateCore from "markdown-it/lib/rules_core/state_core.mjs";
import type Token from "markdown-it/lib/token.mjs";
import taskLists from "markdown-it-task-lists";
import { MarkdownParser } from "prosemirror-markdown";
import { Fragment, type Node } from "prosemirror-model";
import { alertKindOf } from "./alert-kinds";
import { markPlugin } from "./mark-plugin";
import { normalizeSource, rawPlugin, scanRaw } from "./raw";
import { schema } from "./schema";

/**
 * A list is tight when markdown-it hid its paragraphs. Unlike
 * prosemirror-markdown's helper, look for the list's first own paragraph so
 * items that are empty or start with a heading/code block are not mistaken
 * for a loose list.
 */
function listIsTight(tokens: Token[], i: number): boolean {
  const level = tokens[i].level + 2;
  const end = closeIndex(tokens, i);
  for (let j = i + 1; j < end; j++) if (tokens[j].type === "paragraph_open" && tokens[j].level === level) return tokens[j].hidden;
  return true;
}

const CHECKBOX = /^<input class="task-list-item-checkbox"/;

/** Index of the matching `*_close` token for the `*_open` token at `open`. */
function closeIndex(tokens: Token[], open: number): number {
  const level = tokens[open].level;
  const close = tokens[open].type.replace(/_open$/, "_close");
  for (let i = open + 1; i < tokens.length; i++) if (tokens[i].type === close && tokens[i].level === level) return i;
  return tokens.length - 1;
}

/**
 * markdown-it-task-lists only decorates tokens (CSS classes + an html_inline
 * checkbox). Turn that into dedicated `task_list` / `task_item` tokens so the
 * ProseMirror parser can map them like any other block.
 *
 * Only bullet lists whose items are *all* tasks become task lists. Otherwise
 * (mixed list, ordered list) the checkbox is put back as literal text so no
 * content is lost.
 */
function taskTokens(state: StateCore): void {
  const tokens = state.tokens;
  markEmptyTasks(state);
  for (let i = 0; i < tokens.length; i++) {
    const list = tokens[i];
    if (!/^(bullet|ordered)_list_open$/.test(list.type) || list.attrGet("class") !== "contains-task-list") continue;
    const end = closeIndex(tokens, i);
    const items: number[] = [];
    for (let j = i + 1; j < end; j++)
      if (tokens[j].type === "list_item_open" && tokens[j].level === list.level + 1) items.push(j);
    const isTask = (j: number) => {
      const inline = tokens[j + 2];
      return inline?.type === "inline" && inline.children?.[0]?.type === "html_inline" && CHECKBOX.test(inline.children[0].content);
    };
    const convert = list.type === "bullet_list_open" && items.every(isTask);
    if (convert) {
      list.type = "task_list_open";
      tokens[end].type = "task_list_close";
    }
    for (const j of items) {
      if (!isTask(j)) continue;
      const children = tokens[j + 2].children!;
      const checked = children[0].content.includes('checked=""');
      if (convert) {
        tokens[j].type = "task_item_open";
        tokens[j].meta = { checked };
        tokens[closeIndex(tokens, j)].type = "task_item_close";
        children.shift();
        // The plugin leaves the space that followed "[ ]" on the first text token.
        const first = children[0];
        if (first?.type === "text") {
          first.content = first.content.replace(/^ /, "");
          if (!first.content) children.shift();
        }
      } else {
        const text = new state.Token("text", "", 0);
        text.content = checked ? "[x]" : "[ ]";
        children[0] = text;
      }
    }
  }
}

/**
 * The plugin needs text after the checkbox ("- [ ] x"). An empty task ("- [ ]",
 * which is what we write for a task the user has not filled yet) is decorated
 * here the same way so it survives a round trip.
 */
function markEmptyTasks(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i];
    if (inline.type !== "inline" || tokens[i - 1].type !== "paragraph_open" || tokens[i - 2].type !== "list_item_open") continue;
    const m = /^\[([ xX])\]$/.exec(inline.content);
    if (!m) continue;
    const checkbox = new state.Token("html_inline", "", 0);
    checkbox.content = `<input class="task-list-item-checkbox"${m[1] === " " ? "" : ' checked=""'} type="checkbox">`;
    inline.children = [checkbox];
    tokens[i - 2].attrSet("class", "task-list-item");
    for (let j = i - 3; j >= 0; j--)
      if (tokens[j].level === tokens[i - 2].level - 1) {
        tokens[j].attrSet("class", "contains-task-list");
        break;
      }
  }
}

/**
 * prosemirror-tables cells hold a paragraph; markdown-it puts the cell's
 * inline token directly in `th`/`td`. Wrap it.
 */
function cellParagraphs(state: StateCore): void {
  const out: Token[] = [];
  for (const token of state.tokens) {
    const prev = out[out.length - 1];
    if (token.type === "inline" && (prev?.type === "th_open" || prev?.type === "td_open")) {
      out.push(new state.Token("paragraph_open", "p", 1), token, new state.Token("paragraph_close", "p", -1));
    } else out.push(token);
  }
  state.tokens = out;
}

function cellAlign(tok: Token): string | null {
  const m = /text-align:\s*(left|center|right)/.exec(tok.attrGet("style") ?? "");
  return m ? m[1] : null;
}

/**
 * A blockquote whose first paragraph starts with `[!KIND]` (a GitHub alert kind, any case) becomes an
 * `alert_open` / `alert_close` pair. The marker is removed from the content; text after it on the same line
 * stays as the first paragraph (`inline`). An unknown kind, or text glued to the marker, leaves the quote alone.
 */
function alertTokens(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "blockquote_open") continue;
    const open = tokens[i + 1];
    const inline = tokens[i + 2];
    if (open?.type !== "paragraph_open" || inline?.type !== "inline") continue;
    const m = /^(\[!([A-Za-z]+)\])(?=[ \t]|$|\n)/.exec(inline.content);
    const kind = m ? alertKindOf(m[2]) : null;
    const children = inline.children;
    const first = children?.[0];
    if (!m || !kind || !children || first?.type !== "text" || !first.content.startsWith(m[1])) continue;

    const sameLine = /^[ \t]+\S/.test(inline.content.slice(m[1].length));
    first.content = first.content.slice(m[1].length);
    if (sameLine) first.content = first.content.replace(/^[ \t]+/, "");
    if (!sameLine || first.content === "") children.shift();
    if (!sameLine && (children[0]?.type === "softbreak" || children[0]?.type === "hardbreak")) children.shift();

    const close = closeIndex(tokens, i);
    tokens[i].type = "alert_open";
    tokens[i].meta = { kind, marker: m[1], inline: sameLine };
    tokens[close].type = "alert_close";
    if (children.length === 0) tokens.splice(i + 1, 3); // the marker was alone in its paragraph
  }
}

export const markdownIt = MarkdownIt("commonmark").enable(["strikethrough", "table"]).use(taskLists).use(rawPlugin).use(markPlugin);
markdownIt.core.ruler.after("github-task-lists", "mdnote-task-tokens", taskTokens);
markdownIt.core.ruler.push("mdnote-cell-paragraphs", cellParagraphs);
markdownIt.core.ruler.push("mdnote-alerts", alertTokens);
// Keep link/image destinations as written (after backslash unescaping) instead
// of markdown-it's percent-encoded form: the file must not change on save
// ("images/schéma.png" stays readable) and `<https://x.y/é>` stays an autolink.
// Whoever loads a URL (editor, image view) encodes it if needed.
markdownIt.normalizeLink = (url) => url;
markdownIt.normalizeLinkText = (url) => url;

/** Token → schema mapping. */
export const parserTokens: ConstructorParameters<typeof MarkdownParser>[2] = {
  paragraph: { block: "paragraph" },
  heading: { block: "heading", getAttrs: (tok) => ({ level: Number(tok.tag.slice(1)) }) },
  blockquote: { block: "blockquote" },
  alert: {
    block: "alert",
    getAttrs: (tok) => ({ kind: tok.meta.kind, marker: tok.meta.marker, inline: tok.meta.inline }),
  },
  code_block: { block: "code_block", noCloseToken: true },
  fence: { block: "code_block", getAttrs: (tok) => ({ language: tok.info.trim() }), noCloseToken: true },
  hr: { node: "horizontal_rule" },
  bullet_list: { block: "bullet_list", getAttrs: (_tok, tokens, i) => ({ tight: listIsTight(tokens, i) }) },
  ordered_list: {
    block: "ordered_list",
    getAttrs: (tok, tokens, i) => ({ start: Number(tok.attrGet("start")) || 1, tight: listIsTight(tokens, i) }),
  },
  list_item: { block: "list_item" },
  task_list: { block: "task_list", getAttrs: (_tok, tokens, i) => ({ tight: listIsTight(tokens, i) }) },
  task_item: { block: "task_item", getAttrs: (tok) => ({ checked: Boolean(tok.meta?.checked) }) },
  image: {
    node: "image",
    getAttrs: (tok) => ({
      src: tok.attrGet("src"),
      alt: tok.children?.map((c) => c.content).join("") ?? "",
      title: tok.attrGet("title") || null,
    }),
  },
  // Decision (brief): a soft line break is a visible line break in the editor.
  softbreak: { node: "hard_break" },
  hardbreak: { node: "hard_break" },
  em: { mark: "em" },
  strong: { mark: "strong" },
  s: { mark: "strike" },
  mark: { mark: "highlight" },
  link: { mark: "link", getAttrs: (tok) => ({ href: tok.attrGet("href"), title: tok.attrGet("title") || null }) },
  code_inline: { mark: "code", noCloseToken: true },
  table: { block: "table" },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: "table_row" },
  th: { block: "table_header", getAttrs: (tok) => ({ align: cellAlign(tok) }) },
  td: { block: "table_cell", getAttrs: (tok) => ({ align: cellAlign(tok) }) },
  raw_block: { node: "raw_block", getAttrs: (tok) => ({ source: tok.content }) },
  html_block: { node: "raw_block", getAttrs: (tok) => ({ source: tok.content.replace(/\n$/, "") }) },
  html_inline: { node: "raw_inline", getAttrs: (tok) => ({ source: tok.content }) },
};

const parser = new MarkdownParser(schema, markdownIt, parserTokens);

const LISTS = new Set(["bullet_list", "ordered_list", "task_list"]);

/**
 * Two adjacent *tight* lists of the same type differ only by their source
 * marker ("* a
+ b"): they are one list for the reader, so merge them (the
 * brief normalises "* a
+ b" to "- a
- b"). Any other adjacent lists stay
 * apart and the serializer keeps them apart with an alternate marker.
 */
function mergeTightLists(node: Node): Node {
  if (node.isTextblock || node.isLeaf) return node;
  const children: Node[] = [];
  let changed = false;
  node.forEach((child) => {
    const merged = mergeTightLists(child);
    if (merged !== child) changed = true;
    const prev = children[children.length - 1];
    if (prev && LISTS.has(merged.type.name) && prev.type === merged.type && prev.attrs.tight && merged.attrs.tight) {
      children[children.length - 1] = prev.copy(prev.content.append(merged.content));
      changed = true;
    } else children.push(merged);
  });
  return changed ? node.copy(Fragment.from(children)) : node;
}

export function parseMarkdown(md: string): Node {
  const src = normalizeSource(md);
  return mergeTightLists(parser.parse(src, { mdnoteRaw: scanRaw(src) }));
}
