import type { Command } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { ALERTS, insertAlert } from "./alerts";
import { insertCodeBlock, insertHorizontalRule, setHeading, wrapIn } from "./keymap";
import { ALERT_KINDS } from "../markdown/alert-kinds";
import { t, tIn, type Key } from "../i18n";

/** Identifiants des groupes (pas des textes affichés : voir `groupLabel`). */
export type SlashGroup = "Blocs" | "Alertes" | "Insérer";

export const groupLabel = (g: SlashGroup): string => t(`slash.group.${g}` as Key);

/** Mots-clés d'une commande dans les DEUX langues (la recherche marche quelle que soit la langue de l'interface). */
const keywordsOf = (key: Key): string[] => [
  ...new Set([...tIn("fr", key).split(","), ...tIn("en", key).split(",")].filter(Boolean)),
];

export interface SlashCommand {
  id: string;
  /** Texte affiché, dans la langue courante. */
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
  const block = (id: string, label: Key, icon: string, run: Cmd): SlashCommand => ({
    id,
    get label() {
      return t(label);
    },
    keywords: keywordsOf(`slash.kw.${id}` as Key),
    icon,
    group: "Blocs",
    inCell: false,
    run,
  });
  const insert = (id: string, label: Key, icon: string, inCell: boolean, run: Cmd): SlashCommand => ({
    id,
    get label() {
      return t(label);
    },
    keywords: keywordsOf(`slash.kw.${id}` as Key),
    icon,
    group: "Insérer",
    inCell,
    run,
  });

  const list: SlashCommand[] = [
    block("h1", "slash.h1", "H1", command(setHeading(1))),
    block("h2", "slash.h2", "H2", command(setHeading(2))),
    block("h3", "slash.h3", "H3", command(setHeading(3))),
    block("paragraph", "slash.paragraph", "¶", command(setHeading(0))),
    block("bullet", "slash.bullet", "•≡", command(wrapIn("bullet_list"))),
    block("ordered", "slash.ordered", "1≡", command(wrapIn("ordered_list"))),
    block("task", "slash.task", "☑", command(wrapIn("task_list"))),
    block("quote", "slash.quote", "❝", command(wrapIn("blockquote"))),
    block("code", "slash.code", "{ }", command(insertCodeBlock())),
    block("table", "toolbar.table", "⊞", (view) => actions.table(view)),
    insert("link", "toolbar.link", "🔗", true, (view) => actions.link(view)),
    insert("image", "toolbar.image", "🖼", true, (view) => actions.image(view)),
    block("hr", "slash.hr", "―", command(insertHorizontalRule())),
    insert("symbols", "toolbar.symbols", "Ω", true, (view) => actions.symbols(view)),
  ];
  const diagram = actions.diagram;
  if (diagram) list.push(insert("diagram", "toolbar.diagram", "🔀", false, (view) => diagram(view)));

  for (const kind of ALERT_KINDS) {
    list.push({
      id: `alert-${kind}`,
      get label() {
        return t("slash.alert", { kind: ALERTS[kind].label });
      },
      keywords: keywordsOf(`slash.kw.alert-${kind}` as Key),
      icon: ALERTS[kind].icon,
      group: "Alertes",
      inCell: false,
      run: command(insertAlert(kind)),
    });
  }
  return list;
}
