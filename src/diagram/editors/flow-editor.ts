import type { FlowModel, FlowShape } from "../model";
import { paintErrors, validateModel } from "../validate";
import { addButton, clone, el, errorSlot, label, moveItem, rowTools, selectBox, textInput, uid } from "./ui";

const SHAPES: { value: FlowShape; label: string }[] = [
  { value: "rect", label: "▭ Rectangle" },
  { value: "round", label: "⬭ Arrondi" },
  { value: "decision", label: "◇ Décision" },
  { value: "circle", label: "○ Cercle" },
];

/**
 * Briques du flux : le sens, des cases (texte, forme) et des flèches (de → vers, texte facultatif).
 * Supprimer une case supprime ses flèches. Renvoie la fonction de démontage.
 */
export function mountFlowEditor(root: HTMLElement, model: FlowModel, onChange: (m: FlowModel) => void): () => void {
  const m = clone(model);
  const emit = (): void => {
    paintErrors(root, validateModel(m));
    onChange(clone(m));
  };
  const name = (i: number): string => m.nodes[i].label.trim() || `(case ${i + 1})`;
  const nodeOptions = (): { value: string; label: string }[] => m.nodes.map((n, i) => ({ value: n.id, label: name(i) }));
  /** Réécrit le texte des listes de/vers quand un libellé change, sans reconstruire les champs en cours de saisie. */
  const refreshOptions = (): void => {
    root.querySelectorAll<HTMLSelectElement>("select.ws-node-sel").forEach((select) => {
      m.nodes.forEach((n, i) => {
        const opt = Array.from(select.options).find((o) => o.value === n.id);
        if (opt) opt.textContent = name(i);
      });
    });
  };

  const render = (): void => {
    root.textContent = "";
    const head = el("div", "ws-row");
    head.append(
      el("span", "ws-inline-lbl", "Sens"),
      selectBox(
        [
          { value: "TD", label: "Haut → Bas" },
          { value: "LR", label: "Gauche → Droite" },
        ],
        m.direction,
        "Sens du schéma",
        (v) => {
          m.direction = v as "TD" | "LR";
          emit();
        },
      ),
    );
    root.appendChild(head);

    root.appendChild(label("Cases"));
    m.nodes.forEach((n, i) => {
      const row = el("div", "ws-row");
      row.append(
        textInput(n.label, "Texte de la case", (v) => {
          n.label = v;
          refreshOptions();
          emit();
        }),
        selectBox(SHAPES, n.shape, "Forme", (v) => {
          n.shape = v as FlowShape;
          emit();
        }),
        rowTools(i, m.nodes.length, {
          move(dir) {
            moveItem(m.nodes, i, dir);
            render();
            emit();
          },
          remove() {
            const [gone] = m.nodes.splice(i, 1);
            m.edges = m.edges.filter((e) => e.from !== gone.id && e.to !== gone.id);
            render();
            emit();
          },
        }),
      );
      root.append(row, errorSlot(`node.${i}.label`));
    });
    root.appendChild(
      addButton("＋ Ajouter une case", () => {
        m.nodes.push({ id: uid("n"), label: "", shape: "rect" });
        render();
        emit();
        root.querySelectorAll<HTMLInputElement>(".ws-row input")[m.nodes.length - 1]?.focus();
      }),
    );

    root.appendChild(label("Flèches"));
    m.edges.forEach((e, i) => {
      const row = el("div", "ws-row");
      const from = selectBox(nodeOptions(), e.from, "De", (v) => {
        e.from = v;
        emit();
      });
      const to = selectBox(nodeOptions(), e.to, "Vers", (v) => {
        e.to = v;
        emit();
      });
      from.classList.add("ws-node-sel");
      to.classList.add("ws-node-sel");
      row.append(
        from,
        el("span", "ws-arrow", "→"),
        to,
        textInput(e.label, "Texte", (v) => {
          e.label = v;
          emit();
        }, "ws-in ws-short"),
        rowTools(i, m.edges.length, {
          move(dir) {
            moveItem(m.edges, i, dir);
            render();
            emit();
          },
          remove() {
            m.edges.splice(i, 1);
            render();
            emit();
          },
        }),
      );
      root.appendChild(row);
    });
    const arrow = addButton("＋ Ajouter une flèche", () => {
      if (m.nodes.length === 0) return;
      const last = m.nodes.length - 1;
      m.edges.push({ from: m.nodes[Math.max(0, last - 1)].id, to: m.nodes[last].id, label: "" });
      render();
      emit();
    });
    arrow.disabled = m.nodes.length === 0;
    root.appendChild(arrow);
    root.appendChild(errorSlot("model"));
    paintErrors(root, validateModel(m));
  };
  render();
  return () => {
    root.textContent = "";
  };
}
