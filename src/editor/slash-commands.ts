import type { Command } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { ALERTS, insertAlert } from "./alerts";
import { insertCodeBlock, insertHorizontalRule, setHeading, wrapIn } from "./keymap";
import { ALERT_KINDS } from "../markdown/alert-kinds";

export type SlashGroup = "Blocs" | "Alertes" | "Insérer";

export interface SlashCommand {
  id: string;
  label: string;
  /** Extra search words (compared without accents or case). */
  keywords: string[];
  icon: string;
  group: SlashGroup;
  /** Still offered inside a table cell (a cell holds a single paragraph of inline content). */
  inCell: boolean;
  run(view: EditorView): void;
}

/** Actions that open a window or popup; provided by the app (main.ts) because they depend on the toolbar and the dialogs. */
export interface SlashActions {
  table(view: EditorView): void;
  link(view: EditorView): void;
  image(view: EditorView): void;
  symbols(view: EditorView): void;
  /** Diagram workshop. When absent, the « Schéma » command is not listed. */
  diagram?(view: EditorView): void;
}

type Cmd = (view: EditorView) => void;

/** Runs a ProseMirror command on the view and keeps the focus in the editor. */
const command =
  (c: Command): Cmd =>
  (view) => {
    c(view.state, view.dispatch, view);
    view.focus();
  };

export function buildSlashCommands(actions: SlashActions): SlashCommand[] {
  const block = (id: string, label: string, icon: string, keywords: string[], run: Cmd): SlashCommand => ({
    id,
    label,
    keywords,
    icon,
    group: "Blocs",
    inCell: false,
    run,
  });
  const insert = (id: string, label: string, icon: string, keywords: string[], inCell: boolean, run: Cmd): SlashCommand => ({
    id,
    label,
    keywords,
    icon,
    group: "Insérer",
    inCell,
    run,
  });

  const list: SlashCommand[] = [
    block("h1", "Titre 1", "H1", ["titre", "heading", "h1"], command(setHeading(1))),
    block("h2", "Titre 2", "H2", ["titre", "heading", "h2"], command(setHeading(2))),
    block("h3", "Titre 3", "H3", ["titre", "heading", "h3"], command(setHeading(3))),
    block("paragraph", "Paragraphe", "¶", ["texte", "normal"], command(setHeading(0))),
    block("bullet", "Liste à puces", "•≡", ["liste", "puces", "ul"], command(wrapIn("bullet_list"))),
    block("ordered", "Liste numérotée", "1≡", ["liste", "numero", "ol"], command(wrapIn("ordered_list"))),
    block("task", "Tâches", "☑", ["todo", "case", "checkbox"], command(wrapIn("task_list"))),
    block("quote", "Citation", "❝", ["quote", "blockquote"], command(wrapIn("blockquote"))),
    block("code", "Bloc de code", "{ }", ["code"], command(insertCodeBlock())),
    block("table", "Tableau", "⊞", ["table", "grille"], (view) => actions.table(view)),
    insert("link", "Lien", "🔗", ["url", "link"], true, (view) => actions.link(view)),
    insert("image", "Image", "🖼", ["photo", "img"], true, (view) => actions.image(view)),
    block("hr", "Séparateur", "―", ["ligne", "hr"], command(insertHorizontalRule())),
    insert("symbols", "Symboles", "Ω", ["emoji"], true, (view) => actions.symbols(view)),
  ];
  const diagram = actions.diagram;
  if (diagram) list.push(insert("diagram", "Schéma", "🔀", ["mermaid", "diagramme"], false, (view) => diagram(view)));

  const alertWords: Record<string, string[]> = {
    note: ["info"],
    tip: ["tip", "conseil"],
    important: [],
    warning: ["warning", "avertissement"],
    caution: ["caution", "erreur"],
  };
  for (const kind of ALERT_KINDS) {
    list.push({
      id: `alert-${kind}`,
      label: `Alerte — ${ALERTS[kind].label}`,
      keywords: ["alerte", ...alertWords[kind]],
      icon: ALERTS[kind].icon,
      group: "Alertes",
      inCell: false,
      run: command(insertAlert(kind)),
    });
  }
  return list;
}
