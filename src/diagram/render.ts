/**
 * Rendu mermaid → SVG. La bibliothèque est lourde : elle n'est importée qu'au premier rendu (import dynamique,
 * chunk séparé), jamais sur le chemin critique du démarrage.
 */

import { t } from "../i18n";

export type RenderResult = { ok: true; svg: string } | { ok: false; error: string; transient?: true };

type Mermaid = typeof import("mermaid").default;

let loading: Promise<Mermaid> | null = null;
let initializedWith = "";
let counter = 0;

const FALLBACK_ACCENT = "#60cdff";

function currentAccent(): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    return v || FALLBACK_ACCENT;
  } catch {
    return FALLBACK_ACCENT;
  }
}

/** Accent actuellement utilisé pour dessiner (clé de cache des rendus). */
export const diagramAccent = currentAccent;

async function load(): Promise<Mermaid> {
  loading ??= import("mermaid").then((m) => m.default);
  try {
    return await loading;
  } catch (e) {
    loading = null; // un échec de chargement ne doit pas être mémorisé
    throw e;
  }
}

function configure(mermaid: Mermaid, accent: string): void {
  if (initializedWith === accent) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme: "base",
    themeVariables: {
      darkMode: true,
      background: "#1c1c1c",
      primaryColor: "#2b3a45",
      primaryTextColor: "#e6e6e6",
      primaryBorderColor: accent,
      lineColor: "#888888",
      textColor: "#e6e6e6",
      fontFamily: '"Segoe UI Variable Text", "Segoe UI", sans-serif',
    },
  });
  initializedWith = accent;
}

/**
 * Dessine `code`. Ne lève jamais : une erreur de syntaxe (ou de chargement) revient sous la forme
 * `{ ok: false, error }` avec le message de mermaid.
 */
export async function renderMermaid(code: string): Promise<RenderResult> {
  const id = `mdnote-mmd-${++counter}`;
  let loaded = false;
  try {
    const mermaid = await load();
    loaded = true;
    configure(mermaid, currentAccent());
    const { svg } = await mermaid.render(id, code);
    return { ok: true, svg };
  } catch (e) {
    // mermaid peut laisser un élément de travail dans la page après une erreur.
    document.getElementById(id)?.remove();
    document.getElementById(`d${id}`)?.remove();
    const message = e instanceof Error ? e.message : String(e);
    const error = message.trim() || t("diagram.unreadable");
    // Échec de chargement de mermaid (pas une erreur de syntaxe) : à retenter, à ne pas mémoriser.
    return loaded ? { ok: false, error } : { ok: false, error, transient: true };
  }
}
