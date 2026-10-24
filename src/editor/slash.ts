import { Plugin, TextSelection, type EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { SlashCommand, SlashGroup } from "./slash-commands";

export type { SlashCommand };

const GROUP_ORDER: SlashGroup[] = ["Blocs", "Alertes", "Insérer"];

/** Lowercase, without accents: « Tâches » and « taches » compare equal. */
export function normalizeForSearch(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** True inside a table cell or header. */
function inCell(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d >= 1; d--) {
    const n = $from.node(d).type.name;
    if (n === "table_cell" || n === "table_header") return true;
  }
  return false;
}

/**
 * The « /query » being typed before the cursor, or null. The slash must start the block or follow whitespace
 * (so `https://a/b`, `24/10`, `et/ou`, `C:/x` never open the menu) and the query holds no whitespace
 * (a space closes the menu). Never inside a code block or inline code.
 */
export function slashQuery(state: EditorState): { from: number; query: string } | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const { $from } = selection;
  const parent = $from.parent;
  if (!parent.isTextblock || parent.type.spec.code) return null;
  const marks = state.storedMarks ?? $from.marks();
  if (marks.some((m) => m.type.name === "code")) return null;
  // One character per leaf node (hard break, image…), so string offsets match document positions.
  const before = parent.textBetween(0, $from.parentOffset, undefined, "\n");
  const m = /(?:^|\s)\/([^\s/]*)$/.exec(before);
  if (!m) return null;
  if (/^\d+$/.test(m[1])) return null; // « 1 /2 » is a fraction, not a command
  return { from: $from.pos - m[1].length - 1, query: m[1] };
}

/**
 * Commands matching `query`, best first: label starts with it, a label word starts with it, a keyword starts with it,
 * then label / keyword contains it. An empty query lists everything grouped (Blocs, Alertes, Insérer).
 * Inside a table cell only the commands flagged `inCell` remain.
 */
export function filterCommands(cmds: SlashCommand[], query: string, cell: boolean): SlashCommand[] {
  const q = normalizeForSearch(query.trim());
  const pool = cell ? cmds.filter((c) => c.inCell) : cmds;
  const indexed = pool.map((c, i) => ({ c, i }));
  if (q === "") {
    return indexed
      .sort((a, b) => GROUP_ORDER.indexOf(a.c.group) - GROUP_ORDER.indexOf(b.c.group) || a.i - b.i)
      .map((x) => x.c);
  }
  const score = (c: SlashCommand): number => {
    const label = normalizeForSearch(c.label);
    const words = label.split(/[^a-z0-9]+/).filter(Boolean);
    const keys = c.keywords.map(normalizeForSearch);
    if (label.startsWith(q)) return 0;
    if (words.some((w) => w.startsWith(q))) return 1;
    if (keys.some((k) => k.startsWith(q))) return 2;
    if (label.includes(q)) return 3;
    if (keys.some((k) => k.includes(q))) return 4;
    return -1;
  };
  return indexed
    .map((x) => ({ ...x, s: score(x.c) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.c);
}

/**
 * A zero-size element at the cursor, for popups that anchor on an element (table size, link, symbols).
 * It removes itself right after the popup has measured it.
 */
export function cursorAnchor(view: EditorView): HTMLElement {
  const el = document.createElement("span");
  el.style.cssText = "position:fixed;width:0;height:0;pointer-events:none";
  try {
    const c = view.coordsAtPos(view.state.selection.from);
    el.style.left = `${c.left}px`;
    el.style.top = `${c.top}px`;
    el.style.height = `${c.bottom - c.top}px`;
  } catch {
    /* no layout (tests): stays at the origin */
  }
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 0);
  return el;
}

/**
 * « / » command menu. It opens under the cursor while a `/query` is typed, never takes the focus (keys come through
 * `handleKeyDown`) and shows at most 8 entries at a time (CSS `max-height`, the list scrolls). Enter / Tab or a click runs the command after removing the
 * `/query` text; Escape closes the menu and leaves the text.
 */
export function slashMenuPlugin(getCommands: () => SlashCommand[]): Plugin {
  let el: HTMLElement | null = null;
  let items: SlashCommand[] = [];
  let index = 0;
  let from = -1;
  let query: string | null = null;
  /** Position of the slash whose menu was closed with Escape: it stays closed until another slash is typed. */
  let dismissedFrom: number | null = null;

  const hide = (): void => {
    el?.remove();
    el = null;
    items = [];
    query = null;
  };

  const execute = (view: EditorView, cmd: SlashCommand): void => {
    const q = slashQuery(view.state);
    hide();
    if (q) view.dispatch(view.state.tr.delete(q.from, view.state.selection.from));
    cmd.run(view);
  };

  const highlight = (): void => {
    if (!el) return;
    [...el.querySelectorAll<HTMLElement>(".slash-item")].forEach((node, i) => {
      node.classList.toggle("on", i === index);
      node.setAttribute("aria-selected", String(i === index));
      if (i === index) node.scrollIntoView?.({ block: "nearest" });
    });
  };

  const render = (view: EditorView): void => {
    if (!el) {
      el = document.createElement("div");
      el.className = "slash-menu";
      el.setAttribute("role", "listbox");
      el.addEventListener("mousedown", (e) => e.preventDefault()); // never steal the editor focus
      document.body.appendChild(el);
    }
    el.replaceChildren();
    let group: SlashGroup | null = null;
    items.forEach((cmd, i) => {
      if (cmd.group !== group) {
        group = cmd.group;
        const g = document.createElement("div");
        g.className = "slash-group";
        g.textContent = cmd.group;
        el!.appendChild(g);
      }
      const row = document.createElement("div");
      row.className = "slash-item";
      row.setAttribute("role", "option");
      const icon = document.createElement("span");
      icon.className = "slash-icon";
      icon.textContent = cmd.icon;
      const label = document.createElement("span");
      label.className = "slash-label";
      label.textContent = cmd.label;
      row.append(icon, label);
      row.addEventListener("mouseenter", () => {
        index = i;
        highlight();
      });
      row.addEventListener("click", () => execute(view, cmd));
      el!.appendChild(row);
    });
    highlight();
    position(view);
  };

  const position = (view: EditorView): void => {
    if (!el) return;
    let left = 0;
    let top = 0;
    try {
      const c = view.coordsAtPos(view.state.selection.from);
      left = c.left;
      top = c.bottom + 4;
      const h = el.offsetHeight;
      if (h > 0 && top + h > window.innerHeight - 4 && c.top - 4 - h >= 0) top = c.top - 4 - h;
      if (el.offsetWidth > 0) left = Math.max(0, Math.min(left, window.innerWidth - el.offsetWidth - 4));
    } catch {
      /* no layout (tests) */
    }
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  };

  const refresh = (view: EditorView): void => {
    const q = slashQuery(view.state);
    if (!q) {
      dismissedFrom = null;
      hide();
      return;
    }
    if (q.from === dismissedFrom) {
      hide();
      return;
    }
    const found = filterCommands(getCommands(), q.query, inCell(view.state));
    if (found.length === 0) {
      hide();
      return;
    }
    if (q.query !== query || q.from !== from) index = 0;
    query = q.query;
    from = q.from;
    items = found;
    render(view);
  };

  return new Plugin({
    view(view) {
      refresh(view);
      return { update: refresh, destroy: hide };
    },
    props: {
      handleKeyDown(view, event) {
        if (!el || items.length === 0 || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return false;
        switch (event.key) {
          case "ArrowDown":
          case "ArrowUp":
            event.preventDefault();
            index = (index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
            highlight();
            return true;
          case "Enter":
          case "Tab":
            event.preventDefault();
            execute(view, items[index]);
            return true;
          case "Escape":
            event.preventDefault();
            dismissedFrom = from;
            hide();
            return true;
          default:
            return false;
        }
      },
      handleDOMEvents: {
        blur() {
          hide();
          return false;
        },
      },
    },
  });
}
