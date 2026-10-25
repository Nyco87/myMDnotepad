import { t as tx } from "../i18n";
import { ganttKeyword, isValidDate } from "./gantt";
import type { DiagramModel } from "./model";

/** Une erreur de saisie : `where` désigne le champ (voir `paintErrors`), `message` est en français. */
export interface ModelError {
  where: string;
  message: string;
}

/** Caractères que mermaid ne supporte pas dans un nom de tâche ou de section (Gantt). */
export function forbiddenChar(text: string): string | null {
  const c = /[:#]/.exec(text)?.[0];
  return c ? tx("v.forbidden", { c }) : null;
}

const needsName = (): string => tx("v.needsName");

/** Erreurs qui empêchent d'insérer le schéma. Le champ `where` « model » concerne le schéma entier. */
export function validateModel(m: DiagramModel): ModelError[] {
  const errors: ModelError[] = [];
  const add = (where: string, message: string): void => void errors.push({ where, message });
  switch (m.kind) {
    case "pie":
      if (m.slices.length === 0) add("model", tx("v.pieNone"));
      m.slices.forEach((s, i) => {
        if (s.label.trim() === "") add(`slice.${i}.label`, needsName());
        if (!Number.isFinite(s.value) || s.value < 0) add(`slice.${i}.value`, tx("v.pieValue"));
      });
      break;
    case "flow":
      if (m.nodes.length === 0) add("model", tx("v.flowNone"));
      m.nodes.forEach((n, i) => {
        if (n.label.trim() === "") add(`node.${i}.label`, needsName());
      });
      break;
    case "state":
      if (m.states.length === 0) add("model", tx("v.stateNone"));
      m.states.forEach((s, i) => {
        if (s.label.trim() === "") add(`state.${i}.label`, needsName());
      });
      break;
    case "gantt": {
      const ids = new Set(m.sections.flatMap((s) => s.tasks.map((t) => t.id)));
      if (ids.size === 0) add("model", tx("v.ganttNone"));
      if (m.title.includes("#")) add("title", tx("v.hashTitle"));
      let n = 0;
      m.sections.forEach((s, si) => {
        if (s.name.trim() === "") add(`section.${si}.name`, needsName());
        else {
          const bad = forbiddenChar(s.name);
          if (bad) add(`section.${si}.name`, bad);
        }
        s.tasks.forEach((t) => {
          const i = n++;
          if (t.name.trim() === "") add(`task.${i}.name`, needsName());
          else {
            const bad = forbiddenChar(t.name);
            const word = ganttKeyword(t.name);
            if (bad) add(`task.${i}.name`, bad);
            else if (word) add(`task.${i}.name`, tx("v.keyword", { word }));
          }
          if ("date" in t.start) {
            if (!isValidDate(t.start.date)) add(`task.${i}.start`, tx("v.badDate"));
          } else if (!ids.has(t.start.after)) add(`task.${i}.start`, tx("v.pickTask"));
          if (!Number.isInteger(t.days) || t.days < 1) add(`task.${i}.days`, tx("v.days"));
        });
      });
      break;
    }
  }
  return errors;
}

/** Total des parts valides d'un camembert (arrondi à 2 décimales pour éviter 99.99999). */
export function pieTotal(m: { slices: { value: number }[] }): number {
  const sum = m.slices.reduce((a, s) => a + (Number.isFinite(s.value) && s.value > 0 ? s.value : 0), 0);
  return Math.round(sum * 100) / 100;
}

/** Avertissements qui n'empêchent pas d'insérer le schéma (même forme que les erreurs). */
export function validateWarnings(m: DiagramModel): ModelError[] {
  if (m.kind === "pie") {
    const total = pieTotal(m);
    if (total > 100) return [{ where: "pie.total", message: tx("v.pieTotal", { total }) }];
  }
  return [];
}

/** Écrit les messages dans les éléments `[data-where]` de `root` (vide ceux sans erreur). */
export function paintErrors(root: HTMLElement, errors: ModelError[]): void {
  const byWhere = new Map<string, string>();
  for (const e of errors) if (!byWhere.has(e.where)) byWhere.set(e.where, e.message);
  root.querySelectorAll<HTMLElement>("[data-where]").forEach((node) => {
    node.textContent = byWhere.get(node.dataset.where!) ?? "";
  });
}
