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
  return c ? `Le caractère « ${c} » n'est pas autorisé ici.` : null;
}

const NEEDS_NAME = "Donnez un nom.";

/** Erreurs qui empêchent d'insérer le schéma. Le champ `where` « model » concerne le schéma entier. */
export function validateModel(m: DiagramModel): ModelError[] {
  const errors: ModelError[] = [];
  const add = (where: string, message: string): void => void errors.push({ where, message });
  switch (m.kind) {
    case "pie":
      if (m.slices.length === 0) add("model", "Ajoutez au moins une part.");
      m.slices.forEach((s, i) => {
        if (s.label.trim() === "") add(`slice.${i}.label`, NEEDS_NAME);
        if (!Number.isFinite(s.value) || s.value < 0) add(`slice.${i}.value`, "Entrez un nombre positif ou nul.");
      });
      break;
    case "flow":
      if (m.nodes.length === 0) add("model", "Ajoutez au moins une case.");
      m.nodes.forEach((n, i) => {
        if (n.label.trim() === "") add(`node.${i}.label`, NEEDS_NAME);
      });
      break;
    case "state":
      if (m.states.length === 0) add("model", "Ajoutez au moins un état.");
      m.states.forEach((s, i) => {
        if (s.label.trim() === "") add(`state.${i}.label`, NEEDS_NAME);
      });
      break;
    case "gantt": {
      const ids = new Set(m.sections.flatMap((s) => s.tasks.map((t) => t.id)));
      if (ids.size === 0) add("model", "Ajoutez au moins une tâche.");
      if (m.title.includes("#")) add("title", "Le caractère « # » n'est pas autorisé ici.");
      let n = 0;
      m.sections.forEach((s, si) => {
        if (s.name.trim() === "") add(`section.${si}.name`, NEEDS_NAME);
        else {
          const bad = forbiddenChar(s.name);
          if (bad) add(`section.${si}.name`, bad);
        }
        s.tasks.forEach((t) => {
          const i = n++;
          if (t.name.trim() === "") add(`task.${i}.name`, NEEDS_NAME);
          else {
            const bad = forbiddenChar(t.name);
            const word = ganttKeyword(t.name);
            if (bad) add(`task.${i}.name`, bad);
            else if (word) add(`task.${i}.name`, `Ce nom ne peut pas commencer par « ${word} ».`);
          }
          if ("date" in t.start) {
            if (!isValidDate(t.start.date)) add(`task.${i}.start`, "Date invalide (AAAA-MM-JJ).");
          } else if (!ids.has(t.start.after)) add(`task.${i}.start`, "Choisissez une tâche qui existe.");
          if (!Number.isInteger(t.days) || t.days < 1) add(`task.${i}.days`, "Entrez un nombre de jours entier, au moins 1.");
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
    if (total > 100) return [{ where: "pie.total", message: `Le total dépasse 100 (actuellement ${total}).` }];
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
