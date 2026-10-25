import { codeLines, strict, type StateModel } from "./model";

const esc = (s: string): string => s.replace(/"/g, "#quot;");
const unesc = (s: string): string => s.replace(/#quot;/g, '"');

/**
 * Ordre des lignes : les états, la flèche de départ, les transitions, les flèches de fin. Les identifiants
 * `s1`…`sN` suivent l'ordre des états ; ce qui touche un état absent est omis.
 */
export function generateState(m: StateModel): string {
  const ids = new Map<string, string>();
  m.states.forEach((s, i) => ids.set(s.id, `s${i + 1}`));
  const lines = ["stateDiagram-v2"];
  for (const s of m.states) lines.push(`    state "${esc(s.label)}" as ${ids.get(s.id)}`);
  const start = m.start === null ? undefined : ids.get(m.start);
  if (start) lines.push(`    [*] --> ${start}`);
  for (const t of m.transitions) {
    const from = ids.get(t.from);
    const to = ids.get(t.to);
    if (!from || !to) continue;
    lines.push(t.label === "" ? `    ${from} --> ${to}` : `    ${from} --> ${to} : ${t.label}`);
  }
  for (const id of m.ends) {
    const end = ids.get(id);
    if (end) lines.push(`    ${end} --> [*]`);
  }
  return lines.join("\n") + "\n";
}

const STATE = /^ {4}state "(.*)" as (s\d+)$/;
const START = /^ {4}\[\*\] --> (s\d+)$/;
const END = /^ {4}(s\d+) --> \[\*\]$/;
const TRANSITION = /^ {4}(s\d+) --> (s\d+)(?: : (.+))?$/;

export function parseState(code: string): StateModel | null {
  const lines = codeLines(code);
  if (lines[0] !== "stateDiagram-v2") return null;
  const model: StateModel = { kind: "state", states: [], transitions: [], start: null, ends: [] };
  for (const line of lines.slice(1)) {
    let m: RegExpExecArray | null;
    if ((m = STATE.exec(line))) model.states.push({ id: m[2], label: unesc(m[1]) });
    else if ((m = START.exec(line))) {
      if (model.start !== null) return null;
      model.start = m[1];
    } else if ((m = END.exec(line))) model.ends.push(m[1]);
    else if ((m = TRANSITION.exec(line))) model.transitions.push({ from: m[1], to: m[2], label: m[3] ?? "" });
    else return null;
  }
  return strict(code, model, generateState);
}
