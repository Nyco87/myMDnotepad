import { t as tx } from "../../i18n";
import type { StateModel } from "../model";
import { paintErrors, validateModel } from "../validate";
import { addButton, clone, el, errorSlot, label, moveItem, rowTools, selectBox, textInput, uid } from "./ui";

/**
 * Briques des états : des états, des transitions (de → vers, nom facultatif), le point de départ ● (vers un état)
 * et le ou les points de fin ◉ (depuis des états). Renvoie la fonction de démontage.
 */
export function mountStateEditor(root: HTMLElement, model: StateModel, onChange: (m: StateModel) => void): () => void {
  const m = clone(model);
  const emit = (): void => {
    paintErrors(root, validateModel(m));
    onChange(clone(m));
  };
  const name = (i: number): string => m.states[i].label.trim() || tx("ws.state.unnamed", { n: i + 1 });
  const options = (): { value: string; label: string }[] => m.states.map((s, i) => ({ value: s.id, label: name(i) }));
  const refreshNames = (): void => {
    root.querySelectorAll<HTMLSelectElement>("select.ws-node-sel").forEach((select) => {
      m.states.forEach((s, i) => {
        const opt = Array.from(select.options).find((o) => o.value === s.id);
        if (opt) opt.textContent = name(i);
      });
    });
    root.querySelectorAll<HTMLElement>("[data-end-for]").forEach((span) => {
      const i = m.states.findIndex((s) => s.id === span.dataset.endFor);
      if (i >= 0) span.textContent = name(i);
    });
  };

  const render = (): void => {
    root.textContent = "";
    root.appendChild(label(tx("ws.state.states")));
    m.states.forEach((s, i) => {
      const row = el("div", "ws-row");
      row.append(
        textInput(s.label, tx("ws.state.name"), (v) => {
          s.label = v;
          refreshNames();
          emit();
        }),
        rowTools(i, m.states.length, {
          move(dir) {
            moveItem(m.states, i, dir);
            render();
            emit();
          },
          remove() {
            const [gone] = m.states.splice(i, 1);
            m.transitions = m.transitions.filter((t) => t.from !== gone.id && t.to !== gone.id);
            m.ends = m.ends.filter((id) => id !== gone.id);
            if (m.start === gone.id) m.start = null;
            render();
            emit();
          },
        }),
      );
      root.append(row, errorSlot(`state.${i}.label`));
    });
    root.appendChild(
      addButton(tx("ws.state.add"), () => {
        m.states.push({ id: uid("s"), label: "" });
        render();
        emit();
        root.querySelectorAll<HTMLInputElement>(".ws-row input")[m.states.length - 1]?.focus();
      }),
    );

    root.appendChild(label(tx("ws.state.transitions")));
    m.transitions.forEach((t, i) => {
      const row = el("div", "ws-row");
      const from = selectBox(options(), t.from, tx("ws.from"), (v) => {
        t.from = v;
        emit();
      });
      const to = selectBox(options(), t.to, tx("ws.to"), (v) => {
        t.to = v;
        emit();
      });
      from.classList.add("ws-node-sel");
      to.classList.add("ws-node-sel");
      row.append(
        from,
        el("span", "ws-arrow", "→"),
        to,
        textInput(t.label, tx("ws.state.transName"), (v) => {
          t.label = v;
          emit();
        }, "ws-in ws-short"),
        rowTools(i, m.transitions.length, {
          move(dir) {
            moveItem(m.transitions, i, dir);
            render();
            emit();
          },
          remove() {
            m.transitions.splice(i, 1);
            render();
            emit();
          },
        }),
      );
      root.appendChild(row);
    });
    const addT = addButton(tx("ws.state.addTransition"), () => {
      if (m.states.length === 0) return;
      const last = m.states.length - 1;
      m.transitions.push({ from: m.states[Math.max(0, last - 1)].id, to: m.states[last].id, label: "" });
      render();
      emit();
    });
    addT.disabled = m.states.length === 0;
    root.appendChild(addT);

    root.appendChild(label(tx("ws.state.startEnd")));
    const startRow = el("div", "ws-row");
    const startBox = el("input");
    startBox.type = "checkbox";
    startBox.checked = m.start !== null;
    startBox.disabled = m.states.length === 0;
    startBox.setAttribute("aria-label", tx("ws.state.startAria"));
    const startSel = selectBox(options(), m.start ?? m.states[0]?.id ?? "", tx("ws.state.startState"), (v) => {
      m.start = v;
      emit();
    });
    startSel.classList.add("ws-node-sel");
    startSel.disabled = m.start === null;
    startBox.addEventListener("change", () => {
      m.start = startBox.checked ? (startSel.value || (m.states[0]?.id ?? null)) : null;
      startSel.disabled = !startBox.checked;
      emit();
    });
    const startLbl = el("label", "ws-check");
    startLbl.append(startBox, document.createTextNode(tx("ws.state.startLabel")));
    startRow.append(startLbl, startSel);
    root.appendChild(startRow);

    const endsLbl = el("div", "ws-inline-lbl", tx("ws.state.endLabel"));
    root.appendChild(endsLbl);
    const ends = el("div", "ws-checks");
    m.states.forEach((s, i) => {
      const lab = el("label", "ws-check");
      const box = el("input");
      box.type = "checkbox";
      box.checked = m.ends.includes(s.id);
      box.addEventListener("change", () => {
        m.ends = box.checked ? [...m.ends, s.id] : m.ends.filter((id) => id !== s.id);
        emit();
      });
      const text = el("span", "", name(i));
      text.dataset.endFor = s.id;
      lab.append(box, text);
      ends.appendChild(lab);
    });
    root.appendChild(ends);
    root.appendChild(errorSlot("model"));
    paintErrors(root, validateModel(m));
  };
  render();
  return () => {
    root.textContent = "";
  };
}
