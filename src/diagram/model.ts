import { generateFlow, parseFlow } from "./flow";
import { generatePie, parsePie } from "./pie";

/** Modèles « briques » des schémas de l'atelier. Chaque type a un parseur strict et un générateur déterministe. */

export type DiagramKind = "pie" | "flow" | "state" | "gantt";

export type PieModel = { kind: "pie"; title: string; slices: { label: string; value: number }[] };

export type FlowShape = "rect" | "round" | "decision" | "circle";
export type FlowModel = {
  kind: "flow";
  direction: "TD" | "LR";
  nodes: { id: string; label: string; shape: FlowShape }[];
  edges: { from: string; to: string; label: string }[];
};

export type StateModel = {
  kind: "state";
  states: { id: string; label: string }[];
  transitions: { from: string; to: string; label: string }[];
  start: string | null;
  ends: string[];
};

export type GanttTask = { id: string; name: string; start: { date: string } | { after: string }; days: number };
export type GanttModel = { kind: "gantt"; title: string; sections: { name: string; tasks: GanttTask[] }[] };

export type DiagramModel = PieModel | FlowModel | StateModel | GanttModel;

/** `\r\n` → `\n`, espaces de fin de ligne retirés, un seul `\n` final. */
export function normalizeCode(code: string): string {
  return code
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n*$/, "\n");
}

/** Lignes d'un code normalisé, sans la ligne vide finale. */
export function codeLines(code: string): string[] {
  const lines = normalizeCode(code).split("\n");
  lines.pop();
  return lines;
}

/**
 * Règle stricte commune : le modèle n'est accepté que si le code régénéré est identique au code d'origine
 * (à la normalisation des espaces près). Sinon l'atelier ouvre le code tel quel.
 */
export function strict<M extends DiagramModel>(code: string, model: M | null, generate: (m: M) => string): M | null {
  return model !== null && generate(model) === normalizeCode(code) ? model : null;
}

export function parseDiagram(code: string): DiagramModel | null {
  const first = codeLines(code)[0] ?? "";
  const word = /^[A-Za-z][\w-]*/.exec(first)?.[0];
  switch (word) {
    case "pie":
      return parsePie(code);
    case "flowchart":
      return parseFlow(code);
    default:
      return null;
  }
}

export function generateDiagram(m: DiagramModel): string {
  switch (m.kind) {
    case "pie":
      return generatePie(m);
    case "flow":
      return generateFlow(m);
    default:
      throw new Error(`Type de schéma non pris en charge : ${m.kind}`);
  }
}
