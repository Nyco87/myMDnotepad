// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mountPieEditor } from "./editors/pie-editor";
import { validateModel, validateWarnings } from "./validate";
import type { PieModel } from "./model";

const pie = (...values: number[]): PieModel => ({
  kind: "pie",
  title: "",
  slices: values.map((value, i) => ({ label: `p${i}`, value })),
});

describe("pie total warning", () => {
  it("warns_above_100_without_blocking", () => {
    const m = pie(60, 50);
    expect(validateModel(m)).toEqual([]);
    expect(validateWarnings(m)).toEqual([{ where: "pie.total", message: "Le total dépasse 100 (actuellement 110)." }]);
  });

  it("no_warning_up_to_100", () => {
    expect(validateWarnings(pie(60, 40))).toEqual([]);
    expect(validateWarnings(pie(33.3, 33.3, 33.4))).toEqual([]);
  });

  it("editor_shows_the_warning_live_and_clears_it", () => {
    const root = document.createElement("div");
    let last: PieModel | null = null;
    mountPieEditor(root, pie(60, 30), (m) => (last = m));
    const slot = root.querySelector<HTMLElement>("[data-where='pie.total']")!;
    expect(slot.textContent).toBe("");
    const inputs = root.querySelectorAll<HTMLInputElement>("input.ws-num");
    inputs[1].value = "50";
    inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
    expect(slot.textContent).toBe("Le total dépasse 100 (actuellement 110).");
    expect(slot.classList.contains("ws-warning")).toBe(true);
    expect(last!.slices[1].value).toBe(50);
    inputs[1].value = "20";
    inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
    expect(slot.textContent).toBe("");
  });
});
