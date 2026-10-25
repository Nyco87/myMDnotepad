import type { PieModel } from "../model";
import { paintErrors, validateModel } from "../validate";
import { addButton, clone, el, errorSlot, label, moveItem, rowTools, textInput } from "./ui";

/** Briques du camembert : un titre et des parts (libellé, valeur ≥ 0). Renvoie la fonction de démontage. */
export function mountPieEditor(root: HTMLElement, model: PieModel, onChange: (m: PieModel) => void): () => void {
  const m = clone(model);
  const emit = (): void => {
    paintErrors(root, validateModel(m));
    onChange(clone(m));
  };

  const render = (): void => {
    root.textContent = "";
    root.appendChild(label("Titre"));
    root.appendChild(
      textInput(m.title, "Titre du camembert (facultatif)", (v) => {
        m.title = v;
        emit();
      }),
    );
    root.appendChild(label("Parts"));
    m.slices.forEach((s, i) => {
      const row = el("div", "ws-row");
      row.append(
        textInput(s.label, "Libellé", (v) => {
          s.label = v;
          emit();
        }),
        textInput(Number.isNaN(s.value) ? "" : String(s.value), "Valeur", (v) => {
          s.value = v.trim() === "" ? NaN : Number(v.replace(",", "."));
          emit();
        }, "ws-in ws-num"),
        rowTools(i, m.slices.length, {
          move(dir) {
            moveItem(m.slices, i, dir);
            render();
            emit();
          },
          remove() {
            m.slices.splice(i, 1);
            render();
            emit();
          },
        }),
      );
      const errs = el("div", "ws-row-errors");
      errs.append(errorSlot(`slice.${i}.label`), errorSlot(`slice.${i}.value`));
      root.append(row, errs);
    });
    root.appendChild(
      addButton("＋ Ajouter une part", () => {
        m.slices.push({ label: "", value: 0 });
        render();
        emit();
        root.querySelectorAll<HTMLInputElement>(".ws-row")[m.slices.length - 1]?.querySelector("input")?.focus();
      }),
    );
    root.appendChild(errorSlot("model"));
    paintErrors(root, validateModel(m));
  };
  render();
  return () => {
    root.textContent = "";
  };
}
