// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const open = vi.fn();
const setRoot = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: (o: unknown) => open(o) }));
vi.mock("../api", () => ({ setRoot: (p: string) => setRoot(p) }));

import { showFirstRun } from "./first-run";

const flush = () => new Promise((r) => setTimeout(r, 0));

let el: HTMLElement;
beforeEach(() => {
  open.mockReset();
  setRoot.mockReset();
  el = document.createElement("div");
  document.body.appendChild(el);
});
afterEach(() => {
  document.body.innerHTML = "";
});

const button = () => el.querySelector("button") as HTMLButtonElement;

describe("first run", () => {
  it("first_run_missing_shows_previous_path", () => {
    void showFirstRun(el, "missing", "D:\Notes");
    expect(el.textContent).toContain("Choisis le dossier de tes notes");
    expect(el.textContent).toContain("Le dossier D:\Notes est introuvable.");
    expect(el.textContent).toContain("Astuce : un dossier OneDrive synchronise tes notes automatiquement.");
    expect(button().textContent).toBe("Choisir un dossier…");
  });

  it("does not show the missing message when unset", () => {
    void showFirstRun(el, "unset");
    expect(el.textContent).not.toContain("introuvable");
  });

  it("first_run_resolves_after_setRoot", async () => {
    open.mockResolvedValue("D:\Notes");
    setRoot.mockResolvedValue(undefined);
    let done = false;
    const p = showFirstRun(el, "unset").then(() => (done = true));
    await flush();
    expect(done).toBe(false);
    button().click();
    await p;
    expect(open).toHaveBeenCalledWith({ directory: true });
    expect(setRoot).toHaveBeenCalledWith("D:\Notes");
    expect(done).toBe(true);
  });

  it("stays pending when the dialog is cancelled", async () => {
    open.mockResolvedValue(null);
    let done = false;
    void showFirstRun(el, "unset").then(() => (done = true));
    button().click();
    await flush();
    expect(setRoot).not.toHaveBeenCalled();
    expect(done).toBe(false);
    expect(button().disabled).toBe(false);
  });

  it("first_run_shows_error_if_setRoot_rejects", async () => {
    open.mockResolvedValue("D:\Notes");
    setRoot.mockRejectedValue("Ce dossier n'existe pas : D:\Notes");
    let done = false;
    void showFirstRun(el, "unset").then(() => (done = true));
    button().click();
    await flush();
    await flush();
    expect(done).toBe(false);
    expect(el.querySelector('[role="alert"]')?.textContent).toContain("Ce dossier n'existe pas");
    expect(button().disabled).toBe(false);
  });
});
