import { describe, expect, it } from "vitest";
import { generateGantt, parseGantt } from "./gantt";
import { generateDiagram, parseDiagram, type GanttModel } from "./model";

const model: GanttModel = {
  kind: "gantt",
  title: "Projet",
  sections: [
    {
      name: "Conception",
      tasks: [
        { id: "t1", name: "Maquettes", start: { date: "2026-10-26" }, days: 3 },
        { id: "t2", name: "Specs", start: { after: "t1" }, days: 2 },
      ],
    },
  ],
};

const CODE = `gantt
    title Projet
    dateFormat YYYY-MM-DD
    section Conception
    Maquettes :t1, 2026-10-26, 3d
    Specs :t2, after t1, 2d
`;

describe("gantt model", () => {
  it("generates the exact format", () => {
    expect(generateGantt(model)).toBe(CODE);
  });
  it("round trips", () => {
    expect(parseGantt(CODE)).toEqual(model);
    expect(parseDiagram(CODE)).toEqual(model);
    expect(generateDiagram(model)).toBe(CODE);
  });
  it("renumbers ids globally and follows renamed references", () => {
    const m: GanttModel = {
      kind: "gantt",
      title: "",
      sections: [
        { name: "A", tasks: [{ id: "x", name: "Un", start: { date: "2026-01-05" }, days: 1 }] },
        { name: "B", tasks: [{ id: "y", name: "Deux", start: { after: "x" }, days: 4 }] },
      ],
    };
    const code = "gantt\n    dateFormat YYYY-MM-DD\n    section A\n    Un :t1, 2026-01-05, 1d\n    section B\n    Deux :t2, after t1, 4d\n";
    expect(generateGantt(m)).toBe(code);
    expect(parseGantt(code)).toEqual({
      kind: "gantt",
      title: "",
      sections: [
        { name: "A", tasks: [{ id: "t1", name: "Un", start: { date: "2026-01-05" }, days: 1 }] },
        { name: "B", tasks: [{ id: "t2", name: "Deux", start: { after: "t1" }, days: 4 }] },
      ],
    });
  });
  it("after can point to a task of another section", () => {
    const code = "gantt\n    dateFormat YYYY-MM-DD\n    section A\n    Un :t1, 2026-01-05, 1d\n    section B\n    Deux :t2, after t1, 4d\n";
    expect(parseGantt(code)).not.toBeNull();
  });
  it("is strict", () => {
    const base = "gantt\n    dateFormat YYYY-MM-DD\n    section A\n";
    expect(parseGantt(base + "    Un :t1, 2026-01-05, 1d\n")).not.toBeNull();
    expect(parseGantt("gantt\n    dateFormat YYYY-MM-DD\n    excludes weekends\n    section A\n")).toBeNull();
    expect(parseGantt("gantt\n    dateFormat YYYY-MM-DD\n    axisFormat %d/%m\n    section A\n")).toBeNull();
    expect(parseGantt(base + "    Un :crit, t1, 2026-01-05, 1d\n")).toBeNull();
    expect(parseGantt(base + "    Un :milestone, t1, 2026-01-05, 0d\n")).toBeNull();
    expect(parseGantt(base + "    Un :t1, 2026-13-01, 1d\n")).toBeNull();
    expect(parseGantt(base + "    Un :t1, 2026-02-30, 1d\n")).toBeNull();
    expect(parseGantt(base + "    Un :t1, 2026-01-05, 0d\n")).toBeNull();
    expect(parseGantt(base + "    Un :t1, 2026-01-05, 1w\n")).toBeNull();
    expect(parseGantt(base + "    Un :t1, after t9, 1d\n")).toBeNull(); // dangling reference
    expect(parseGantt(base + "    Un :t5, 2026-01-05, 1d\n")).toBeNull(); // ids must be t1…tN in order
    expect(parseGantt("gantt\n    Un :t1, 2026-01-05, 1d\n")).toBeNull();
    expect(parseGantt("gantt\n    dateFormat DD/MM/YYYY\n")).toBeNull();
    expect(parseGantt(base + "    %% commentaire\n")).toBeNull();
  });
  it("an empty plan keeps its header", () => {
    const m: GanttModel = { kind: "gantt", title: "T", sections: [] };
    expect(generateGantt(m)).toBe("gantt\n    title T\n    dateFormat YYYY-MM-DD\n");
    expect(parseGantt(generateGantt(m))).toEqual(m);
  });
});

describe("gantt reserved words", () => {
  const base = "gantt\n    dateFormat YYYY-MM-DD\n    section A\n";
  it("parse rejects a task named like a directive, and a title with #", () => {
    expect(parseGantt(base + "    title Plan :t1, 2026-01-05, 1d\n")).toBeNull();
    expect(parseGantt(base + "    Section 2 :t1, 2026-01-05, 1d\n")).toBeNull();
    expect(parseGantt(base + "    Titles :t1, 2026-01-05, 1d\n")).not.toBeNull();
    expect(parseGantt("gantt\n    title a # b\n    dateFormat YYYY-MM-DD\n")).toBeNull();
  });
  it("validate explains in French", async () => {
    const { validateModel } = await import("./validate");
    const m: GanttModel = { kind: "gantt", title: "a#b", sections: [{ name: "S", tasks: [{ id: "t1", name: "click ici", start: { date: "2026-01-05" }, days: 1 }] }] };
    const msgs = validateModel(m).map((e) => e.message);
    expect(msgs).toContain("Ce nom ne peut pas commencer par « click ».");
    expect(validateModel(m).some((e) => e.where === "title")).toBe(true);
  });
});
