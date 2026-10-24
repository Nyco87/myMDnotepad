import { EditorState, Plugin, type Transaction } from "prosemirror-state";
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
}

/**
 * Plugin list. Later tasks extend this one place: input rules + keymap (task 8),
 * table controls (task 9), toolbar/image paste (task 10).
 */
function buildPlugins(_schema: Schema): Plugin[] {
  return [
    history(),
    keymap(baseKeymap),
    dropCursor(),
    gapCursor(),
    columnResizing(),
    tableEditing(),
  ];
}

/** Node views registered in one place (image nodeview comes in task 10). */
function buildNodeViews(_opts: EditorOptions): Record<string, NodeViewConstructor> {
  return {};
}

const SET_MARKDOWN_META = "mdnote-set-markdown";

export function createEditor(mount: HTMLElement, opts: EditorOptions): EditorHandle {
  let baseline = "";
  const makeState = (md: string): EditorState => {
    const doc: PMNode = parseMarkdown(md);
    baseline = serializeMarkdown(doc);
    return EditorState.create({ schema, doc, plugins: buildPlugins(schema) });
  };

  const view = new EditorView(mount, {
    state: makeState(opts.markdown),
    nodeViews: buildNodeViews(opts),
    dispatchTransaction(tr: Transaction) {
      const next = view.state.apply(tr);
      view.updateState(next);
      if (tr.docChanged && !tr.getMeta(SET_MARKDOWN_META)) opts.onChange(serializeMarkdown(next.doc));
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
    destroy: () => view.destroy(),
  };
}
