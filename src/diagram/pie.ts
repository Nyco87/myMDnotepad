import { codeLines, strict, type PieModel } from "./model";

/** Un guillemet dans un libellé s'écrit `#quot;` (mermaid n'a pas d'autre échappement). */
const esc = (s: string): string => s.replace(/"/g, "#quot;");
const unesc = (s: string): string => s.replace(/#quot;/g, '"');

export function generatePie(m: PieModel): string {
  const head = m.title === "" ? "pie" : `pie title ${m.title}`;
  return [head, ...m.slices.map((s) => `    "${esc(s.label)}" : ${s.value}`)].join("\n") + "\n";
}

export function parsePie(code: string): PieModel | null {
  const lines = codeLines(code);
  const head = /^pie(?: title (.+))?$/.exec(lines[0] ?? "");
  if (!head) return null;
  const slices: PieModel["slices"] = [];
  for (const line of lines.slice(1)) {
    const m = /^ {4}"(.*)" : (\d+(?:\.\d+)?)$/.exec(line);
    if (!m) return null;
    slices.push({ label: unesc(m[1]), value: Number(m[2]) });
  }
  return strict(code, { kind: "pie", title: head[1] ?? "", slices }, generatePie);
}
