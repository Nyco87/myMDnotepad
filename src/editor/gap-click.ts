import { Plugin } from "prosemirror-state";
import { GapCursor } from "prosemirror-gapcursor";
import type { ResolvedPos } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";

/** `GapCursor.valid` is internal to prosemirror-gapcursor (absent from its typings) but stable. */
export const gapValid = ($pos: ResolvedPos): boolean => (GapCursor as unknown as { valid($p: ResolvedPos): boolean }).valid($pos);

/** Vertical extent of one top-level block, with the document positions just before and after it. */
export interface BlockBox {
  before: number;
  after: number;
  top: number;
  bottom: number;
}

/**
 * Document position of the gap whose vertical space contains `y`: the space between two consecutive top-level
 * blocks (their margins). Null when `y` is not between two blocks.
 */
export function gapPosAt(boxes: BlockBox[], y: number): number | null {
  for (let i = 0; i + 1 < boxes.length; i++) if (y > boxes[i].bottom && y < boxes[i + 1].top) return boxes[i].after;
  return null;
}

function blockBoxes(view: EditorView): BlockBox[] {
  const boxes: BlockBox[] = [];
  view.state.doc.forEach((node, offset) => {
    const dom = view.nodeDOM(offset);
    if (!(dom instanceof HTMLElement)) return;
    const r = dom.getBoundingClientRect();
    boxes.push({ before: offset, after: offset + node.nodeSize, top: r.top, bottom: r.bottom });
  });
  return boxes;
}

/**
 * A click in the empty space between two blocks that have no text (table, alert, code, diagram, rule…) puts a gap
 * cursor there; typing or Enter then creates a paragraph. Between text blocks the browser's own behaviour is kept.
 */
export function gapClickPlugin(): Plugin {
  return new Plugin({
    props: {
      handleClick(view, _pos, event) {
        if (!view.editable || event.target !== view.dom) return false;
        const at = gapPosAt(blockBoxes(view), event.clientY);
        if (at === null) return false;
        const $pos = view.state.doc.resolve(at);
        if (!gapValid($pos)) return false;
        view.dispatch(view.state.tr.setSelection(new GapCursor($pos)));
        view.focus();
        return true;
      },
    },
  });
}
