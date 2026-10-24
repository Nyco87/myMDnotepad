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

  it("failed_write_stays_pending_and_flush_retries", async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error("disk")).mockResolvedValue(1);
    const onError = vi.fn();
    const a = createAutosaver(write, 400, onError);
    a.schedule("x");
    await vi.advanceTimersByTimeAsync(400);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(a.pending()).toBe(true);
    expect(a.lastSaved()).toBeNull();
    await a.flush();
    expect(write).toHaveBeenCalledTimes(2);
    expect(a.pending()).toBe(false);
    expect(a.lastSaved()).toBe("x");
  });

  it("flush_rejects_after_retry_and_keeps_content", async () => {
    const write = vi.fn().mockRejectedValue(new Error("disk"));
    const a = createAutosaver(write);
    a.schedule("x");
    await expect(a.flush()).rejects.toThrow("disk");
    expect(write).toHaveBeenCalledTimes(2);
    expect(a.pending()).toBe(true);
  });

  it("pending_during_inflight_and_flush_waits_for_newer", async () => {
    const resolvers: Array<() => void> = [];
    const write = vi.fn(() => new Promise<number>((r) => resolvers.push(() => r(1))));
    const a = createAutosaver(write);
    a.schedule("a");
    vi.advanceTimersByTime(400);
    expect(write).toHaveBeenCalledTimes(1);
    expect(a.pending()).toBe(true);
    a.schedule("b");
    let done = false;
    const f = a.flush().then(() => (done = true));
    resolvers[0]();
    await vi.advanceTimersByTimeAsync(0);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith("b");
    expect(done).toBe(false);
    resolvers[1]();
    await f;
    expect(a.pending()).toBe(false);
    expect(a.lastSaved()).toBe("b");
  });

  it("revert_to_saved_during_inflight_still_writes_latest", async () => {
    const resolvers: Array<() => void> = [];
    const write = vi.fn(() => new Promise<number>((r) => resolvers.push(() => r(1))));
    const a = createAutosaver(write);
    a.schedule("a");
    const f1 = a.flush();
    resolvers[0]();
    await f1;
    a.schedule("b");
    vi.advanceTimersByTime(400);
    a.schedule("a"); // equals last completed save, but "b" is in flight
    const f2 = a.flush();
    resolvers[1]();
    await vi.advanceTimersByTimeAsync(0);
    resolvers[2]();
    await f2;
    expect(write.mock.calls.map((c) => (c as unknown[])[0])).toEqual(["a", "b", "a"]);
    expect(a.lastSaved()).toBe("a");
  });
});
