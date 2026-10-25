import { codeLines, strict, type GanttModel, type GanttTask } from "./model";

/** Date `AAAA-MM-JJ` qui existe vraiment au calendrier. */
export function isValidDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

const KEYWORDS = ["title", "dateFormat", "axisFormat", "excludes", "includes", "todayMarker", "click", "section", "tickInterval", "weekday"];

/** Mot-clé Gantt par lequel le nom commence (mermaid le lirait comme une directive), sinon null. */
export function ganttKeyword(name: string): string | null {
  const w = /^\s*(\S+)(?=\s|$)/.exec(name)?.[1] ?? "";
  return KEYWORDS.find((k) => k.toLowerCase() === w.toLowerCase()) ?? null;
}

/** Les identifiants `t1`…`tN` suivent l'ordre global des tâches. */
export function generateGantt(m: GanttModel): string {
  const ids = new Map<string, string>();
  let n = 0;
  for (const s of m.sections) for (const t of s.tasks) ids.set(t.id, `t${++n}`);
  const lines = ["gantt"];
  if (m.title !== "") lines.push(`    title ${m.title}`);
  lines.push("    dateFormat YYYY-MM-DD");
  for (const s of m.sections) {
    lines.push(`    section ${s.name}`);
    for (const t of s.tasks) {
      const start = "date" in t.start ? t.start.date : `after ${ids.get(t.start.after) ?? t.start.after}`;
      lines.push(`    ${t.name} :${ids.get(t.id)}, ${start}, ${t.days}d`);
    }
  }
  return lines.join("\n") + "\n";
}

const TASK = /^ {4}([^:#]+?) :(t\d+), (\d{4}-\d{2}-\d{2}|after t\d+), ([1-9]\d*)d$/;

export function parseGantt(code: string): GanttModel | null {
  const lines = codeLines(code);
  if (lines[0] !== "gantt") return null;
  const model: GanttModel = { kind: "gantt", title: "", sections: [] };
  let rest = lines.slice(1);
  const title = /^ {4}title (.+)$/.exec(rest[0] ?? "");
  if (title) {
    if (title[1].includes("#")) return null;
    model.title = title[1];
    rest = rest.slice(1);
  }
  if (rest[0] !== "    dateFormat YYYY-MM-DD") return null;
  for (const line of rest.slice(1)) {
    const section = /^ {4}section ([^:#]+)$/.exec(line);
    if (section) {
      model.sections.push({ name: section[1], tasks: [] });
      continue;
    }
    const m = TASK.exec(line);
    const current = model.sections[model.sections.length - 1];
    if (!m || !current || ganttKeyword(m[1])) return null;
    const date = m[3].startsWith("after ") ? null : m[3];
    if (date !== null && !isValidDate(date)) return null;
    const task: GanttTask = {
      id: m[2],
      name: m[1],
      start: date !== null ? { date } : { after: m[3].slice("after ".length) },
      days: Number(m[4]),
    };
    current.tasks.push(task);
  }
  const known = new Set(model.sections.flatMap((s) => s.tasks.map((t) => t.id)));
  const dangling = model.sections.some((s) => s.tasks.some((t) => "after" in t.start && !known.has(t.start.after)));
  return dangling ? null : strict(code, model, generateGantt);
}
