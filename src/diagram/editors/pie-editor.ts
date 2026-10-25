import { t as tx } from "../../i18n";
import type { PieModel } from "../model";
import { paintErrors, validateModel, validateWarnings } from "../validate";
import { addButton, clone, el, errorSlot, label, moveItem, rowTools, textInput } from "./ui";

/** Briques du camembert : un titre et des parts (libellé, valeur ≥ 0). Renvoie la fonction de démontage. */
export function mountPieEditor(root: HTMLElement, model: PieModel, onChange: (m: PieModel) => void): () => void {
  const m = clone(model);
  const paint = (): void => {
    // Les avertissements (total > 100) sont non bloquants : ton orange, « Insérer » reste actif.
    paintErrors(root, [...validateModel(m), ...validateWarnings(m)]);
  };
  const emit = (): void => {
    paint();
    onChange(clone(m));
  };

  const render = (): void => {
    root.textContent = "";
    root.appendChild(label(tx("ws.titleLabel")));
    root.appendChild(
      textInput(m.title, tx("ws.pie.titlePh"), (v) => {
        m.title = v;
        emit();
      }),
    );
    root.appendChild(label(tx("ws.pie.slices")));
    m.slices.forEach((s, i) => {
      const row = el("div", "ws-row");
      row.append(
        textInput(s.label, tx("ws.pie.label"), (v) => {
          s.label = v;
          emit();
        }),
        textInput(Number.isNaN(s.value) ? "" : String(s.value), tx("ws.pie.value"), (v) => {
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
      addButton(tx("ws.pie.add"), () => {
        m.slices.push({ label: "", value: 0 });
        render();
        emit();
        root.querySelectorAll<HTMLInputElement>(".ws-row")[m.slices.length - 1]?.querySelector("input")?.focus();
      }),
    );
    root.appendChild(errorSlot("model"));
    const warn = errorSlot("pie.total");
    warn.classList.replace("ws-error", "ws-warning");
    warn.setAttribute("role", "status");
    root.appendChild(warn);
    paint();
  };
  render();
  return () => {
    root.textContent = "";
  };
}
