export interface Autosaver {
  schedule(md: string): void;
  /** Writes pending content now (waiting for any in-flight write). Retries a failed write once, then rejects. */
  flush(): Promise<void>;
  /** True while content is queued and unsaved, a write is in flight, or the last write failed. */
  pending(): boolean;
  lastSaved(): string | null;
  /**
   * Declares `md` as the content now on disk (e.g. after reloading an external change), so a later
   * schedule() of the previous saved content is written instead of being skipped. `null` forgets the
   * baseline: the next schedule() always writes.
   */
  markSaved(md: string | null): void;
}

/**
 * Debounced writer. Writes are serialized; the latest requested content always
 * wins. A failed write keeps its content queued so a later flush retries it.
 */
export function createAutosaver(
  write: (md: string) => Promise<number>,
  delayMs = 400,
  onError?: (e: unknown) => void,
): Autosaver {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let queued: string | null = null;
  let saved: string | null = null;
  let writing = false;
  let draining: Promise<void> | null = null;

  const loop = async (): Promise<void> => {
    while (queued !== null) {
      const md = queued;
      if (md === saved) {
        queued = null;
        break;
      }
      queued = null;
      writing = true;
      try {
        await write(md);
        saved = md;
      } catch (e) {
        if (queued === null) queued = md; // keep unsaved content unless something newer arrived
        throw e;
      } finally {
        writing = false;
      }
    }
  };

  const drain = (): Promise<void> => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (draining) {
      return draining.catch(() => {}).then(() => (queued !== null && queued !== saved ? drain() : undefined));
    }
    const p: Promise<void> = loop().finally(() => {
      if (draining === p) draining = null;
    });
    draining = p;
    return p;
  };

  return {
    schedule(md) {
      queued = md;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        drain().catch((e) => onError?.(e));
      }, delayMs);
    },
    async flush() {
      try {
        await drain();
      } catch {
        await drain();
      }
    },
    pending: () => writing || (queued !== null && queued !== saved),
    lastSaved: () => saved,
    markSaved(md) {
      saved = md;
    },
  };
}
