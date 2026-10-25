import { describe, expect, it } from "vitest";
import { generatePie, parsePie } from "./pie";
import { generateDiagram, parseDiagram, normalizeCode } from "./model";
import type { PieModel } from "./model";

const model: PieModel = {
  kind: "pie",
  title: "Temps passé",
  slices: [
    { label: "Dév", value: 60 },
    { label: "Réunions", value: 25 },
  ],
};

describe("pie model", () => {
  it("generates the exact format", () => {
    expect(generatePie(model)).toBe('pie title Temps passé\n    "Dév" : 60\n    "Réunions" : 25\n');
  });
  it("has no title on the first line without one", () => {
    expect(generatePie({ ...model, title: "" })).toBe('pie\n    "Dév" : 60\n    "Réunions" : 25\n');
  });
  it("round trips", () => {
    expect(parsePie(generatePie(model))).toEqual(model);
    const untitled = { ...model, title: "" };
    expect(parsePie(generatePie(untitled))).toEqual(untitled);
  });
  it("is strict: comments and showData make it unreadable", () => {
    expect(parsePie('pie title T\n    "a" : 1\n    %% commentaire\n')).toBeNull();
    expect(parsePie('pie showData\n    "a" : 1\n')).toBeNull();
    expect(parsePie('pie\n  "a" : 1\n')).toBeNull(); // 2-space indentation is not what the workshop writes
    expect(parsePie('pie\n    "a" : 1.50\n')).toBeNull();
  });
  it("round trips decimals", () => {
    const m: PieModel = { kind: "pie", title: "", slices: [{ label: "a", value: 1.5 }] };
    expect(parsePie(generatePie(m))).toEqual(m);
  });
  it("accepts CRLF and trailing spaces (normalised)", () => {
    expect(parsePie('pie title T  \r\n    "a" : 1  \r\n')).toEqual({ kind: "pie", title: "T", slices: [{ label: "a", value: 1 }] });
  });
  it("round trips a quote in a label through #quot;", () => {
    const m: PieModel = { kind: "pie", title: "", slices: [{ label: 'dit "oui"', value: 2 }] };
    expect(generatePie(m)).toBe('pie\n    "dit #quot;oui#quot;" : 2\n');
    expect(parsePie(generatePie(m))).toEqual(m);
  });
  it("dispatches through parseDiagram / generateDiagram", () => {
    expect(parseDiagram(generatePie(model))).toEqual(model);
    expect(generateDiagram(model)).toBe(generatePie(model));
    expect(parseDiagram("sequenceDiagram\n    A->>B: hi\n")).toBeNull();
    expect(parseDiagram("")).toBeNull();
  });
  it("normalizeCode", () => {
    expect(normalizeCode("a  \r\nb\n\n\n")).toBe("a\nb\n");
  });
});
