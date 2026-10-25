import type { GanttModel, GanttTask } from "../model";
import { paintErrors, validateModel } from "../validate";
import { addButton, clone, el, errorSlot, label, moveItem, rowTools, selectBox, textInput, uid } from "./ui";

const today = (): string => new Date().toISOString().slice(0, 10);

/**
 * Briques du Gantt : un titre, des sections et des tâches (nom, début = date ou « après <tâche> », durée en jours).
 * Supprimer une tâche reporte son début sur celles qui venaient « après » elle. Renvoie la fonction de démontage.
 */
export function mountGanttEditor(root: HTMLElement, model: GanttModel, onChange: (m: GanttModel) => void): () => void {
  const m = clone(model);
  const emit = (): void => {
    paintErrors(root, validateModel(m));
    onChange(clone(m));
  };
  const allTasks = (): GanttTask[] => m.sections.flatMap((s) => s.tasks);
  const taskName = (t: GanttTask, i: number): string => t.name.trim() || `(tâche ${i + 1})`;
  const refreshNames = (): void => {
    const tasks = allTasks();
    root.querySelectorAll<HTMLSelectElement>("select.ws-task-sel").forEach((select) => {
      tasks.forEach((t, i) => {
        const opt = Array.from(select.options).find((o) => o.value === t.id);
        if (opt) opt.textContent = taskName(t, i);
      });
    });
  };

  /** Retire une tâche : celles qui commençaient « après » elle prennent son propre début. */
  const removeTask = (task: GanttTask): void => {
    for (const s of m.sections) {
      s.tasks = s.tasks.filter((t) => t !== task);
      for (const t of s.tasks) if ("after" in t.start && t.start.after === task.id) t.start = clone(task.start);
    }
  };

  const render = (): void => {
    root.textContent = "";
    root.appendChild(label("Titre"));
    root.appendChild(
      textInput(m.title, "Titre du planning (facultatif)", (v) => {
        m.title = v;
        emit();
      }),
    );
    root.appendChild(errorSlot("title"));
    root.appendChild(el("div", "ws-hint", "Format des dates : AAAA-MM-JJ"));

    let n = 0;
    m.sections.forEach((section, si) => {
      const box = el("div", "ws-section");
      const head = el("div", "ws-row");
      head.append(
        textInput(section.name, "Nom de la section", (v) => {
          section.name = v;
          emit();
        }, "ws-in ws-section-name"),
        rowTools(si, m.sections.length, {
          move(dir) {
            moveItem(m.sections, si, dir);
            render();
            emit();
          },
          remove() {
            for (const t of section.tasks.slice()) removeTask(t);
            m.sections.splice(si, 1);
            render();
            emit();
          },
        }),
      );
      box.append(head, errorSlot(`section.${si}.name`));

      section.tasks.forEach((t, ti) => {
        const i = n++;
        const row = el("div", "ws-row ws-task");
        const others = allTasks().filter((o) => o !== t);
        const afterSel = selectBox(
          others.map((o) => ({ value: o.id, label: taskName(o, allTasks().indexOf(o)) })),
          "after" in t.start ? t.start.after : (others[0]?.id ?? ""),
          "Après la tâche",
          (v) => {
            t.start = { after: v };
            emit();
          },
        );
        afterSel.classList.add("ws-task-sel");
        const dateIn = textInput("date" in t.start ? t.start.date : "", "AAAA-MM-JJ", (v) => {
          t.start = { date: v.trim() };
          emit();
        }, "ws-in ws-date");
        const kind = selectBox(
          [
            { value: "date", label: "Le" },
            { value: "after", label: "Après" },
          ],
          "date" in t.start ? "date" : "after",
          "Type de début",
          (v) => {
            if (v === "after") {
              if (others.length === 0) {
                kind.value = "date";
                return;
              }
              t.start = { after: others[0].id };
            } else t.start = { date: today() };
            render();
            emit();
          },
        );
        row.append(
          textInput(t.name, "Nom de la tâche", (v) => {
            t.name = v;
            refreshNames();
            emit();
          }, "ws-in ws-task-name"),
          kind,
          "date" in t.start ? dateIn : afterSel,
          textInput(String(t.days), "Jours", (v) => {
            t.days = v.trim() === "" ? NaN : Number(v);
            emit();
          }, "ws-in ws-num"),
          el("span", "ws-inline-lbl", "j"),
          rowTools(ti, section.tasks.length, {
            move(dir) {
              moveItem(section.tasks, ti, dir);
              render();
              emit();
            },
            remove() {
              removeTask(t);
              render();
              emit();
            },
          }),
        );
        const errs = el("div", "ws-row-errors");
        errs.append(errorSlot(`task.${i}.name`), errorSlot(`task.${i}.start`), errorSlot(`task.${i}.days`));
        box.append(row, errs);
      });
      box.appendChild(
        addButton("＋ Ajouter une tâche", () => {
          const previous = allTasks().pop();
          section.tasks.push({
            id: uid("t"),
            name: "",
            start: previous ? { after: previous.id } : { date: today() },
            days: 1,
          });
          render();
          emit();
          const inputs = root.querySelectorAll<HTMLInputElement>(".ws-task-name");
          inputs[inputs.length - 1]?.focus();
        }),
      );
      root.appendChild(box);
    });

    root.appendChild(
      addButton("＋ Ajouter une section", () => {
        m.sections.push({ name: `Section ${m.sections.length + 1}`, tasks: [] });
        render();
        emit();
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
