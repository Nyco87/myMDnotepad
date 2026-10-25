// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountToast } from "./toast";

const el = (): HTMLElement => document.querySelector(".toast") as HTMLElement;
const shown = (): string | null => (el().hidden ? null : el().textContent);

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("toast", () => {
  it("queues messages instead of replacing the visible one", () => {
    const toast = mountToast(document.body);
    toast("premier");
    toast("second");
    expect(shown()).toBe("premier");
    vi.advanceTimersByTime(5000);
    expect(shown()).toBe("second");
    vi.advanceTimersByTime(5000);
    expect(shown()).toBeNull();
  });

  it("sticky message stays until clicked and does not hold back the queue", () => {
    const toast = mountToast(document.body);
    toast("Note modifiée hors de myMDnotepad : copie de conflit", { sticky: true });
    toast("autre");
    expect(shown()).toBe("autre");
    vi.advanceTimersByTime(60_000);
    expect(shown()).toBeNull();
    const sticky = document.querySelector(".toast-sticky") as HTMLElement;
    expect(sticky.textContent).toBe("Note modifiée hors de myMDnotepad : copie de conflit");
    sticky.click();
    expect(document.querySelector(".toast-sticky")).toBeNull();
  });

  it("sticky_does_not_block_queue", () => {
    const toast = mountToast(document.body);
    toast("conflit", { sticky: true });
    toast("erreur");
    const stack = document.querySelector(".toast-stack") as HTMLElement;
    const visible = [...stack.querySelectorAll<HTMLElement>(".toast")].filter((e) => !e.hidden).map((e) => e.textContent);
    expect(visible.sort()).toEqual(["conflit", "erreur"]);
    expect(shown()).toBe("erreur");
  });

  it("a sticky message arriving while another is shown is not lost", () => {
    const toast = mountToast(document.body);
    toast("erreur");
    toast("conflit", { sticky: true });
    toast("erreur 2");
    expect(document.querySelector(".toast-sticky")?.textContent).toBe("conflit");
    vi.advanceTimersByTime(5000);
    expect(shown()).toBe("erreur 2");
    vi.advanceTimersByTime(60_000);
    expect(document.querySelector(".toast-sticky")?.textContent).toBe("conflit");
  });

  it("clicking a normal message shows the next one at once", () => {
    const toast = mountToast(document.body);
    toast("a");
    toast("b");
    el().click();
    expect(shown()).toBe("b");
  });

  it("identical message already waiting is not queued twice", () => {
    const toast = mountToast(document.body);
    toast("a");
    toast("b");
    toast("b");
    vi.advanceTimersByTime(5000);
    expect(shown()).toBe("b");
    vi.advanceTimersByTime(5000);
    expect(shown()).toBeNull();
  });
});
