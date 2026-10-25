import { describe, expect, it } from "vitest";
import { generateState, parseState } from "./state";
import { generateDiagram, parseDiagram, type StateModel } from "./model";

const model: StateModel = {
  kind: "state",
  states: [
    { id: "s1", label: "Idle" },
    { id: "s2", label: "Processing" },
    { id: "s3", label: "Done" },
    { id: "s4", label: "Error" },
  ],
  transitions: [
    { from: "s1", to: "s2", label: "submit" },
    { from: "s2", to: "s3", label: "complete" },
    { from: "s2", to: "s4", label: "fail" },
    { from: "s4", to: "s1", label: "retry" },
  ],
  start: "s1",
  ends: ["s3"],
};

const CODE = `stateDiagram-v2
    state "Idle" as s1
    state "Processing" as s2
    state "Done" as s3
    state "Error" as s4
    [*] --> s1
    s1 --> s2 : submit
    s2 --> s3 : complete
    s2 --> s4 : fail
    s4 --> s1 : retry
    s3 --> [*]
`;

describe("state model", () => {
  it("generates the exact format for the user's example", () => {
    expect(generateState(model)).toBe(CODE);
  });
  it("round trips", () => {
    expect(parseState(CODE)).toEqual(model);
    expect(parseDiagram(CODE)).toEqual(model);
    expect(generateDiagram(model)).toBe(CODE);
  });
  it("an unnamed transition has no colon, several ends are kept in order", () => {
    const m: StateModel = {
      kind: "state",
      states: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      transitions: [{ from: "a", to: "b", label: "" }],
      start: null,
      ends: ["b", "a"],
    };
    const code = 'stateDiagram-v2\n    state "A" as s1\n    state "B" as s2\n    s1 --> s2\n    s2 --> [*]\n    s1 --> [*]\n';
    expect(generateState(m)).toBe(code);
    expect(parseState(code)).toEqual({
      ...m,
      states: [
        { id: "s1", label: "A" },
        { id: "s2", label: "B" },
      ],
      transitions: [{ from: "s1", to: "s2", label: "" }],
      ends: ["s2", "s1"],
    });
  });
  it("drops what touches a removed state", () => {
    const m: StateModel = { ...model, states: model.states.filter((s) => s.id !== "s2") };
    const code = generateState(m);
    expect(code).toBe('stateDiagram-v2\n    state "Idle" as s1\n    state "Done" as s2\n    state "Error" as s3\n    [*] --> s1\n    s3 --> s1 : retry\n    s2 --> [*]\n');
  });
  it("is strict", () => {
    expect(parseState('stateDiagram\n    state "A" as s1\n')).toBeNull();
    expect(parseState('stateDiagram-v2\n    state X {\n    }\n')).toBeNull();
    expect(parseState('stateDiagram-v2\n    state "A" as s1\n    note right of s1 : hi\n')).toBeNull();
    expect(parseState('stateDiagram-v2\n    state "A" as s1\n    s1 --> [*] : done\n')).toBeNull();
    expect(parseState('stateDiagram-v2\n    [*] --> s1\n    state "A" as s1\n')).toBeNull(); // wrong line order
    expect(parseState('stateDiagram-v2\n    state "A" as s1\n    [*] --> s1\n    [*] --> s1\n')).toBeNull();
    expect(parseState('stateDiagram-v2\n    A --> B\n')).toBeNull();
    expect(parseState('stateDiagram-v2\n    state "A" as s1\n    s1 --> s9\n')).toBeNull();
  });
  it("round trips a quote in a state label", () => {
    const m: StateModel = { kind: "state", states: [{ id: "s1", label: 'Dit "ok"' }], transitions: [], start: "s1", ends: [] };
    expect(parseState(generateState(m))).toEqual(m);
  });
});
