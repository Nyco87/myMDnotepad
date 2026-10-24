export interface Autosaver {
  schedule(md: string): void;
  flush(): Promise<void>;
  pending(): boolean;
  lastSaved(): string | null;
}

/** Debounced writer. Skips writes whose content equals the last saved content. */
export function createAutosaver(write: (md: string) => Promise<number>, delayMs = 400): Autosaver {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let queued: string | null = null;
  let saved: string | null = null;
  let inflight: Promise<void> = Promise.resolve();
  let busy = false;

  const run = (): Promise<void> => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const md = queued;
    queued = null;
    if (md === null || md === saved) return inflight;
    const doWrite = async () => {
      await write(md);
      saved = md;
    };
    // Call synchronously when idle; otherwise serialize behind the running write.
    const p = busy ? inflight.catch(() => {}).then(doWrite) : doWrite();
    busy = true;
    inflight = p.finally(() => {
      if (inflight === tracked) busy = false;
    });
    const tracked = inflight;
    return inflight;
  };

  return {
    schedule(md) {
      queued = md;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        void run().catch(() => {});
      }, delayMs);
    },
    flush: run,
    pending: () => queued !== null && queued !== saved,
    lastSaved: () => saved,
  };
}
