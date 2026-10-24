import type { NodeViewConstructor } from "prosemirror-view";

/**
 * task_item node view: `li > [checkbox, div.task-content]`. The div is the contentDOM
 * (paragraph + nested blocks); clicking the checkbox toggles the `checked` attribute.
 */
export const taskItemView: NodeViewConstructor = (initial, view, getPos) => {
  let node = initial;
  const dom = document.createElement("li");
  dom.setAttribute("data-type", "task_item");
  const box = document.createElement("input");
  box.type = "checkbox";
  box.className = "task-box";
  box.contentEditable = "false";
  const contentDOM = document.createElement("div");
  contentDOM.className = "task-content";
  dom.append(box, contentDOM);

  const sync = (): void => {
    const checked = !!node.attrs.checked;
    box.checked = checked;
    dom.setAttribute("data-checked", String(checked));
  };
  sync();

  box.addEventListener("mousedown", (e) => e.preventDefault()); // keep the editor selection
  box.addEventListener("click", () => {
    // No preventDefault: cancelling would make the browser restore the old state after our sync().
    const pos = getPos();
    if (pos === undefined || !view.editable) return;
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: !node.attrs.checked }));
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
    stopEvent: (e) => e.target === box,
    ignoreMutation: (m) => m.target === box || (m.type === "attributes" && m.target === dom),
  };
};
