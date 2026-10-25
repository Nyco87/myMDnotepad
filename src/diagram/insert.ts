import { Fragment, type NodeType } from "prosemirror-model";
import { Selection, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { WorkshopOptions } from "./workshop";

/** Ouvre l'atelier (chargé à la demande : il n'est pas sur le chemin critique du démarrage). */
export type OpenWorkshop = (opts: WorkshopOptions) => Promise<string | null>;

const lazyOpen: OpenWorkshop = (opts) => import("./workshop").then((m) => m.openDiagramWorkshop(opts));

/** Le texte d'un bloc de code ne se termine pas par une fin de ligne : celle de l'atelier est retirée. */
const blockText = (code: string): string => code.replace(/\n+$/, "");

const isMermaid = (node: { type: NodeType; attrs: Record<string, unknown> } | null | undefined): boolean =>
  !!node && node.type.name === "code_block" && node.attrs.language === "mermaid";

/**
 * Insère un schéma : à la place d'un paragraphe vide, sinon après le bloc du curseur. Si le schéma est le dernier
 * bloc, un paragraphe vide le suit pour continuer à écrire.
 */
export function insertDiagramCode(view: EditorView, code: string): void {
  const { state } = view;
  const { code_block: codeBlock, paragraph } = state.schema.nodes;
  const text = blockText(code);
  const block = codeBlock.create({ language: "mermaid" }, text ? state.schema.text(text) : null);
  const { $from } = state.selection;
  const tr = state.tr;

  let at = -1;
  let replaceTo = -1;
  let container = $from.node(0);
  let index = 0;
  if ($from.parent.isTextblock && $from.parent.content.size === 0 && $from.depth > 0) {
    const parent = $from.node($from.depth - 1);
    const i = $from.index($from.depth - 1);
    if (parent.canReplaceWith(i, i + 1, codeBlock)) {
      at = $from.before();
      replaceTo = $from.after();
      container = parent;
      index = i;
    }
  }
  if (at < 0) {
    for (let d = $from.depth; d >= 0 && at < 0; d--) {
      const parent = $from.node(d);
      const i = d === $from.depth && !$from.parent.isTextblock ? $from.index() : $from.indexAfter(d);
      if (parent.canReplaceWith(i, i, codeBlock)) {
        at = d === $from.depth && !$from.parent.isTextblock ? $from.pos : $from.after(d + 1);
        replaceTo = at;
        container = parent;
        index = i;
      }
    }
  }
  if (at < 0) return;

  tr.replaceWith(at, replaceTo, block);
  const after = at + block.nodeSize;
  const next = replaceTo === at ? index : index + 1; // index of what followed, in the old container
  if (next >= container.childCount && container.canReplaceWith(next, next, paragraph)) {
    tr.insert(after, paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, after + 1));
  } else tr.setSelection(Selection.near(tr.doc.resolve(after), 1));
  view.dispatch(tr.scrollIntoView());
}

/** Remplace le code du schéma qui commence à `pos` (une seule transaction : un Ctrl+Z restaure l'ancien code). */
export function replaceDiagramCode(view: EditorView, pos: number, code: string): boolean {
  const node = view.state.doc.nodeAt(pos);
  if (!node || !isMermaid(node)) return false;
  const text = blockText(code);
  if (text === node.textContent) return true;
  const content = text ? Fragment.from(view.state.schema.text(text)) : Fragment.empty;
  view.dispatch(view.state.tr.replaceWith(pos + 1, pos + 1 + node.content.size, content).scrollIntoView());
  return true;
}

/** Position du schéma de code `code` : `pos` s'il y est encore, sinon l'unique schéma qui porte ce code, sinon -1. */
function locate(view: EditorView, pos: number, code: string): number {
  const here = view.state.doc.nodeAt(pos);
  if (isMermaid(here) && here!.textContent === code) return pos;
  const found: number[] = [];
  view.state.doc.descendants((node, p) => {
    if (isMermaid(node) && node.textContent === code) found.push(p);
    return !node.isTextblock;
  });
  return found.length === 1 ? found[0] : -1;
}

/** Clic sur un dessin : ouvre l'atelier avec son code, puis remplace le code si l'utilisateur valide. */
export async function editDiagramAt(
  view: EditorView,
  pos: number,
  code: string,
  notify: (message: string) => void,
  open: OpenWorkshop = lazyOpen,
): Promise<void> {
  let result: string | null;
  try {
    result = await open({ code });
  } catch (e) {
    notify(`L'atelier de schémas n'a pas pu s'ouvrir : ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  if (result === null || view.isDestroyed) return;
  const at = locate(view, pos, code);
  if (at < 0) {
    notify("Le schéma a changé entre-temps : votre modification n'a pas été appliquée.");
    return;
  }
  replaceDiagramCode(view, at, result);
  view.focus();
}

/** Bouton « Schéma » et commande « / » : crée un schéma à l'emplacement du curseur. */
export async function createDiagram(view: EditorView, notify: (message: string) => void, open: OpenWorkshop = lazyOpen): Promise<void> {
  let result: string | null;
  try {
    result = await open({});
  } catch (e) {
    notify(`L'atelier de schémas n'a pas pu s'ouvrir : ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  if (result === null || view.isDestroyed) return;
  insertDiagramCode(view, result);
  view.focus();
}
