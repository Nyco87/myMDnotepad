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

export type Axis = "row" | "col";

/** Boundary `boundary` (0..count) → the cell index to put the cursor in and on which side to insert. */
export function insertionAt(boundary: number, count: number): { index: number; where: "before" | "after" } {
  return boundary >= count ? { index: count - 1, where: "after" } : { index: boundary, where: "before" };
}

/** Inserts a row/column at `boundary` (0 = before the first, n = after the last) of the table at `tablePos`. */
export function insertAtBoundary(view: EditorView, tablePos: number, axis: Axis, boundary: number): boolean {
  const node = view.state.doc.nodeAt(tablePos);
  if (!node || node.type.name !== "table") return false;
  const map = TableMap.get(node);
  const { index, where } = insertionAt(boundary, axis === "row" ? map.height : map.width);
  const rel = axis === "row" ? map.map[index * map.width] : map.map[index];
  const cellPos = tablePos + 1 + rel; // start of the cell
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPos + 2)));
  const cmd =
    axis === "row"
      ? where === "before" ? addRowBeforeCmd : addRowAfterCmd
      : where === "before" ? addColumnBeforeCmd : addColumnAfterCmd;
  return cmd(view.state, view.dispatch);
}

const BTN = 18;

/**
 * While the pointer is over a table, shows one round "+" on its left edge (insert a row at the nearest row
 * boundary) or on its top edge (insert a column at the nearest column boundary), whichever is closer to the
 * pointer. The buttons live in an overlay next to the editor DOM, never in the document.
 */
export function tableControlsPlugin(): Plugin {
  return new Plugin({
    view(view) {
      const host = view.dom.parentElement;
      let current: { el: HTMLElement; axis: Axis; boundary: number } | null = null;
      const show = (b: HTMLElement, on: boolean): void => {
        b.classList.toggle("on", on);
      };
      const rowBtn = document.createElement("button");
      const colBtn = document.createElement("button");
      const hide = (): void => {
        current = null;
        show(rowBtn, false);
        show(colBtn, false);
      };
      const tablePosOf = (el: HTMLElement): number => {
        try {
          const $p = view.state.doc.resolve(view.posAtDOM(el, 0));
          for (let d = $p.depth; d > 0; d--) if ($p.node(d).type.name === "table") return $p.before(d);
          const after = $p.nodeAfter;
          return after && after.type.name === "table" ? $p.pos : -1;
        } catch {
          return -1;
        }
      };
      const setup = (b: HTMLButtonElement, axis: Axis, title: string): void => {
        b.type = "button";
        b.className = `tbl-add ${axis}`;
        b.title = title;
        b.textContent = "+";
        b.setAttribute("aria-label", title);
        b.addEventListener("mousedown", (e) => e.preventDefault()); // keep editor focus
        b.addEventListener("click", () => {
          if (!current || current.axis !== axis || !current.el.isConnected) return;
          const pos = tablePosOf(current.el);
          if (pos < 0) return;
          insertAtBoundary(view, pos, axis, current.boundary);
          hide();
          view.focus();
        });
      };
      setup(rowBtn, "row", "Insérer une ligne ici");
      setup(colBtn, "col", "Insérer une colonne ici");
      if (host) {
        if (getComputedStyle(host).position === "static") host.style.position = "relative";
        host.append(rowBtn, colBtn);
      }

      const nearest = (xs: number[], v: number): number =>
        xs.reduce((best, x, i) => (Math.abs(x - v) < Math.abs(xs[best] - v) ? i : best), 0);

      const onMove = (e: MouseEvent): void => {
        if (!host) return;
        const target = e.target as HTMLElement | null;
        if (target === rowBtn || target === colBtn) return; // keep what is shown
        const hit = target?.closest?.("table") as HTMLTableElement | null;
        let el = hit && view.dom.contains(hit) ? hit : null;
        if (!el) {
          // Pointer in the gutter just left of / above a table still counts as hovering it.
          for (const t of Array.from(view.dom.querySelectorAll("table"))) {
            const b = t.getBoundingClientRect();
            if (e.clientX >= b.left - 28 && e.clientX <= b.right && e.clientY >= b.top - 28 && e.clientY <= b.bottom) el = t;
          }
        }
        if (!el || el.rows.length === 0) return hide();
        const h = host.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        const rows = Array.from(el.rows);
        const ys = [...rows.map((tr) => tr.getBoundingClientRect().top), rows[rows.length - 1].getBoundingClientRect().bottom];
        const cells = Array.from(rows[0].cells);
        const xs = [
          ...cells.map((c) => c.getBoundingClientRect().left),
          cells.length ? cells[cells.length - 1].getBoundingClientRect().right : r.right,
        ];
        const bi = nearest(ys, e.clientY);
        const bj = nearest(xs, e.clientX);
        const dRow = Math.hypot(e.clientX - r.left, e.clientY - ys[bi]);
        const dCol = Math.hypot(e.clientX - xs[bj], e.clientY - r.top);
        const ox = host.scrollLeft - h.left;
        const oy = host.scrollTop - h.top;
        if (dRow <= dCol) {
          current = { el, axis: "row", boundary: bi };
          rowBtn.style.left = `${r.left + ox - BTN / 2}px`;
          rowBtn.style.top = `${ys[bi] + oy - BTN / 2}px`;
          show(rowBtn, true);
          show(colBtn, false);
        } else {
          current = { el, axis: "col", boundary: bj };
          colBtn.style.left = `${xs[bj] + ox - BTN / 2}px`;
          colBtn.style.top = `${r.top + oy - BTN / 2}px`;
          show(colBtn, true);
          show(rowBtn, false);
        }
      };
      host?.addEventListener("mousemove", onMove);
      host?.addEventListener("mouseleave", hide);
      return {
        update: hide, // the table may have moved or changed: wait for the next pointer move
        destroy() {
          host?.removeEventListener("mousemove", onMove);
          host?.removeEventListener("mouseleave", hide);
          rowBtn.remove();
          colBtn.remove();
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
