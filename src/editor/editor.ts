import { EditorState, Plugin, Selection, type Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { history } from "prosemirror-history";
import { baseKeymap } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { dropCursor } from "prosemirror-dropcursor";
import { gapCursor } from "prosemirror-gapcursor";
import { columnResizing, tableEditing } from "prosemirror-tables";
import type { Node as PMNode, Schema } from "prosemirror-model";
import type { NodeViewConstructor } from "prosemirror-view";
import { schema } from "../markdown/schema";
import { buildInputRules } from "./input-rules";
import { buildKeymap } from "./keymap";
import { tableControlsPlugin } from "./tables";
import { imageNodeView, imagePastePlugin } from "./images";
import { taskItemView } from "./task-item";
import { alertView } from "./alerts";
import { codeBlockView, type EditDiagram } from "./mermaid-view";
import { linkKeymap, linkOpenPlugin, type LinkHandlers } from "./links";
import { gapClickPlugin } from "./gap-click";
import { slashMenuPlugin, type SlashCommand } from "./slash";
import { parseMarkdown } from "../markdown/parse";
import { serializeMarkdown } from "../markdown/serialize";

export interface EditorHandle {
  view: EditorView;
  getMarkdown(): string;
  /** Replaces the document. Does not call onChange and resets the dirty baseline. */
  setMarkdown(md: string): void;
  /** True when the serialized document differs from the markdown last loaded (constructor/setMarkdown). */
  isDirty(): boolean;
  destroy(): void;
}

export interface EditorOptions {
  markdown: string;
  onChange: (md: string) => void;
  noteRel: string;
  /** Error message for the user (image paste failures). Read lazily, so it can be set after creation. */
  onError?: (message: string) => void;
  /** Commands of the « / » menu. Read lazily; without it the menu never opens. */
  slashCommands?: () => SlashCommand[];
  /** Click on a mermaid diagram: position of its code block and its code. Read lazily. */
  onEditDiagram?: EditDiagram;
  /** Ctrl+clic sur un lien : navigateur ou autre note. Read lazily; sans lui le Ctrl+clic ne fait rien. */
  links?: () => LinkHandlers;
}

/**
 * Plugin list. Later tasks extend this one place: input rules + keymap (task 8),
 * table controls (task 9), toolbar/image paste (task 10).
 */
function buildPlugins(schema: Schema, opts: EditorOptions): Plugin[] {
  const linkContext = () => ({ noteRel: opts.noteRel, handlers: opts.links?.() });
  return [
    // First: while the « / » menu is open it takes the arrow / Enter / Escape keys before the keymaps.
    slashMenuPlugin(() => opts.slashCommands?.() ?? []),
    history(),
    buildInputRules(schema),
    // Before baseKeymap: sticky-block Enter/ArrowDown must win over the defaults.
    buildKeymap(schema),
    linkKeymap(linkContext),
    linkOpenPlugin(linkContext),
    keymap(baseKeymap),
    dropCursor(),
    gapClickPlugin(),
    gapCursor(),
    columnResizing(),
    tableEditing(),
    tableControlsPlugin(),
    imagePastePlugin(() => opts.noteRel, (m) => (opts.onError ?? console.error)(m)),
  ];
}

/** Node views registered in one place. */
function buildNodeViews(opts: EditorOptions): Record<string, NodeViewConstructor> {
  return {
    image: imageNodeView(() => opts.noteRel),
    task_item: taskItemView,
    alert: alertView,
    code_block: codeBlockView(() => opts.onEditDiagram),
  };
}

export function createEditor(mount: HTMLElement, opts: EditorOptions): EditorHandle {
  let baseline = "";
  const makeState = (md: string): EditorState => {
    const doc: PMNode = parseMarkdown(md);
    baseline = serializeMarkdown(doc);
    return EditorState.create({ schema, doc, plugins: buildPlugins(schema, opts) });
  };

  // Un clic sur la zone vide sous le texte place le curseur à la fin de la note.
  const onPaneMouseDown = (e: MouseEvent): void => {
    if (e.target !== mount) return;
    e.preventDefault();
    view.focus();
    view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));
  };
  mount.addEventListener("mousedown", onPaneMouseDown);

  const view = new EditorView(mount, {
    state: makeState(opts.markdown),
    nodeViews: buildNodeViews(opts),
    dispatchTransaction(tr: Transaction) {
      const next = view.state.apply(tr);
      view.updateState(next);
      if (tr.docChanged) opts.onChange(serializeMarkdown(next.doc));
    },
  });

  return {
    view,
    getMarkdown: () => serializeMarkdown(view.state.doc),
    setMarkdown(md) {
      // A fresh state also drops undo history of the previous note.
      view.updateState(makeState(md));
    },
    isDirty: () => serializeMarkdown(view.state.doc) !== baseline,
    destroy() {
      mount.removeEventListener("mousedown", onPaneMouseDown);
      view.destroy();
    },
  };
}
