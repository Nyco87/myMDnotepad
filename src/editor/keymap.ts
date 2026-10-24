import { undoInputRule } from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import { redo, undo } from "prosemirror-history";
import {
  chainCommands,
  setBlockType,
  toggleMark as pmToggleMark,
  wrapIn as pmWrapIn,
} from "prosemirror-commands";
import { splitListItem } from "prosemirror-schema-list";
import { Selection, TextSelection, type Command, type Plugin } from "prosemirror-state";
import type { Schema } from "prosemirror-model";
import { schema as defaultSchema } from "../markdown/schema";
import { tabNextCell, tabPrevCell } from "./tables";

/* ------------------------------------------------------------------ */
/* Command factories (also used by the toolbar, task 10)               */
/* ------------------------------------------------------------------ */

export function toggleMark(name: "strong" | "em" | "strike" | "code"): Command {
  return (state, dispatch) => pmToggleMark(state.schema.marks[name])(state, dispatch);
}

/** `0` = paragraph. */
export function setHeading(level: 0 | 1 | 2 | 3 | 4 | 5 | 6): Command {
  return (state, dispatch) =>
    level === 0
      ? setBlockType(state.schema.nodes.paragraph)(state, dispatch)
      : setBlockType(state.schema.nodes.heading, { level })(state, dispatch);
}

export function wrapIn(type: "blockquote" | "bullet_list" | "ordered_list" | "task_list"): Command {
  return (state, dispatch) => pmWrapIn(state.schema.nodes[type])(state, dispatch);
}

export function insertCodeBlock(): Command {
  return (state, dispatch) => setBlockType(state.schema.nodes.code_block)(state, dispatch);
}

/** Inserts a rule and guarantees an empty paragraph after it, which receives the cursor. */
export function insertHorizontalRule(): Command {
  return (state, dispatch) => {
    const { horizontal_rule, paragraph } = state.schema.nodes;
    if (!dispatch) return true;
    const tr = state.tr.replaceSelectionWith(horizontal_rule.create());
    const pos = tr.selection.to;
    const $pos = tr.doc.resolve(pos);
    if (!$pos.nodeAfter) tr.insert(pos, paragraph.create());
    tr.setSelection(Selection.near(tr.doc.resolve(pos), 1));
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/** Links the selection; with an empty selection inserts the href as the link text. */
export function insertLink(href: string): Command {
  return (state, dispatch) => {
    const link = state.schema.marks.link;
    const { from, to, empty } = state.selection;
    if (dispatch) {
      const mark = link.create({ href });
      const tr = empty
        ? state.tr.replaceWith(from, to, state.schema.text(href, [mark]))
        : state.tr.addMark(from, to, mark);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/* ------------------------------------------------------------------ */
/* Enter: markdown fences and sticky blocks                            */
/* ------------------------------------------------------------------ */

/** "```lang" or "---" alone in a paragraph, Enter pressed at its end. */
const fenceOrRuleOnEnter: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  const { paragraph, code_block, horizontal_rule } = state.schema.nodes;
  if (!empty || $from.parent.type !== paragraph || $from.parentOffset !== $from.parent.content.size) return false;
  const text = $from.parent.textContent;
  if ($from.parent.childCount !== 1 || !$from.parent.firstChild!.isText) return false;

  const fence = /^```([\w+#.-]*)$/.exec(text);
  const rule = text === "---";
  if (!fence && !rule) return false;

  const container = $from.node($from.depth - 1);
  const index = $from.index($from.depth - 1);
  if (fence) {
    if (!container.canReplaceWith(index, index + 1, code_block)) return false;
    if (dispatch) {
      const block = code_block.create({ language: fence[1] });
      const tr = state.tr.replaceWith($from.before(), $from.after(), block);
      tr.setSelection(TextSelection.create(tr.doc, $from.before() + 1));
      dispatch(tr.scrollIntoView());
    }
    return true;
  }
  if (!container.canReplaceWith(index, index + 1, horizontal_rule)) return false;
  if (dispatch) {
    const tr = state.tr.replaceWith($from.before(), $from.after(), [horizontal_rule.create(), paragraph.create()]);
    tr.setSelection(TextSelection.create(tr.doc, $from.before() + 2));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** Enter in a code block always inserts a newline (no exit on a double Enter). */
const enterInCodeBlock: Command = (state, dispatch) => {
  if (!state.selection.$from.parent.type.spec.code) return false;
  if (dispatch) dispatch(state.tr.insertText("\n").scrollIntoView());
  return true;
};

/** Enter in a paragraph directly inside a blockquote inserts a hard_break (stays in the quote). */
const enterInBlockquote: Command = (state, dispatch) => {
  const { $from } = state.selection;
  const { paragraph, blockquote, hard_break } = state.schema.nodes;
  if ($from.parent.type !== paragraph || $from.depth < 1 || $from.node($from.depth - 1).type !== blockquote) {
    return false;
  }
  if (dispatch) dispatch(state.tr.replaceSelectionWith(hard_break.create()).scrollIntoView());
  return true;
};

/** Set once an unexpected `endOfTextblock` failure has been logged. */
let warnedLayout = false;

/**
 * ArrowDown on the last line of a blockquote / code block leaves it.
 *
 * Two checks, both required:
 *  1. structural: code_block has no "
" after the cursor; blockquote: the
 *     cursor's textblock is the last block at every level inside the quote and
 *     has no hard_break after the cursor;
 *  2. visual: `view.endOfTextblock("down")`, so soft-wrapped text only leaves from
 *     its last visual line. It needs layout; where there is none (jsdom) it throws
 *     and the check is skipped (structural answer kept).
 * The cursor then moves to the next block, or a new empty paragraph is created
 * if the block is the last of its parent.
 */
const arrowDownLeavesBlock: Command = (state, dispatch, view) => {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock) return false;
  const { blockquote, paragraph } = state.schema.nodes;

  let stickyDepth = -1;
  if ($from.parent.type.spec.code) {
    if ($from.parent.textBetween($from.parentOffset, $from.parent.content.size).includes("\n")) return false;
    stickyDepth = $from.depth;
  } else {
    for (let d = $from.depth - 1; d >= 1; d--) {
      if ($from.node(d).type === blockquote) {
        stickyDepth = d;
        break;
      }
    }
    if (stickyDepth < 0) return false;
    for (let d = stickyDepth + 1; d <= $from.depth; d++) {
      if ($from.index(d - 1) !== $from.node(d - 1).childCount - 1) return false;
    }
    let hasBreakAfter = false;
    $from.parent.forEach((child, offset) => {
      if (child.type.name === "hard_break" && offset >= $from.parentOffset) hasBreakAfter = true;
    });
    if (hasBreakAfter) return false;
  }

  // Soft-wrapped text: only leave from the last *visual* line. Without layout (jsdom) endOfTextblock throws; keep the structural answer.
  if (view) {
    let lastVisualLine = true;
    try {
      lastVisualLine = view.endOfTextblock("down");
    } catch (err) {
      // Expected without layout (jsdom): getClientRects / elementFromPoint are missing.
      if (!warnedLayout && !/getClientRects|getBoundingClientRect|elementFromPoint/i.test(String(err))) {
        warnedLayout = true;
        console.warn("endOfTextblock failed unexpectedly", err);
      }
    }
    if (!lastVisualLine) return false;
  }

  const after = $from.after(stickyDepth);
  const $after = state.doc.resolve(after);
  const parent = $after.parent;
  const index = $after.index();
  if (index < parent.childCount) {
    if (dispatch) {
      dispatch(state.tr.setSelection(Selection.near($after, 1)).scrollIntoView());
    }
    return true;
  }
  if (!parent.canReplaceWith(index, index, paragraph)) return false;
  if (dispatch) {
    const tr = state.tr.insert(after, paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, after + 1));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** Ctrl+Enter: toggles the checkbox of the task item holding the cursor. */
const toggleTaskItem: Command = (state, dispatch) => {
  const { $from } = state.selection;
  for (let d = $from.depth; d >= 1; d--) {
    const node = $from.node(d);
    if (node.type === state.schema.nodes.task_item) {
      if (dispatch) {
        dispatch(state.tr.setNodeMarkup($from.before(d), undefined, { ...node.attrs, checked: !node.attrs.checked }));
      }
      return true;
    }
  }
  return false;
};

/* ------------------------------------------------------------------ */

export function buildKeymap(schema: Schema = defaultSchema): Plugin {
  const { list_item, task_item } = schema.nodes;

  const bindings: Record<string, Command> = {
    "Mod-b": toggleMark("strong"),
    "Mod-i": toggleMark("em"),
    "Mod-Shift-x": toggleMark("strike"),
    "Mod-e": toggleMark("code"),
    "Mod-0": setHeading(0),

    "Mod-z": undo,
    "Mod-y": redo,
    "Mod-Shift-z": redo,

    Backspace: undoInputRule,

    "Mod-Enter": toggleTaskItem,
    Enter: chainCommands(
      fenceOrRuleOnEnter,
      enterInCodeBlock,
      enterInBlockquote,
      splitListItem(task_item, { checked: false }),
      splitListItem(list_item),
    ),
    ArrowDown: arrowDownLeavesBlock,

    // Table cell navigation; both return false outside a table so Tab keeps its default behaviour.
    Tab: tabNextCell,
    "Shift-Tab": tabPrevCell,
  };
  for (let level = 1; level <= 6; level++) {
    bindings[`Mod-${level}`] = setHeading(level as 1 | 2 | 3 | 4 | 5 | 6);
  }
  return keymap(bindings);
}
