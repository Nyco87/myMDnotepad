/** GitHub alert kinds, shared by the markdown layer and the editor. */
export type AlertKind = "note" | "tip" | "important" | "warning" | "caution";

export const ALERT_KINDS: readonly AlertKind[] = ["note", "tip", "important", "warning", "caution"];

/** Kind named by a `[!KIND]` marker (any case), or null when it is not a GitHub alert kind. */
export function alertKindOf(name: string): AlertKind | null {
  const k = name.toLowerCase();
  return (ALERT_KINDS as readonly string[]).includes(k) ? (k as AlertKind) : null;
}

/** Canonical marker written for an alert whose original marker is gone: `[!NOTE]`. */
export const canonicalMarker = (kind: AlertKind): string => `[!${kind.toUpperCase()}]`;
