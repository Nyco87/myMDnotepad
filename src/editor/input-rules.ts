import {
  InputRule,
  inputRules,
  textblockTypeInputRule,
  wrappingInputRule,
} from "prosemirror-inputrules";
import { Fragment, type MarkType, type Node as PMNode, type Schema } from "prosemirror-model";
import { TextSelection, type Plugin } from "prosemirror-state";

/**
 * Markdown typing shortcuts. Rules fire when the last character of the pattern
 * is typed (through `handleTextInput`); Backspace right after reverts them
 * (`undoInputRule` in keymap.ts).
 */

/** `**bold**`-style rule: replaces the marker + text by the text carrying `mark`. */
function markRule(pattern: RegExp, markType: MarkType, markerLength: number): InputRule {
  return new InputRule(pattern, (state, match, start, end) => {
    const content = match[1];
    // The pattern may start with one non-marker character (or ^); keep it.
    const lead = match[0].length - (2 * markerLength + content.length);
    const textStart = start + lead;
    // Text typed so far in the doc ends at `end`; the last marker char is still being typed.
    const cursorMarks = state.doc.resolve(end).marks();
    const tr = state.tr.replaceWith(
      textStart,
      end,
      state.schema.text(content, markType.create().addToSet(cursorMarks)),
    );
    // Text typed after the closing marker must not continue the mark.
    return tr.setStoredMarks(cursorMarks.filter((m) => m.type !== markType));
  });
}

/** `[ ] ` / `[x] ` typed at the start of a bullet item: that item becomes a task item. */
function taskItemInListRule(schema: Schema): InputRule {
  const { bullet_list, task_list, task_item } = schema.nodes;
  return new InputRule(/^\[([ xX])\]\s$/, (state, match, start, end) => {
    const $s = state.doc.resolve(start);
    if ($s.depth < 3 || $s.parentOffset !== 0 || $s.parent.type !== schema.nodes.paragraph) return null;
    if ($s.index($s.depth - 1) !== 0 || $s.node($s.depth - 1).type !== schema.nodes.list_item) return null;
    if ($s.node($s.depth - 2).type !== bullet_list) return null;

    const listDepth = $s.depth - 2;
    const itemIndex = $s.index(listDepth);
    const listPos = $s.before(listDepth);

    const tr = state.tr.delete(start, end);
    const list = tr.doc.nodeAt(listPos)!;
    const item = list.child(itemIndex);
    const task = task_item.create({ checked: match[1] !== " " }, item.content);

    // Only the converted item changes kind: the rest of the list is kept on each side.
    const before: PMNode[] = [];
    const after: PMNode[] = [];
    list.forEach((child, _o, i) => {
      if (i < itemIndex) before.push(child);
      else if (i > itemIndex) after.push(child);
    });
    const parts: PMNode[] = [];
    if (before.length) parts.push(bullet_list.create(list.attrs, before));
    parts.push(task_list.create(null, task));
    if (after.length) parts.push(bullet_list.create(list.attrs, after));

    tr.replaceWith(listPos, listPos + list.nodeSize, Fragment.from(parts));
    const cursor = listPos + (before.length ? parts[0].nodeSize : 0) + 3;
    return tr.setSelection(TextSelection.create(tr.doc, cursor));
  });
}

/** `- [ ] ` typed in one go (e.g. pasted/IME) at the start of a paragraph: a task list. */
function taskListRule(schema: Schema): InputRule {
  const { task_list, task_item, paragraph } = schema.nodes;
  return new InputRule(/^\s*[-+*]\s\[([ xX])\]\s$/, (state, match, start, end) => {
    const $s = state.doc.resolve(start);
    if ($s.parent.type !== paragraph) return null;
    const container = $s.node($s.depth - 1);
    const index = $s.index($s.depth - 1);
    if (!container.canReplaceWith(index, index + 1, task_list)) return null;

    const tr = state.tr.delete(start, end);
    const para = tr.doc.resolve(start).parent;
    const list = task_list.create(null, task_item.create({ checked: match[1] !== " " }, para));
    const before = $s.before();
    tr.replaceWith(before, before + para.nodeSize, list);
    return tr.setSelection(TextSelection.create(tr.doc, before + 3));
  });
}

export function buildInputRules(schema: Schema): Plugin {
  const { heading, blockquote, bullet_list, ordered_list } = schema.nodes;
  const { strong, em, strike, code } = schema.marks;

  return inputRules({
    rules: [
      textblockTypeInputRule(/^(#{1,6})\s$/, heading, (m) => ({ level: m[1].length })),
      wrappingInputRule(/^\s*>\s$/, blockquote),
      taskListRule(schema),
      taskItemInListRule(schema),
      wrappingInputRule(/^\s*([-+*])\s$/, bullet_list),
      wrappingInputRule(
        /^(\d+)\.\s$/,
        ordered_list,
        (m) => ({ start: +m[1] }),
        (m, node) => node.childCount + node.attrs.start === +m[1],
      ),
      // Longest marker first only matters for readability: the patterns cannot
      // both match the same text (a lone `*` never follows or precedes `*`).
      markRule(/(?:^|[^*])\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, strong, 2),
      markRule(/(?:^|[^*])\*([^*\s](?:[^*]*[^*\s])?)\*$/, em, 1),
      markRule(/(?:^|[^~])~~([^~\s](?:[^~]*[^~\s])?)~~$/, strike, 2),
      markRule(/(?:^|[^`])`([^`\s](?:[^`]*[^`\s])?)`$/, code, 1),
    ],
  });
}
