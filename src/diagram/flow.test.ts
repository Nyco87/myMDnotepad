import { describe, expect, it } from "vitest";
import { generateFlow, parseFlow } from "./flow";
import { parseDiagram, type FlowModel } from "./model";

const model: FlowModel = {
  kind: "flow",
  direction: "TD",
  nodes: [
    { id: "n1", label: "Idée", shape: "rect" },
    { id: "n2", label: "Validée ?", shape: "decision" },
    { id: "n3", label: "Développer", shape: "rect" },
    { id: "n4", label: "Abandon", shape: "round" },
  ],
  edges: [
    { from: "n1", to: "n2", label: "" },
    { from: "n2", to: "n3", label: "oui" },
    { from: "n2", to: "n4", label: "non" },
  ],
};

const CODE = `flowchart TD
    n1["Idée"]
    n2{"Validée ?"}
    n3["Développer"]
    n4("Abandon")
    n1 --> n2
    n2 -->|"oui"| n3
    n2 -->|"non"| n4
`;

describe("flow model", () => {
  it("generates the exact format", () => {
    expect(generateFlow(model)).toBe(CODE);
  });
  it("round trips", () => {
    expect(parseFlow(CODE)).toEqual(model);
    expect(parseDiagram(CODE)).toEqual(model);
  });
  it("covers the four shapes and both directions", () => {
    const m: FlowModel = {
      kind: "flow",
      direction: "LR",
      nodes: [
        { id: "n1", label: "Idée", shape: "rect" },
        { id: "n2", label: "Validée ?", shape: "decision" },
        { id: "n3", label: "Abandon", shape: "round" },
        { id: "n4", label: "Fin", shape: "circle" },
      ],
      edges: [
        { from: "n1", to: "n2", label: "" },
        { from: "n2", to: "n3", label: "oui" },
      ],
    };
    expect(generateFlow(m)).toBe(
      'flowchart LR\n    n1["Idée"]\n    n2{"Validée ?"}\n    n3("Abandon")\n    n4(("Fin"))\n    n1 --> n2\n    n2 -->|"oui"| n3\n',
    );
    expect(parseFlow(generateFlow(m))).toEqual(m);
  });
  it("renumbers ids on generation and drops edges of removed nodes", () => {
    const m: FlowModel = {
      ...model,
      nodes: [
        { id: "a", label: "A", shape: "rect" },
        { id: "c", label: "C", shape: "rect" },
      ],
      edges: [
        { from: "a", to: "b", label: "" }, // b was deleted
        { from: "a", to: "c", label: "x" },
      ],
    };
    expect(generateFlow(m)).toBe('flowchart TD\n    n1["A"]\n    n2["C"]\n    n1 -->|"x"| n2\n');
  });
  it("is strict", () => {
    expect(parseFlow('graph TD\n    n1["a"]\n')).toBeNull();
    expect(parseFlow('flowchart TD\n    n1["a"]\n    style n1 fill:#f00\n')).toBeNull();
    expect(parseFlow('flowchart TD\n    n1["a"]\n    classDef x fill:#f00\n')).toBeNull();
    expect(parseFlow("flowchart TD\n    A[Idée]\n    A --> B\n")).toBeNull();
    expect(parseFlow('flowchart TD\n    subgraph s\n    n1["a"]\n    end\n')).toBeNull();
    expect(parseFlow('flowchart TD\n    n2["a"]\n')).toBeNull(); // ids must be n1…nN in order
    expect(parseFlow('flowchart TD\n    n1["a"]\n    n1 --> n9\n')).toBeNull(); // arrow to an unknown box
    expect(parseFlow('flowchart TD\n    n1["a"]\n    %% note\n')).toBeNull();
    expect(parseFlow('flowchart TD\n    n1["a"]\n    n2["b"]\n    n1 --- n2\n')).toBeNull();
    expect(parseFlow('flowchart TD\n    n1["a"]\n    n1 -->|""| n1\n')).toBeNull();
  });
  it("keeps an orphan box", () => {
    const m: FlowModel = { kind: "flow", direction: "TD", nodes: [{ id: "n1", label: "Seul", shape: "rect" }], edges: [] };
    expect(parseFlow(generateFlow(m))).toEqual(m);
  });
  it("round trips a quote in labels through #quot;", () => {
    const m: FlowModel = {
      kind: "flow",
      direction: "TD",
      nodes: [
        { id: "n1", label: 'Dit "oui"', shape: "rect" },
        { id: "n2", label: "B", shape: "rect" },
      ],
      edges: [{ from: "n1", to: "n2", label: 'a "b"' }],
    };
    const code = generateFlow(m);
    expect(code).toContain('n1["Dit #quot;oui#quot;"]');
    expect(code).toContain('n1 -->|"a #quot;b#quot;"| n2');
    expect(parseFlow(code)).toEqual(m);
  });
  it("an empty diagram keeps only its header", () => {
    const m: FlowModel = { kind: "flow", direction: "LR", nodes: [], edges: [] };
    expect(generateFlow(m)).toBe("flowchart LR\n");
    expect(parseFlow("flowchart LR\n")).toEqual(m);
  });
});
