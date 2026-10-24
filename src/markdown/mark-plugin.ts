import type MarkdownIt from "markdown-it";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";

/**
 * `==highlight==` for markdown-it, built like the core `strikethrough` rule with a doubled `=` marker.
 * Delimiters follow the intraword rule of `_`: `a==b` and `x == y` stay literal text.
 */
const MARKER = 0x3d; // =

function tokenize(state: StateInline, silent: boolean): boolean {
  if (silent || state.src.charCodeAt(state.pos) !== MARKER) return false;
  const scanned = state.scanDelims(state.pos, false);
  let len = scanned.length;
  if (len < 2) return false;
  if (len % 2) {
    state.push("text", "", 0).content = "=";
    len--;
  }
  for (let i = 0; i < len; i += 2) {
    state.push("text", "", 0).content = "==";
    state.delimiters.push({
      marker: MARKER,
      length: 0, // no "rule of 3" check (that is for emphasis)
      token: state.tokens.length - 1,
      end: -1,
      open: scanned.can_open,
      close: scanned.can_close,
    });
  }
  state.pos += scanned.length;
  return true;
}

type Delimiter = { marker: number; token: number; end: number };

function convert(state: StateInline, delimiters: Delimiter[]): void {
  const lone: number[] = [];
  for (const start of delimiters) {
    if (start.marker !== MARKER || start.end === -1) continue;
    const end = delimiters[start.end];
    const open = state.tokens[start.token];
    open.type = "mark_open";
    open.tag = "mark";
    open.nesting = 1;
    open.markup = "==";
    open.content = "";
    const close = state.tokens[end.token];
    close.type = "mark_close";
    close.tag = "mark";
    close.nesting = -1;
    close.markup = "==";
    close.content = "";
    const before = state.tokens[end.token - 1];
    if (before.type === "text" && before.content === "=") lone.push(end.token - 1);
  }
  // An odd run `=====` is split `=` + `==` + `==`: move the lone `=` after the closing tags.
  while (lone.length) {
    const i = lone.pop()!;
    let j = i + 1;
    while (j < state.tokens.length && state.tokens[j].type === "mark_close") j++;
    j--;
    if (i !== j) [state.tokens[i], state.tokens[j]] = [state.tokens[j], state.tokens[i]];
  }
}

function postProcess(state: StateInline): boolean {
  convert(state, state.delimiters as Delimiter[]);
  for (const meta of state.tokens_meta) {
    if (meta?.delimiters) convert(state, meta.delimiters as Delimiter[]);
  }
  return true;
}

export function markPlugin(md: MarkdownIt): void {
  md.inline.ruler.after("emphasis", "mark", tokenize);
  md.inline.ruler2.after("emphasis", "mark", postProcess);
}
