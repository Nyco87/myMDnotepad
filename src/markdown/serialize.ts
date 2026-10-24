import { MarkdownSerializer, type MarkdownSerializerState } from "prosemirror-markdown";
import type { Mark, Node } from "prosemirror-model";
import { formatTable, type Align } from "./table-format";

type NodeRule = (state: MarkdownSerializerState, node: Node, parent: Node, index: number) => void;
type MarkRule = ConstructorParameters<typeof MarkdownSerializer>[1][string];

// `delim`, `closed`, `out` and `flushClose` are internal to prosemirror-markdown
// but stable for years; the custom rules below need them.
type State = MarkdownSerializerState & {
  delim: string;
  out: string;
  closed: Node | null;
  flushClose(size?: number): void;
};

/**
 * Escapes needed at the start of a line, beyond what `state.esc` already does
 * (it handles "#", "-", "*", "+ ", ">" and "1. "). After a line break the text
 * continues a paragraph, so "=" must also be escaped (setext underline).
 */
function escapeLineStart(text: string, afterBreak: boolean): string {
  text = text
    .replace(/^(\s*\d+)\.$/, "$1\\.") // "1." alone is an (empty) ordered item
    .replace(/^(\s*\d+)\)(\s|$)/, "$1\\)$2") // "1) " ordered item
    .replace(/^(\s*)\+$/, "$1\\+"); // "+" alone is an (empty) bullet item
  return afterBreak ? text.replace(/^(\s*)=/, "$1\\=") : text;
}

/**
 * Adjusts `state.esc` output anywhere in a line: adds the escapes it misses,
 * and drops the ones it adds needlessly ("5 * 3": a "*" or "_" between spaces
 * can never open or close emphasis).
 */
function escapeInline(text: string): string {
  return text
    .replace(/<(?=[A-Za-z/!?])/g, "\\<") // would start inline HTML or an autolink
    .replace(/&(?=#?\w+;)/g, "\\&") // would be read as an entity
    .replace(/(\s)\\([*_])(?=\s)/g, "$1$2");
}

/**
 * `==` that could open or close a highlight on re-parse is escaped (`\=\=`), so literal text never turns into a mark:
 * not between spaces, and not inside a word (`a==b`, `x == y` stay as typed).
 */
function escapeHighlight(text: string): string {
  return text.replace(/={2,}/g, (run, offset: number) => {
    const prev = text[offset - 1];
    const next = text[offset + run.length];
    const space = (c: string | undefined): boolean => c !== undefined && /\s/.test(c);
    const wordy = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c);
    if (space(prev) && space(next)) return run;
    if (wordy(prev) && wordy(next)) return run;
    return run.replace(/=/g, "\\=");
  });
}

function isBreak(node: Node | null | undefined): boolean {
  return node?.type.name === "hard_break";
}

/** Destination of a link/image: wrapped in <> when it contains spaces. */
function destination(url: string): string {
  if (/[\s<>]/.test(url)) return "<" + url.replace(/[<>]/g, "\\$&") + ">";
  return url.replace(/[()]/g, "\\$&");
}

function titlePart(title: string | null): string {
  return title ? ' "' + title.replace(/"/g, '\\"') + '"' : "";
}

const BULLETISH = new Set(["bullet_list", "task_list"]);

/**
 * CommonMark only starts a new list when the marker changes ("-" vs "*",
 * "1." vs "1)"); otherwise adjacent lists merge on re-parse (and a task list
 * merged with a bullet list loses its checkboxes). So a list directly
 * following a list of the same family uses the alternate marker; the next one
 * switches back, and so on. Returns true when the alternate marker is needed.
 */
function alternateMarker(node: Node, parent: Node, index: number): boolean {
  const family = (n: Node | null) => (n ? (BULLETISH.has(n.type.name) ? "bullet" : n.type.name) : null);
  let alternate = false;
  for (let i = index - 1; i >= 0 && family(parent.child(i)) === family(node); i--) alternate = !alternate;
  return alternate;
}

function list(state: State, node: Node, delim: string, firstDelim: (i: number) => string): void {
  // Upstream would separate two same-type lists by two blank lines; one is enough
  // now that the marker keeps them apart.
  if (state.closed && state.closed.type === node.type) state.flushClose(2);
  state.renderList(node, delim, firstDelim);
}

/** An empty item is written as its bare marker ("-", "1.", "- [ ]"), without trailing space. */
function trimEmptyItem(state: State, node: Node): void {
  if (node.textContent === "" && node.childCount === 1 && node.firstChild!.content.size === 0)
    state.out = state.out.replace(/ +$/, "");
}

/**
 * In a tight list the blocks of one item follow each other without a blank
 * line ("- a" then "  ```"); a blank line there would make the list loose on re-parse.
 */
function itemContent(state: State, node: Node, parent: Node): void {
  if (!parent.attrs.tight) return state.renderContent(node);
  node.forEach((child, _offset, i) => {
    if (i) state.flushClose(1);
    state.render(child, node, i);
  });
}

/** Same rule as prosemirror-markdown's `isPlainURL`: link text equals its URL → `<url>`. */
function isAutolink(mark: Mark, parent: Node, index: number): boolean {
  if (mark.attrs.title || !/^\w+:/.test(mark.attrs.href)) return false;
  const content = parent.child(index);
  if (!content.isText || content.text !== mark.attrs.href || content.marks[content.marks.length - 1] !== mark) return false;
  return index === parent.childCount - 1 || !mark.isInSet(parent.child(index + 1).marks);
}

/**
 * Raw sources are written as placeholders (one per line, so blank lines and
 * fence-like lines inside them are invisible to `tidy`) and put back at the
 * very end. Only the serializer emits U+0000: markdown-it turns it into U+FFFD.
 */
let rawStore: string[] = [];
const PLACEHOLDER = /([ \t]*)\u0000(\d+)\u0000/g;

function placeholder(source: string): string {
  rawStore.push(source);
  return `\u0000${rawStore.length - 1}\u0000`;
}

/** U+0000 typed or pasted into the document would be read back as a placeholder: write U+FFFD like markdown-it. */
const noNul = (text: string): string => text.replace(/\u0000/g, "�");

/**
 * Puts raw sources back. An empty raw line also drops the block prefix's trailing spaces ("> ").
 * An index we did not issue (U+0000 in an attribute) is written as it was, its U+0000 made U+FFFD.
 */
function expandRaw(md: string): string {
  return md.replace(PLACEHOLDER, (m, ws: string, n: string) => {
    const source = rawStore[Number(n)];
    if (source === undefined) return noNul(m);
    return source === "" ? "" : ws + source;
  });
}

/** Inline markdown of one table cell, on a single line. */
function cellMarkdown(cell: Node): string {
  const md = serializer.serialize(cell.type.schema.topNodeType.create(null, cell.content));
  return expandRaw(md).trim().replace(/\n+/g, "<br>");
}

const nodes: Record<string, NodeRule> = {
  paragraph(state, node) {
    // An empty paragraph has no markdown form; writing nothing avoids stray blank lines.
    if (node.content.size === 0) return;
    state.renderInline(node);
    state.closeBlock(node);
  },

  heading(state, node) {
    const s = state as State;
    state.write("#".repeat(node.attrs.level) + " ");
    state.renderInline(node, false);
    // A trailing "#" run would be read as the optional ATX closing sequence.
    s.out = s.out.replace(/ (#+)$/, " \\$1");
    state.closeBlock(node);
  },

  blockquote(state, node) {
    state.wrapBlock("> ", null, node, () => state.renderContent(node));
  },

  code_block(state, node) {
    const runs = node.textContent.match(/`{3,}/g) ?? [];
    const longest = Math.max(2, ...runs.map((r) => r.length));
    const fence = "`".repeat(longest + 1);
    state.write(fence + node.attrs.language + "\n");
    state.text(noNul(node.textContent), false);
    state.write("\n"); // always (not ensureNewLine): content ending with a blank line keeps it
    state.write(fence);
    state.closeBlock(node);
  },

  horizontal_rule(state, node) {
    state.write("---");
    state.closeBlock(node);
  },

  bullet_list(state, node, parent, index) {
    const bullet = alternateMarker(node, parent, index) ? "* " : "- ";
    list(state as State, node, "  ", () => bullet);
  },

  ordered_list(state, node, parent, index) {
    const sep = alternateMarker(node, parent, index) ? ")" : ".";
    const first = `${node.attrs.start}${sep} `;
    list(state as State, node, " ".repeat(first.length), (i) => (i === 0 ? first : `1${sep} `));
  },

  list_item(state, node, parent) {
    itemContent(state as State, node, parent);
    trimEmptyItem(state as State, node);
  },

  task_list(state, node, parent, index) {
    const bullet = alternateMarker(node, parent, index) ? "*" : "-";
    list(state as State, node, "  ", (i) => (node.child(i).attrs.checked ? `${bullet} [x] ` : `${bullet} [ ] `));
  },

  task_item(state, node, parent) {
    itemContent(state as State, node, parent);
    trimEmptyItem(state as State, node);
  },

  raw_block(state, node) {
    state.text(node.attrs.source.split("\n").map(placeholder).join("\n"), false);
    state.closeBlock(node);
  },

  raw_inline(state, node) {
    state.text(placeholder(node.attrs.source), false);
  },

  table(state, node) {
    const rows: string[][] = [];
    node.forEach((row) => {
      const cells: string[] = [];
      row.forEach((cell) => cells.push(cellMarkdown(cell)));
      rows.push(cells);
    });
    const align: (Align | null)[] = [];
    node.firstChild?.forEach((cell) => align.push(cell.attrs.align ?? null));
    state.text(formatTable(rows, align), false);
    state.closeBlock(node);
  },

  image(state, node) {
    state.write(
      "![" + escapeInline(state.esc(node.attrs.alt || "")) + "](" + destination(node.attrs.src) + titlePart(node.attrs.title) + ")",
    );
  },

  /**
   * Decision (brief): a line break is written as "\n" followed by the current
   * block prefix ("> " in a quote, indentation in a list), i.e. a markdown soft
   * break. Breaks with nothing before or after them are dropped, and a run of
   * breaks becomes a paragraph separator, because neither can be expressed as
   * soft breaks.
   */
  hard_break(state, _node, parent, index) {
    const s = state as State;
    if (isBreak(parent.maybeChild(index - 1))) return; // handled by the first break of the run
    let next = index + 1;
    while (isBreak(parent.maybeChild(next))) next++;
    const hasBefore = index > 0;
    const hasAfter = next < parent.childCount;
    if (!hasBefore || !hasAfter) return;
    s.out = s.out.replace(/[ \t]+$/, "");
    if (parent.type.name === "heading") s.out += " ";
    else if (next - index > 1) s.out += "\n" + s.delim.replace(/\s+$/, "") + "\n";
    else s.out += "\n";
  },

  text(state, node, parent, index) {
    const s = state as MarkdownSerializerState & { atBlockStart: boolean; inAutolink?: boolean };
    if (s.inAutolink) {
      state.text(noNul(node.text!), false);
      return;
    }
    const afterBreak = isBreak(parent.maybeChild(index - 1)) && parent.type.name !== "heading";
    const lineStart = afterBreak || s.atBlockStart;
    let out = escapeHighlight(escapeInline(state.esc(noNul(node.text!), lineStart)));
    if (lineStart) out = escapeLineStart(out, afterBreak);
    state.text(out, false);
  },
};

const marks: Record<string, MarkRule> = {
  em: { open: "*", close: "*", mixable: true, expelEnclosingWhitespace: true },
  strong: { open: "**", close: "**", mixable: true, expelEnclosingWhitespace: true },
  strike: { open: "~~", close: "~~", mixable: true, expelEnclosingWhitespace: true },
  highlight: { open: "==", close: "==", mixable: true, expelEnclosingWhitespace: true },
  link: {
    open(state, mark, parent, index) {
      const s = state as MarkdownSerializerState & { inAutolink?: boolean };
      s.inAutolink = isAutolink(mark, parent, index);
      return s.inAutolink ? "<" : "[";
    },
    close(state, mark) {
      const s = state as MarkdownSerializerState & { inAutolink?: boolean };
      const auto = s.inAutolink;
      s.inAutolink = undefined;
      return auto ? ">" : "](" + destination(mark.attrs.href) + titlePart(mark.attrs.title) + ")";
    },
    mixable: true,
  },
  code: {
    open(_state, _mark, parent, index) {
      return backticksFor(parent.child(index), -1);
    },
    close(_state, _mark, parent, index) {
      return backticksFor(parent.child(index - 1), 1);
    },
    escape: false,
  },
};

/** Inline code delimiter long enough for the backticks the code contains. */
function backticksFor(node: Node, side: -1 | 1): string {
  let len = 0;
  if (node.isText) for (const m of node.text!.matchAll(/`+/g)) len = Math.max(len, m[0].length);
  const ticks = "`".repeat(len + 1);
  if (len === 0) return ticks;
  return side < 0 ? ticks + " " : " " + ticks;
}

const serializer = new MarkdownSerializer(nodes, marks, { strict: true });

/**
 * Final normalisation: LF only, at most one blank line between blocks (outside
 * fenced code, whose content is verbatim), exactly one trailing newline.
 */
function tidy(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    if (fence) {
      if (line.startsWith(fence) && /^`+\s*$/.test(line)) fence = null;
    } else {
      const open = /^(`{3,})/.exec(line);
      if (open) fence = open[1];
      else if (line === "" && (out.length === 0 || out[out.length - 1] === "")) continue;
    }
    out.push(line);
  }
  const text = out.join("\n").replace(/\n+$/, "");
  return text ? text + "\n" : "";
}

export function serializeMarkdown(doc: Node): string {
  rawStore = [];
  try {
    return expandRaw(tidy(serializer.serialize(doc)));
  } finally {
    rawStore = [];
  }
}
