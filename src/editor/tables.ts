import { Plugin, TextSelection, type Command, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  deleteColumn,
  deleteRow,
  deleteTable,
  findTable,
  goToNextCell,
  isInTable,
  selectionCell,
  TableMap,
} from "prosemirror-tables";
import { showContextMenu, type ContextMenuItem } from "../ui/context-menu";

export { pickTableSize } from "../ui/table-size-picker";
export { showContextMenu };

/** Table of rows x cols; first row is made of header cells; cursor lands in the first cell. */
export function insertTable(rows: number, cols: number): Command {
  return (state, dispatch) => {
    const { table, table_row, table_header, table_cell, paragraph } = state.schema.nodes;
    if (rows < 1 || cols < 1 || isInTable(state)) return false;
    const makeRow = (cell: typeof table_cell) =>
      table_row.create(null, Array.from({ length: cols }, () => cell.create(null, paragraph.create())));
    const node = table.create(null, [
      makeRow(table_header),
      ...Array.from({ length: rows - 1 }, () => makeRow(table_cell)),
    ]);
    if (dispatch) {
      const tr = state.tr.replaceSelectionWith(node);
      // Position of the inserted table: just before whatever now follows the replaced range.
      let start = -1;
      tr.doc.nodesBetween(Math.max(0, state.selection.from - 1), tr.doc.content.size, (n, pos) => {
        if (start < 0 && n === node) start = pos;
        return start < 0;
      });
      if (start < 0) tr.doc.descendants((n, pos) => {
        if (start < 0 && n.type === table) start = pos;
        return start < 0;
      });
      const end = start + node.nodeSize;
      if (!tr.doc.resolve(end).nodeAfter) tr.insert(end, paragraph.create());
      tr.setSelection(TextSelection.create(tr.doc, start + 4)); // table > row > cell > paragraph
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/**
 * Runs a row command, then restores the GFM invariant: row 0 holds table_header cells and
 * every other row table_cell (inserting above / deleting the header row would break it).
 */
function keepHeaderRow(cmd: Command): Command {
  return (state, dispatch) => {
    let result: Transaction | null = null;
    if (!cmd(state, (tr) => (result = tr))) return false;
    if (!dispatch) return true;
    const tr: Transaction = result!;
    const t = isInTable(state) ? findTable(tr.selection.$from) : null;
    if (t) {
      const { table_header, table_cell } = state.schema.nodes;
      t.node.forEach((row, rowOff, r) => {
        const want = r === 0 ? table_header : table_cell;
        row.forEach((cell, cellOff) => {
          if (cell.type !== want) tr.setNodeMarkup(t.start + rowOff + 1 + cellOff, want, cell.attrs);
        });
      });
    }
    dispatch(tr);
    return true;
  };
}

export const addRowAfterCmd: Command = keepHeaderRow(addRowAfter);
export const addRowBeforeCmd: Command = keepHeaderRow(addRowBefore);
export const addColumnAfterCmd: Command = (s, d) => addColumnAfter(s, d);
export const addColumnBeforeCmd: Command = (s, d) => addColumnBefore(s, d);

/** Deleting the only remaining row removes the whole table (no empty table). */
export const deleteRowCmd: Command = (state, dispatch) => {
  if (!isInTable(state)) return false;
  const t = findTable(state.selection.$from);
  if (t && t.node.childCount <= 1) return deleteTable(state, dispatch);
  return keepHeaderRow(deleteRow)(state, dispatch);
};

/** Deleting the only remaining column removes the whole table. */
export const deleteColumnCmd: Command = (state, dispatch) => {
  if (!isInTable(state)) return false;
  const t = findTable(state.selection.$from);
  if (t && TableMap.get(t.node).width <= 1) return deleteTable(state, dispatch);
  return deleteColumn(state, dispatch);
};

/** Sets the alignment of the whole column holding the cursor. */
export function setColumnAlign(align: "left" | "center" | "right" | null): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false;
    const $cell = selectionCell(state);
    const t = findTable($cell);
    if (!t) return false;
    const map = TableMap.get(t.node);
    const col = map.colCount($cell.pos - t.start);
    if (dispatch) {
      const tr = state.tr;
      const seen = new Set<number>();
      for (let row = 0; row < map.height; row++) {
        const rel = map.map[row * map.width + col];
        if (seen.has(rel)) continue;
        seen.add(rel);
        const cell = t.node.nodeAt(rel);
        if (cell) tr.setNodeMarkup(t.start + rel, undefined, { ...cell.attrs, align });
      }
      dispatch(tr);
    }
    return true;
  };
}

/** Tab: next cell; in the last cell appends a row and enters it. Outside a table: not captured. */
export const tabNextCell: Command = (state, dispatch) => {
  if (!isInTable(state)) return false;
  if (goToNextCell(1)(state, dispatch)) return true;
  let rowTr: Transaction | null = null;
  if (!addRowAfter(state, (tr) => (rowTr = tr))) return false;
  if (!dispatch) return true;
  const next = state.apply(rowTr!);
  dispatch(rowTr!);
  // Dispatch is synchronous: the editor now holds `next`, so the move transaction is valid on it.
  goToNextCell(1)(next, dispatch);
  return true;
};

export const tabPrevCell: Command = (state, dispatch) => (isInTable(state) ? goToNextCell(-1)(state, dispatch) : false);

/* ------------------------------------------------------------------ */
/* Controls overlay + context menu                                     */
/* ------------------------------------------------------------------ */

export function tableMenuItems(view: EditorView): ContextMenuItem[] {
  const run = (cmd: Command) => () => {
    cmd(view.state, view.dispatch);
    view.focus();
  };
  return [
    { label: "Insérer une ligne au-dessus", action: run(addRowBeforeCmd) },
    { label: "Insérer une ligne en dessous", action: run(addRowAfterCmd) },
    { label: "Insérer une colonne à gauche", action: run(addColumnBeforeCmd) },
    { label: "Insérer une colonne à droite", action: run(addColumnAfterCmd) },
    { label: "Aligner à gauche", action: run(setColumnAlign("left")) },
    { label: "Aligner au centre", action: run(setColumnAlign("center")) },
    { label: "Aligner à droite", action: run(setColumnAlign("right")) },
    { label: "Supprimer la ligne", action: run(deleteRowCmd), danger: true },
    { label: "Supprimer la colonne", action: run(deleteColumnCmd), danger: true },
  ];
}

/**
 * While the cursor is in a table, shows "+" buttons at its right (append column) and bottom
 * (append row). The buttons live in an overlay next to the editor DOM, never in the document.
 */
export function tableControlsPlugin(): Plugin {
  return new Plugin({
    view(view) {
      const host = view.dom.parentElement;
      const mkBtn = (cls: "col" | "row", title: string, cmd: Command): HTMLButtonElement => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `tbl-add ${cls}`;
        b.title = title;
        b.textContent = "+";
        b.hidden = true;
        b.addEventListener("mousedown", (e) => e.preventDefault()); // keep editor focus
        b.addEventListener("click", () => {
          // Append at the very end: move the cursor into the last column / row first.
          const t = findTable(view.state.selection.$from);
          if (!t) return;
          const map = TableMap.get(t.node);
          const rel = cls === "col" ? map.map[map.width - 1] : map.map[(map.height - 1) * map.width];
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, t.start + rel + 2)));
          cmd(view.state, view.dispatch);
          view.focus();
        });
        return b;
      };
      const colBtn = mkBtn("col", "Ajouter une colonne", addColumnAfterCmd);
      const rowBtn = mkBtn("row", "Ajouter une ligne", addRowAfterCmd);
      if (host) {
        if (getComputedStyle(host).position === "static") host.style.position = "relative";
        host.append(colBtn, rowBtn);
      }

      const update = (v: EditorView): void => {
        const t = isInTable(v.state) ? findTable(v.state.selection.$from) : null;
        const dom = t && host ? (v.nodeDOM(t.pos) as HTMLElement | null) : null;
        if (!host || !dom || !dom.getBoundingClientRect) {
          colBtn.hidden = rowBtn.hidden = true;
          return;
        }
        const h = host.getBoundingClientRect();
        const r = dom.getBoundingClientRect();
        colBtn.hidden = rowBtn.hidden = false;
        colBtn.style.left = `${r.right - h.left + host.scrollLeft + 4}px`;
        colBtn.style.top = `${r.top - h.top + host.scrollTop}px`;
        colBtn.style.height = `${r.height}px`;
        rowBtn.style.left = `${r.left - h.left + host.scrollLeft}px`;
        rowBtn.style.top = `${r.bottom - h.top + host.scrollTop + 4}px`;
        rowBtn.style.width = `${r.width}px`;
      };
      update(view);
      const onResize = (): void => update(view);
      window.addEventListener("resize", onResize);
      return {
        update,
        destroy() {
          window.removeEventListener("resize", onResize);
          colBtn.remove();
          rowBtn.remove();
        },
      };
    },
    props: {
      handleDOMEvents: {
        contextmenu(view, event) {
          const e = event as MouseEvent;
          const at = view.posAtCoords({ left: e.clientX, top: e.clientY });
          if (!at) return false;
          const $pos = view.state.doc.resolve(at.pos);
          let inCell = false;
          for (let d = $pos.depth; d > 0; d--) {
            const n = $pos.node(d).type.name;
            if (n === "table_cell" || n === "table_header") inCell = true;
          }
          if (!inCell) return false;
          e.preventDefault();
          view.dispatch(view.state.tr.setSelection(TextSelection.near($pos)));
          showContextMenu(e.clientX, e.clientY, tableMenuItems(view));
          return true;
        },
      },
    },
  });
}
