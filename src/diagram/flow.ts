import { codeLines, strict, type FlowModel, type FlowShape } from "./model";

const esc = (s: string): string => s.replace(/"/g, "#quot;");
const unesc = (s: string): string => s.replace(/#quot;/g, '"');

const BRACKETS: Record<FlowShape, [string, string]> = {
  rect: ["[", "]"],
  round: ["(", ")"],
  decision: ["{", "}"],
  circle: ["((", "))"],
};

/** Les identifiants `n1`…`nN` suivent l'ordre des cases ; les flèches vers une case absente sont omises. */
export function generateFlow(m: FlowModel): string {
  const ids = new Map<string, string>();
  m.nodes.forEach((n, i) => ids.set(n.id, `n${i + 1}`));
  const lines = [`flowchart ${m.direction}`];
  for (const n of m.nodes) {
    const [open, close] = BRACKETS[n.shape];
    lines.push(`    ${ids.get(n.id)}${open}"${esc(n.label)}"${close}`);
  }
  for (const e of m.edges) {
    const from = ids.get(e.from);
    const to = ids.get(e.to);
    if (!from || !to) continue;
    lines.push(e.label === "" ? `    ${from} --> ${to}` : `    ${from} -->|"${esc(e.label)}"| ${to}`);
  }
  return lines.join("\n") + "\n";
}

const NODE = /^ {4}(n\d+)(\(\(|\[|\(|\{)"(.*)"(\)\)|\]|\)|\})$/;
const EDGE = /^ {4}(n\d+) -->(?:\|"(.*)"\|)? (n\d+)$/;
const SHAPES: Record<string, FlowShape> = { "[": "rect", "(": "round", "{": "decision", "((": "circle" };

export function parseFlow(code: string): FlowModel | null {
  const lines = codeLines(code);
  const head = /^flowchart (TD|LR)$/.exec(lines[0] ?? "");
  if (!head) return null;
  const model: FlowModel = { kind: "flow", direction: head[1] as "TD" | "LR", nodes: [], edges: [] };
  for (const line of lines.slice(1)) {
    const n = NODE.exec(line);
    if (n) {
      model.nodes.push({ id: n[1], label: unesc(n[3]), shape: SHAPES[n[2]] });
      continue;
    }
    const e = EDGE.exec(line);
    if (!e) return null;
    model.edges.push({ from: e[1], to: e[3], label: unesc(e[2] ?? "") });
  }
  return strict(code, model, generateFlow);
}
