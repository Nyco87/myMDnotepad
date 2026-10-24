import { lift } from "prosemirror-commands";
import { liftListItem } from "prosemirror-schema-list";
import type { EditorState, Command } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { isInTable } from "prosemirror-tables";
import { getSettings, saveSettings } from "../api";
import {
  insertCodeBlock,
  insertHorizontalRule,
  insertLink,
  setHeading,
  toggleMark,
  wrapIn,
} from "../editor/keymap";
import { pickAndInsertImage } from "../editor/images";
import { insertTable, pickTableSize } from "../editor/tables";
import { showContextMenu } from "./context-menu";
import { openEmojiPalette, pushRecent } from "./emoji-palette";

export interface ToolbarHandle {
  /**
   * Re-reads the active editor and updates the highlighted buttons. The toolbar already listens to
   * `selectionchange` and refreshes after its own actions; call this when the editor changes without a
   * selection change (e.g. a tab switch swapped the EditorView, or setMarkdown).
   */
  refresh(): void;
}

/* ------------------------------------------------------------------ */
/* State helpers                                                       */
/* ------------------------------------------------------------------ */

type MarkName = "strong" | "em" | "strike" | "code" | "link";

function markActive(state: EditorState, name: MarkName): boolean {
  const type = state.schema.marks[name];
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks || $from.marks());
  return state.doc.rangeHasMark(from, to, type);
}

function insideNode(state: EditorState, name: string): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d >= 1; d--) if ($from.node(d).type.name === name) return true;
  return false;
}

function headingLevel(state: EditorState): number {
  const parent = state.selection.$from.parent;
  return parent.type.name === "heading" ? (parent.attrs.level as number) : 0;
}

/** Range of the link around the selection (or the selection itself), plus its href. */
function linkAt(state: EditorState): { from: number; to: number; href: string } | null {
  const linkType = state.schema.marks.link;
  const { $from, from, to, empty } = state.selection;
  if (!empty) {
    let href: string | null = null;
    state.doc.nodesBetween(from, to, (n) => {
      const m = linkType.isInSet(n.marks);
      if (m && href === null) href = m.attrs.href as string;
    });
    return href === null ? null : { from, to, href };
  }
  const mark = linkType.isInSet($from.marks());
  if (!mark) return null;
  const start = $from.start();
  let a = -1;
  let b = -1;
  $from.parent.forEach((child, offset) => {
    if (!child.isText || !mark.isInSet(child.marks)) return;
    const cs = start + offset;
    const ce = cs + child.nodeSize;
    if (a < 0 && cs <= from && from <= ce) {
      a = cs;
      b = ce;
    } else if (a >= 0 && cs === b) b = ce;
  });
  return a < 0 ? null : { from: a, to: b, href: mark.attrs.href as string };
}

const URL_LIKE = /^(https?:\/\/|www\.)\S+$/i;

/* ------------------------------------------------------------------ */
/* Link popover                                                        */
/* ------------------------------------------------------------------ */

/** Small URL field under `anchor`. Enter -> onDone(value, trimmed; "" removes the link); Escape -> onDone(null). */
function openLinkPopover(anchor: HTMLElement, initial: string, onDone: (href: string | null) => void): void {
  document.querySelector(".link-pop")?.remove();
  const pop = document.createElement("div");
  pop.className = "link-pop";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "https://…";
  input.value = initial;
  input.setAttribute("aria-label", "Adresse du lien");
  pop.appendChild(input);

  const close = (): void => {
    document.removeEventListener("mousedown", onOutside, true);
    pop.remove();
  };
  const onOutside = (e: MouseEvent): void => {
    if (!pop.contains(e.target as Node)) close();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const value = input.value.trim();
      close();
      onDone(value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      onDone(null);
    }
  });

  document.body.appendChild(pop);
  const a = anchor.getBoundingClientRect();
  pop.style.left = `${Math.max(0, Math.min(a.left, window.innerWidth - pop.offsetWidth - 4))}px`;
  pop.style.top = `${a.bottom + 4}px`;
  document.addEventListener("mousedown", onOutside, true);
  input.focus();
  input.select();
}

/* ------------------------------------------------------------------ */
/* Toolbar                                                             */
/* ------------------------------------------------------------------ */

interface ButtonDef {
  id: string;
  label: string;
  title: string;
  className?: string;
  active?: (s: EditorState) => boolean;
  /** Plain command run on the editor. */
  command?: (s: EditorState) => Command;
  /** Popup / async action. */
  run?: (btn: HTMLButtonElement, view: EditorView) => void | Promise<void>;
  /** CSS selector of the popup this button opens (a second click on the button then only closes it). */
  popup?: string;
}

type ListBlock = "blockquote" | "bullet_list" | "ordered_list" | "task_list";

/**
 * Formatting bar. `getView` is called on every action/refresh, so the editor can be swapped (tabs).
 * `getNoteRel` is the current note (used by the image button); defaults to "".
 * Active state follows `selectionchange`; see `ToolbarHandle.refresh` for other cases.
 */
export function mountToolbar(
  el: HTMLElement,
  getView: () => EditorView | null,
  getNoteRel: () => string = () => "",
): ToolbarHandle {
  el.classList.add("toolbar");
  el.setAttribute("role", "toolbar");
  el.setAttribute("aria-label", "Mise en forme");
  el.textContent = "";

  const inNode = (name: string) => (s: EditorState) => insideNode(s, name);

  /** Wraps the selection, or unwraps it when already inside that block. */
  const toggleBlock = (type: ListBlock) => (s: EditorState): Command => {
    if (!insideNode(s, type)) return wrapIn(type);
    if (type === "blockquote") return lift;
    const item = type === "task_list" ? "task_item" : "list_item";
    return (st, d) => liftListItem(st.schema.nodes[item])(st, d);
  };

  const groups: ButtonDef[][] = [
    [
      { id: "bold", label: "G", title: "Gras (Ctrl+B)", className: "b-bold", active: (s) => markActive(s, "strong"), command: () => toggleMark("strong") },
      { id: "italic", label: "I", title: "Italique (Ctrl+I)", className: "b-italic", active: (s) => markActive(s, "em"), command: () => toggleMark("em") },
      { id: "strike", label: "S", title: "Barré (Ctrl+Maj+X)", className: "b-strike", active: (s) => markActive(s, "strike"), command: () => toggleMark("strike") },
      { id: "code", label: "</>", title: "Code en ligne (Ctrl+E)", className: "b-code", active: (s) => markActive(s, "code"), command: () => toggleMark("code") },
    ],
    [], // the heading dropdown goes here
    [
      { id: "bullet", label: "•≡", title: "Liste à puces", active: inNode("bullet_list"), command: toggleBlock("bullet_list") },
      { id: "ordered", label: "1≡", title: "Liste numérotée", active: inNode("ordered_list"), command: toggleBlock("ordered_list") },
      { id: "task", label: "☑", title: "Liste de tâches (Ctrl+Entrée pour cocher)", active: inNode("task_list"), command: toggleBlock("task_list") },
    ],
    [
      { id: "quote", label: "❝", title: "Citation", active: inNode("blockquote"), command: toggleBlock("blockquote") },
      {
        id: "codeblock",
        label: "{ }",
        title: "Bloc de code",
        active: (s) => s.selection.$from.parent.type.name === "code_block",
        command: (s) => (s.selection.$from.parent.type.name === "code_block" ? setHeading(0) : insertCodeBlock()),
      },
      {
        id: "table",
        label: "⊞",
        title: "Tableau",
        active: (s) => isInTable(s),
        popup: ".size-picker",
        run: async (btn, view) => {
          const size = await pickTableSize(btn);
          if (size && !view.isDestroyed) {
            insertTable(size.rows, size.cols)(view.state, view.dispatch);
            view.focus();
          }
        },
      },
      {
        id: "link",
        label: "🔗",
        title: "Lien",
        active: (s) => markActive(s, "link"),
        popup: ".link-pop",
        run: (btn, view) => {
          const state = view.state;
          const existing = linkAt(state);
          const { from, to, empty } = state.selection;
          const selected = empty ? "" : state.doc.textBetween(from, to).trim();
          const initial = existing?.href ?? (URL_LIKE.test(selected) ? selected : "");
          openLinkPopover(btn, initial, (href) => {
            if (view.isDestroyed) return;
            if (href !== null) {
              const linkType = view.state.schema.marks.link;
              if (href === "") {
                if (existing) view.dispatch(view.state.tr.removeMark(existing.from, existing.to, linkType));
              } else if (existing) {
                const tr = view.state.tr.removeMark(existing.from, existing.to, linkType);
                view.dispatch(tr.addMark(existing.from, existing.to, linkType.create({ href })));
              } else {
                insertLink(href)(view.state, view.dispatch);
              }
            }
            view.focus();
            refresh();
          });
        },
      },
      {
        id: "image",
        label: "🖼",
        title: "Image",
        run: async (_btn, view) => {
          try {
            await pickAndInsertImage(view, getNoteRel());
          } catch (err) {
            console.error("image insert failed", err);
          }
          if (!view.isDestroyed) view.focus();
        },
      },
      { id: "hr", label: "―", title: "Ligne horizontale", command: () => insertHorizontalRule() },
    ],
    [
      {
        id: "emoji",
        label: "😀",
        title: "Emoji",
        popup: ".emoji-palette",
        run: async (btn, view) => {
          const settings = await getSettings();
          openEmojiPalette(btn, settings.recent_emojis, (e) => {
            if (!view.isDestroyed) {
              view.dispatch(view.state.tr.insertText(e).scrollIntoView());
              view.focus();
            }
            void (async () => {
              const fresh = await getSettings(); // re-read: never overwrite other settings with a stale copy
              await saveSettings({ ...fresh, recent_emojis: pushRecent(fresh.recent_emojis, e) });
            })().catch((err) => console.error("recent emojis not saved", err));
          });
        },
      },
    ],
  ];

  const buttons: { def: ButtonDef; btn: HTMLButtonElement }[] = [];
  /** Whether the button's popup was open at mousedown time (outside-click handlers close it first). */
  const wasOpen = new WeakMap<HTMLElement, boolean>();
  const trackPopup = (btn: HTMLElement, selector: string): void => {
    // Window capture runs before the popups' own document-capture "outside click" handlers.
    window.addEventListener(
      "mousedown",
      (e) => {
        if (btn.contains(e.target as Node)) wasOpen.set(btn, !!document.querySelector(selector));
      },
      true,
    );
  };
  /** True when this click only closes the popup that the mousedown found open. */
  const closesPopup = (btn: HTMLElement): boolean => {
    const was = wasOpen.get(btn) === true;
    wasOpen.set(btn, false);
    return was;
  };

  const makeButton = (def: ButtonDef): HTMLButtonElement => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tb-btn" + (def.className ? ` ${def.className}` : "");
    btn.dataset.id = def.id;
    btn.textContent = def.label;
    btn.title = def.title;
    btn.setAttribute("aria-label", def.title);
    btn.addEventListener("mousedown", (e) => e.preventDefault()); // never steal focus from the editor
    if (def.popup) trackPopup(btn, def.popup);
    btn.addEventListener("click", () => {
      const view = getView();
      if (!view) return;
      if (def.popup && closesPopup(btn)) return;
      if (def.command) {
        def.command(view.state)(view.state, view.dispatch, view);
        view.focus();
      } else if (def.run) {
        void Promise.resolve(def.run(btn, view)).catch((err) => console.error(err));
      }
      refresh();
    });
    buttons.push({ def, btn });
    return btn;
  };

  const headingBtn = document.createElement("button");
  headingBtn.type = "button";
  headingBtn.className = "tb-btn tb-heading";
  headingBtn.dataset.id = "heading";
  headingBtn.title = "Style de titre (Ctrl+1 à Ctrl+6, Ctrl+0 pour un paragraphe)";
  headingBtn.setAttribute("aria-label", "Style de titre");
  headingBtn.setAttribute("aria-haspopup", "menu");
  headingBtn.addEventListener("mousedown", (e) => e.preventDefault());
  trackPopup(headingBtn, ".ctx-menu");
  headingBtn.addEventListener("click", () => {
    const view = getView();
    if (!view || closesPopup(headingBtn)) return;
    const r = headingBtn.getBoundingClientRect();
    const levels = [0, 1, 2, 3, 4, 5, 6] as const;
    showContextMenu(
      r.left,
      r.bottom + 4,
      levels.map((l) => ({
        label: l === 0 ? "Paragraphe (Ctrl+0)" : `Titre ${l} (Ctrl+${l})`,
        action: () => {
          if (view.isDestroyed) return;
          setHeading(l)(view.state, view.dispatch);
          view.focus();
          refresh();
        },
      })),
    );
  });

  groups.forEach((group, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "tb-sep";
      el.appendChild(sep);
    }
    if (i === 1) el.appendChild(headingBtn);
    for (const def of group) el.appendChild(makeButton(def));
  });

  function refresh(): void {
    const view = getView();
    const state = view && !view.isDestroyed ? view.state : null;
    for (const { def, btn } of buttons) {
      const on = !!state && !!def.active && def.active(state);
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", String(on));
    }
    const level = state ? headingLevel(state) : 0;
    headingBtn.textContent = (level > 0 ? `Titre ${level}` : "Paragraphe") + " ▾";
    headingBtn.classList.toggle("active", level > 0);
  }

  document.addEventListener("selectionchange", refresh);
  refresh();
  return { refresh };
}
