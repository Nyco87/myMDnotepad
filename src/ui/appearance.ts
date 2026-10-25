/**
 * Transparence de la fenêtre : 0 = opaque, 100 = transparent, 50 = rendu historique (voile 0.72).
 * Le voile est la teinte posée sur l'acrylique : ce réglage ne touche ni au flou ni au fond de l'éditeur
 * (`--editor-bg`), donc jamais à la lisibilité du texte.
 */
export const DEFAULT_TRANSPARENCY = 50;

/** Opacité (0–1) du voile `--panel` pour une transparence 0–100. */
export function panelAlpha(transparency: number): number {
  const t = Math.min(100, Math.max(0, Number.isFinite(transparency) ? transparency : DEFAULT_TRANSPARENCY));
  const a = t <= 50 ? 1 - t * 0.0056 : 0.72 - (t - 50) * 0.0084;
  return Math.round(a * 1000) / 1000;
}

/** Applique la transparence au voile CSS (l'acrylique natif est réglé côté Rust). */
export function applyTransparencyCss(transparency: number): void {
  document.documentElement.style.setProperty("--panel", `rgba(32, 32, 32, ${panelAlpha(transparency)})`);
}
