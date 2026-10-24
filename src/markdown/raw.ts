import type MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";
import type StateCore from "markdown-it/lib/rules_core/state_core.mjs";
import type Token from "markdown-it/lib/token.mjs";

/**
 * Markdown the editor does not model is kept as `raw_block` / `raw_inline`
 * nodes holding its exact source, so saving a note never rewrites it.
 *
 * Raw blocks come from three places:
 * 1. `scanRaw` pre-splits the source into blank-line separated chunks and
 *    marks some as raw (front matter, `$$` math, footnotes, paragraphs using
 *    `[^…]`, `][…]` or `$…$`). A block rule turns each marked chunk into a
 *    `raw_block` token when markdown-it reaches it.
 * 2. markdown-it's own `html_block` tokens, and every reference definition
 *    markdown-it accepts (its `reference` rule is wrapped to emit one).
 * 3. A top-level block written right against a raw block (no blank line
 *    between them) joins it, since the serializer would otherwise insert a
 *    blank line and change the raw part ("x\n</details>").
 */

export interface RawScan {
  /** Start line → end line (exclusive) of each raw chunk. */
  ranges: Map<number, number>;
  /** Offset of each line start in the normalised source. */
  lineStarts: number[];
  /** True when range 0 is a front matter block. */
  frontMatter: boolean;
}

interface RawEnv {
  mdnoteRaw?: RawScan;
}

/**
 * Same normalisation as markdown-it, so line numbers match its own, plus the
 * UTF-8 BOM is dropped (notes are saved as plain UTF-8; a BOM would also hide
 * the front matter).
 */
export function normalizeSource(src: string): string {
  return src.replace(/^﻿/, "").replace(/\r\n?/g, "\n").replace(/\0/g, "�");
}

const BLANK = /^[ \t]*$/;
const QUOTE_PREFIX = /^(?: {0,3}> ?)*/;
const FENCE = /^[ \t]*(?:(?:[-+*]|\d{1,9}[.)])[ \t]+)*(`{3,}|~{3,})/;
const MATH_OPEN = /^ {0,3}\$\$/;
const FOOTNOTE_DEF = /^ {0,3}\[\^[^\]]+\]:/;
// `[^note]`, `][label]` / `][]`, or `$math$` (not "$5 and $10": no space inside the dollars).
const RAW_INLINE = /\[\^[^\]\s]+\]|\]\[[^\]]*\]|(?:^|[^\\$\w])\$[^\s$](?:[^$\n]*[^\s$\\])?\$(?![\w$])/;
const INDENTED = /^(?: {4}|\t)/;

export function scanRaw(src: string): RawScan {
  const lines = src.split("\n");
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }
  const content = (i: number) => lines[i].replace(QUOTE_PREFIX, "");
  const blank = (i: number) => BLANK.test(content(i));
  const ranges = new Map<number, number>();

  let i = 0;
  let frontMatter = false;
  if (lines[0] === "---" && lines.length > 1 && !BLANK.test(lines[1])) {
    for (let j = 1; j < lines.length; j++)
      if (lines[j] === "---" || lines[j] === "...") {
        ranges.set(0, j + 1);
        frontMatter = true;
        i = j + 1;
        break;
      }
  }

  /** Line closing the `$$` block opened at `i` (may be `i` itself), or -1. */
  const mathClose = (i: number) => {
    if (content(i).replace(MATH_OPEN, "").includes("$$")) return i;
    for (let j = i + 1; j < lines.length; j++) if (/\$\$[ \t]*$/.test(content(j))) return j;
    return -1;
  };

  while (i < lines.length) {
    if (blank(i)) {
      i++;
      continue;
    }
    const start = i;
    let raw = false;
    let footnote = false;
    let fence: RegExp | null = null;
    for (; i < lines.length; i++) {
      const text = content(i);
      if (fence) {
        if (fence.test(text)) fence = null;
        continue;
      }
      if (BLANK.test(text)) break;
      const f = FENCE.exec(text);
      if (f) {
        fence = new RegExp(`^[ \\t]*\\${f[1][0]}{${f[1].length},}[ \\t]*$`);
        continue;
      }
      if (MATH_OPEN.test(text)) {
        raw = true;
        i = Math.max(i, mathClose(i)); // unclosed: only this chunk is raw
        continue;
      }
      if (FOOTNOTE_DEF.test(text)) footnote = true;
      if (FOOTNOTE_DEF.test(text) || RAW_INLINE.test(text)) raw = true;
    }
    let end = Math.min(i, lines.length);
    while (end > start && blank(end - 1)) end--;
    // A footnote continues over following chunks indented by 4 spaces.
    while (raw && footnote) {
      let next = end;
      while (next < lines.length && blank(next)) next++;
      if (next >= lines.length || next === end || !INDENTED.test(content(next))) break;
      while (next < lines.length && !blank(next)) next++;
      end = next;
    }
    if (raw) ranges.set(start, end);
    i = Math.max(i, end);
  }
  return { ranges, lineStarts, frontMatter };
}

type BlockRule = (state: StateBlock, startLine: number, endLine: number, silent: boolean) => boolean;

/** markdown-it's own `reference` rule (set by `rawPlugin`). */
let referenceRule: BlockRule = () => false;

/**
 * Source of lines `start..end` as written inside the current container: the
 * first line from where its block starts (after "> " or a list marker, keeping
 * its own up-to-3-space indent), the others without the container's indent.
 */
function blockSource(state: StateBlock, start: number, end: number): string {
  let pos = state.bMarks[start] + state.tShift[start];
  for (let extra = state.sCount[start] - state.blkIndent; extra > 0 && state.src[pos - 1] === " "; extra--) pos--;
  const first = state.src.slice(pos, state.eMarks[start]);
  return end > start + 1 ? first + "\n" + state.getLines(start + 1, end, state.blkIndent, false) : first;
}

/** Pushes a raw block, or extends the previous one when it ends right where this one starts. */
function rawToken(state: StateBlock, start: number, end: number): Token {
  const prev = state.tokens[state.tokens.length - 1];
  if (prev?.type === "raw_block" && prev.level === state.level && prev.map?.[1] === start && prev.info !== "front_matter") {
    prev.content += "\n" + blockSource(state, start, end);
    prev.map[1] = end;
    return prev;
  }
  const token = state.push("raw_block", "", 0);
  token.content = blockSource(state, start, end);
  token.map = [start, end];
  return token;
}

/** markdown-it drops reference definitions from its output; keep each one as a raw block. */
function referenceAsRaw(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  if (!referenceRule(state, startLine, endLine, silent)) return false;
  if (!silent) rawToken(state, startLine, state.line);
  return true;
}

/** Lets markdown-it know the reference definitions inside a raw range, so `[text]` links still resolve. */
function registerReferences(state: StateBlock, start: number, end: number): void {
  const saved = state.line;
  for (let line = start; line < end; ) {
    const pos = state.bMarks[line] + state.tShift[line];
    if (state.src[pos] === "[" && referenceRule(state, line, end, false)) line = Math.max(state.line, line + 1);
    else line++;
  }
  state.line = saved;
}

function rawBlockRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const scan = (state.env as RawEnv).mdnoteRaw;
  const rangeEnd = scan?.ranges.get(startLine);
  if (!scan || rangeEnd === undefined) return false;
  // Only where the chunk really starts: not after a list marker on the same line.
  if (!/^[ \t>]*$/.test(state.src.slice(scan.lineStarts[startLine], state.bMarks[startLine] + state.tShift[startLine]))) return false;
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  if (silent) return true;
  let end = Math.min(rangeEnd, endLine);
  // Inside a list item, stop where the item ends.
  for (let line = startLine + 1; line < end; line++)
    if (!state.isEmpty(line) && state.sCount[line] < state.blkIndent) end = line;
  registerReferences(state, startLine, end);
  const token = rawToken(state, startLine, end);
  token.info = startLine === 0 && scan.frontMatter ? "front_matter" : "";
  state.line = end;
  return true;
}

const isRaw = (t: Token) => t.type === "raw_block" || t.type === "html_block";

/** Joins top-level blocks written right against a raw block into one raw block (see 3. above). */
function joinAdjacentRaw(state: StateCore): void {
  const lines = state.src.split("\n");
  const tokens = state.tokens;
  const blocks: { from: number; to: number }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    let j = i;
    if (tokens[i].nesting === 1) while (j < tokens.length - 1 && !(tokens[j].level === 0 && tokens[j].nesting === -1)) j++;
    blocks.push({ from: i, to: j });
    i = j;
  }
  const map = (b: { from: number }) => tokens[b.from].map;
  const touching = (a: { from: number }, b: { from: number }) => {
    const ma = map(a);
    const mb = map(b);
    if (!ma || !mb || mb[0] === 0 || tokens[a.from].info === "front_matter") return false;
    return !BLANK.test(lines[mb[0] - 1]);
  };
  const out: Token[] = [];
  for (let g = 0; g < blocks.length; ) {
    let h = g;
    while (h + 1 < blocks.length && touching(blocks[h], blocks[h + 1])) h++;
    const group = blocks.slice(g, h + 1);
    if (group.length > 1 && group.some((b) => isRaw(tokens[b.from]))) {
      const start = map(group[0])![0];
      let end = map(group[group.length - 1])![1];
      while (end > start && BLANK.test(lines[end - 1] ?? "")) end--;
      const token = new state.Token("raw_block", "", 0);
      token.content = lines.slice(start, end).join("\n");
      token.map = [start, end];
      token.block = true;
      out.push(token);
    } else for (const b of group) out.push(...tokens.slice(b.from, b.to + 1));
    g = h + 1;
  }
  state.tokens = out;
}

export function rawPlugin(md: MarkdownIt): void {
  // `__rules__` is markdown-it internal, but the only way to reach a built-in rule.
  const rules = (md.block.ruler as unknown as { __rules__: { name: string; fn: BlockRule }[] }).__rules__;
  const reference = rules.find((r) => r.name === "reference");
  if (!reference) throw new Error("markdown-it reference rule not found");
  referenceRule = reference.fn;
  md.block.ruler.at("reference", referenceAsRaw);
  md.block.ruler.before("table", "mdnote_raw", rawBlockRule);
  md.core.ruler.after("block", "mdnote_raw_join", joinAdjacentRaw);
}
