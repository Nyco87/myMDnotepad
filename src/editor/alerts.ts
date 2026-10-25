import { wrapIn } from "prosemirror-commands";
import type { Command } from "prosemirror-state";
import type { NodeViewConstructor } from "prosemirror-view";
import { ALERT_KINDS, type AlertKind } from "../markdown/alert-kinds";
import { t, tr, type Key } from "../i18n";
import { showContextMenu } from "../ui/context-menu";

export type { AlertKind };

/** Label, icon and fixed accent color of each GitHub alert kind. */
export const ALERTS: Record<AlertKind, { label: string; icon: string; color: string }> = {
  note: { get label() { return t("alert.note"); }, icon: "ℹ️", color: "#4493f8" },
  tip: { get label() { return t("alert.tip"); }, icon: "💡", color: "#3fb950" },
  important: { get label() { return t("alert.important"); }, icon: "❗", color: "#ab7df8" },
  warning: { get label() { return t("alert.warning"); }, icon: "⚠️", color: "#d29922" },
  caution: { get label() { return t("alert.caution"); }, icon: "🔴", color: "#f85149" },
};

/** Nearest alert around the selection: its position and node. */
function alertAround(state: Parameters<Command>[0]): { pos: number; attrs: Record<string, unknown> } | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d >= 1; d--) {
    const node = $from.node(d);
    if (node.type.name === "alert") return { pos: $from.before(d), attrs: node.attrs };
  }
  return null;
}

/** Changes the kind of the alert holding the selection. The original marker is dropped: `[!CAUTION]` is written. */
export function setAlertKind(kind: AlertKind): Command {
  return (state, dispatch) => {
    const found = alertAround(state);
    if (!found) return false;
    if (found.attrs.kind === kind) return true;
    if (dispatch) dispatch(state.tr.setNodeMarkup(found.pos, undefined, { ...found.attrs, kind, marker: null }));
    return true;
  };
}

/**
 * Inserts an alert: wraps the selected block(s) (an empty paragraph becomes an empty alert holding the cursor).
 * Inside an alert, changes its kind instead of nesting a new one.
 */
export function insertAlert(kind: AlertKind): Command {
  return (state, dispatch, view) => {
    if (alertAround(state)) return setAlertKind(kind)(state, dispatch);
    return wrapIn(state.schema.nodes.alert, { kind, marker: null, inline: false })(state, dispatch, view);
  };
}

/**
 * `alert` node view: a non-editable header (icon + colored label, click to change the kind) above the content.
 */
export const alertView: NodeViewConstructor = (initial, view, getPos) => {
  let node = initial;
  const dom = document.createElement("div");
  const title = document.createElement("div");
  title.className = "alert-title";
  title.contentEditable = "false";
  title.setAttribute("role", "button");
  tr(title, { title: "alert.change" });
  const icon = document.createElement("span");
  icon.className = "alert-icon";
  const label = document.createElement("span");
  label.className = "alert-label";
  title.append(icon, label);
  const contentDOM = document.createElement("div");
  contentDOM.className = "alert-body";
  dom.append(title, contentDOM);

  const sync = (): void => {
    const kind = node.attrs.kind as AlertKind;
    const info = ALERTS[kind] ?? ALERTS.note;
    dom.className = `alert alert-${kind}`;
    dom.setAttribute("data-alert", kind);
    icon.textContent = info.icon;
    tr(label, { text: `alert.${kind}` as Key });
  };
  sync();

  title.addEventListener("mousedown", (e) => e.preventDefault()); // keep the editor selection
  title.addEventListener("click", () => {
    const pos = getPos();
    if (pos === undefined || !view.editable) return;
    const r = title.getBoundingClientRect();
    showContextMenu(
      r.left,
      r.bottom + 2,
      ALERT_KINDS.map((kind) => ({
        label: ALERTS[kind].label,
        action: () => {
          if (view.isDestroyed) return;
          const at = getPos();
          if (at === undefined) return;
          const current = view.state.doc.nodeAt(at);
          if (!current || current.type.name !== "alert" || current.attrs.kind === kind) return;
          view.dispatch(view.state.tr.setNodeMarkup(at, undefined, { ...current.attrs, kind, marker: null }));
          view.focus();
        },
      })),
    );
  });

  return {
    dom,
    contentDOM,
    update(next) {
      if (next.type !== node.type) return false;
      node = next;
      sync();
      return true;
    },
    stopEvent: (e) => title.contains(e.target as Node),
    ignoreMutation: (m) => title.contains(m.target) || (m.type === "attributes" && m.target === dom),
  };
};
