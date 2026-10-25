// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./render", () => ({
  renderMermaid: vi.fn(async () => ({ ok: true, svg: "<svg><text>apercu</text></svg>" })),
}));

import { openDiagramWorkshop } from "./workshop";
import { renderMermaid } from "./render";
import { generatePie } from "./pie";

const render = vi.mocked(renderMermaid);

const q = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T;
const qa = <T extends HTMLElement = HTMLElement>(sel: string): T[] => [...document.querySelectorAll<T>(sel)];
const byText = (sel: string, text: string): HTMLElement => qa(sel).find((n) => n.textContent?.includes(text))!;
const setValue = (input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void => {
  input.value = value;
  input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
};
const tick = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

beforeEach(() => {
  render.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

const FLOW = ['flowchart TD', '    n1["A"]', '    n2["B"]', '    n1 --> n2', ''].join(String.fromCharCode(10));

describe("diagram workshop", () => {
  it("offers the four types and builds a pie from bricks", async () => {
    const result = openDiagramWorkshop({});
    const labels = qa(".ws-type").map((c) => c.textContent);
    expect(labels).toEqual(["🔀Flux / organigramme", "🥧Camembert", "📅Gantt (planning)", "🔁États"]);
    byText(".ws-type", "Camembert").click();
    expect(q(".ws-bricks")).not.toBeNull();
    byText("button.ws-add", "Ajouter une part").click();
    const [label, value] = qa<HTMLInputElement>(".ws-row input");
    setValue(label, "Dév");
    setValue(value, "60");
    expect(q<HTMLButtonElement>(".ws-insert").disabled).toBe(false);
    q(".ws-insert").click();
    expect(await result).toBe(generatePie({ kind: "pie", title: "", slices: [{ label: "Dév", value: 60 }] }));
    expect(q(".ws-overlay")).toBeNull();
  });

  it("Insérer is disabled until the schema is complete", () => {
    void openDiagramWorkshop({});
    byText(".ws-type", "Camembert").click();
    expect(q<HTMLButtonElement>(".ws-insert").disabled).toBe(true);
  });

  it("Annuler and Escape resolve null", async () => {
    const a = openDiagramWorkshop({});
    q(".ws-cancel").click();
    expect(await a).toBeNull();
    const b = openDiagramWorkshop({});
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(await b).toBeNull();
    expect(q(".ws-overlay")).toBeNull();
  });

  it("Escape inside a select does not close the workshop", async () => {
    const result = openDiagramWorkshop({ code: FLOW });
    const select = q<HTMLSelectElement>(".ws-overlay select");
    expect(select).not.toBeNull();
    select.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(q(".ws-overlay")).not.toBeNull();
    q(".ws-cancel").click();
    expect(await result).toBeNull();
  });

  it("preview links cannot navigate away", async () => {
    const result = openDiagramWorkshop({});
    const a = document.createElement("a");
    a.href = "https://example.com";
    q(".ws-right").appendChild(a);
    for (const type of ["click", "auxclick"]) {
      const ev = new MouseEvent(type, { bubbles: true, cancelable: true });
      a.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
    }
    q(".ws-cancel").click();
    await result;
  });

  it("opens the right editor, filled in, for readable code and returns it unchanged", async () => {
    const code = 'pie title Temps passé\n    "Dév" : 60\n    "Réunions" : 25\n';
    const result = openDiagramWorkshop({ code });
    expect(q(".ws-title").textContent).toContain("Camembert");
    const inputs = qa<HTMLInputElement>(".ws-bricks input");
    expect(inputs[0].value).toBe("Temps passé");
    expect(inputs[1].value).toBe("Dév");
    expect(inputs[2].value).toBe("60");
    q(".ws-insert").click();
    expect(await result).toBe(code);
  });

  it("returns the exact original text for a readable code with trailing spaces and CRLF", async () => {
    const code = 'pie\r\n    "a" : 1  \r\n\r\n';
    const result = openDiagramWorkshop({ code });
    q(".ws-insert").click();
    expect(await result).toBe(code);
  });

  it("opens unreadable code in code mode, identical, and Insérer returns it as is", async () => {
    const code = "graph TD\n A-->B\n";
    const result = openDiagramWorkshop({ code });
    const area = q<HTMLTextAreaElement>("textarea.ws-code");
    expect(area.value).toBe(code);
    expect(q(".ws-bricks")).toBeNull();
    const back = q<HTMLButtonElement>(".ws-code-toggle");
    expect(back.disabled).toBe(true);
    expect(back.title).toBe("Ce code ne peut pas être relu en briques");
    q(".ws-insert").click();
    expect(await result).toBe(code);
  });

  it("code mode can go back to bricks once the code is readable", () => {
    void openDiagramWorkshop({ code: "graph TD\n A-->B\n" });
    const area = q<HTMLTextAreaElement>("textarea.ws-code");
    setValue(area, 'pie\n    "a" : 1\n');
    const back = q<HTMLButtonElement>(".ws-code-toggle");
    expect(back.disabled).toBe(false);
    back.click();
    expect(q(".ws-title").textContent).toContain("Camembert");
    expect(qa<HTMLInputElement>(".ws-bricks input")[1].value).toBe("a");
  });

  it("'Voir le code mermaid' shows the generated code", () => {
    void openDiagramWorkshop({ code: 'pie title T\n    "a" : 1\n' });
    expect(q(".ws-code-toggle").textContent).toBe("Voir le code mermaid");
    q(".ws-code-toggle").click();
    expect(q<HTMLTextAreaElement>("textarea.ws-code").value).toBe('pie title T\n    "a" : 1\n');
    expect(q(".ws-code-toggle").textContent).toBe("Revenir aux briques");
  });

  it("redraws the preview at most once every 250 ms while typing", async () => {
    vi.useFakeTimers();
    void openDiagramWorkshop({ code: "graph TD\n A-->B\n" });
    await tick();
    const area = q<HTMLTextAreaElement>("textarea.ws-code");
    const before = render.mock.calls.length;
    for (let i = 0; i < 10; i++) {
      setValue(area, `graph TD\n A-->B${i}\n`);
      vi.advanceTimersByTime(20);
    }
    await tick();
    expect(render.mock.calls.length - before).toBeLessThanOrEqual(2);
    vi.advanceTimersByTime(400);
    await tick();
    expect(render.mock.calls.length - before).toBeLessThanOrEqual(2);
    expect(render.mock.calls[render.mock.calls.length - 1][0]).toBe("graph TD\n A-->B9\n");
  });

  it("flow: deleting a box deletes its arrows from the emitted model", async () => {
    const code = 'flowchart TD\n    n1["A"]\n    n2["B"]\n    n3["C"]\n    n1 --> n2\n    n2 --> n3\n';
    const result = openDiagramWorkshop({ code });
    const rows = qa(".ws-bricks .ws-row").filter((r) => r.querySelector("select.ws-sel") && r.querySelector(".ws-del") && !r.querySelector(".ws-arrow"));
    // rows: direction row has no delete; box rows have one
    expect(rows.length).toBe(3);
    (rows[1].querySelector(".ws-del") as HTMLElement).click();
    expect(qa(".ws-arrow").length).toBe(0);
    q(".ws-insert").click();
    expect(await result).toBe('flowchart TD\n    n1["A"]\n    n2["C"]\n');
  });

  it("flow: the arrow lists follow the boxes and the arrow keeps its text", async () => {
    const code = 'flowchart TD\n    n1["A"]\n    n2{"B"}\n    n1 -->|"oui"| n2\n';
    const result = openDiagramWorkshop({ code });
    const boxInput = qa<HTMLInputElement>(".ws-bricks input")[0];
    setValue(boxInput, "Début");
    const options = qa<HTMLSelectElement>("select.ws-node-sel")[0].options;
    expect(options[0].textContent).toBe("Début");
    q(".ws-insert").click();
    expect(await result).toBe('flowchart TD\n    n1["Début"]\n    n2{"B"}\n    n1 -->|"oui"| n2\n');
  });

  it("gantt: a colon in a task name shows the error and disables Insérer", () => {
    void openDiagramWorkshop({ code: "gantt\n    dateFormat YYYY-MM-DD\n    section A\n    Un :t1, 2026-01-05, 1d\n" });
    setValue(q<HTMLInputElement>(".ws-task-name"), "a:b");
    const errors = qa(".ws-error").map((e) => e.textContent);
    expect(errors).toContain("Le caractère « : » n'est pas autorisé ici.");
    expect(q<HTMLButtonElement>(".ws-insert").disabled).toBe(true);
    setValue(q<HTMLInputElement>(".ws-task-name"), "ab");
    expect(q<HTMLButtonElement>(".ws-insert").disabled).toBe(false);
  });

  it("gantt: builds sections and tasks", async () => {
    const result = openDiagramWorkshop({});
    byText(".ws-type", "Gantt").click();
    byText("button.ws-add", "Ajouter une section").click();
    setValue(q<HTMLInputElement>(".ws-section-name"), "Conception");
    byText("button.ws-add", "Ajouter une tâche").click();
    setValue(q<HTMLInputElement>(".ws-task-name"), "Maquettes");
    setValue(q<HTMLInputElement>(".ws-date"), "2026-10-26");
    const days = qa<HTMLInputElement>(".ws-num")[0];
    setValue(days, "3");
    byText("button.ws-add", "Ajouter une tâche").click();
    setValue(qa<HTMLInputElement>(".ws-task-name")[1], "Specs");
    setValue(qa<HTMLInputElement>(".ws-num")[1], "2");
    q(".ws-insert").click();
    const out = await result;
    expect(out).toContain("section Conception");
    expect(out).toContain("Specs :t2, after t1, 2d");
    expect(out).toContain("Maquettes :t1, 2026-10-26, 3d");
  });

  it("states: start and end checkboxes drive the model", async () => {
    const code = 'stateDiagram-v2\n    state "A" as s1\n    state "B" as s2\n    s1 --> s2 : go\n';
    const result = openDiagramWorkshop({ code });
    const checks = qa<HTMLInputElement>(".ws-bricks input[type=checkbox]");
    // checkbox 0 = start, then one per state for the ends
    checks[0].checked = true;
    checks[0].dispatchEvent(new Event("change", { bubbles: true }));
    checks[2].checked = true;
    checks[2].dispatchEvent(new Event("change", { bubbles: true }));
    q(".ws-insert").click();
    expect(await result).toBe('stateDiagram-v2\n    state "A" as s1\n    state "B" as s2\n    [*] --> s1\n    s1 --> s2 : go\n    s2 --> [*]\n');
  });
});
