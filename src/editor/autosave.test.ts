import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosaver } from "./autosave";

describe("autosaver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does_not_write_until_delay", () => {
    const write = vi.fn().mockResolvedValue(1);
    const a = createAutosaver(write);
    a.schedule("a");
    vi.advanceTimersByTime(399);
    expect(write).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith("a");
  });

  it("coalesces_bursts", () => {
    const write = vi.fn().mockResolvedValue(1);
    const a = createAutosaver(write);
    a.schedule("a");
    a.schedule("ab");
    vi.advanceTimersByTime(400);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith("ab");
  });

  it("flush_writes_immediately", async () => {
    const write = vi.fn().mockResolvedValue(1);
    const a = createAutosaver(write);
    a.schedule("x");
    expect(a.pending()).toBe(true);
    await a.flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(a.pending()).toBe(false);
    expect(a.lastSaved()).toBe("x");
  });

  it("skips_write_when_unchanged", async () => {
    const write = vi.fn().mockResolvedValue(1);
    const a = createAutosaver(write);
    a.schedule("x");
    await a.flush();
    a.schedule("x");
    vi.advanceTimersByTime(400);
    expect(write).toHaveBeenCalledTimes(1);
    expect(a.pending()).toBe(false);
  });
});
