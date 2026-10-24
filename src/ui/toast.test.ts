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

  it("sticky message stays until clicked, then the queue resumes", () => {
    const toast = mountToast(document.body);
    toast("Note modifiée hors de MDnote : copie de conflit", { sticky: true });
    toast("autre");
    vi.advanceTimersByTime(60_000);
    expect(shown()).toBe("Note modifiée hors de MDnote : copie de conflit");
    el().click();
    expect(shown()).toBe("autre");
    vi.advanceTimersByTime(5000);
    expect(shown()).toBeNull();
  });

  it("a sticky message arriving while another is shown is not lost", () => {
    const toast = mountToast(document.body);
    toast("erreur");
    toast("conflit", { sticky: true });
    toast("erreur 2");
    vi.advanceTimersByTime(5000);
    expect(shown()).toBe("conflit");
    vi.advanceTimersByTime(60_000);
    expect(shown()).toBe("conflit");
    el().click();
    expect(shown()).toBe("erreur 2");
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
