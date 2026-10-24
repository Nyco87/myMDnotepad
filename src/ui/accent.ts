import { getAccentColor, onAccentChanged } from "../api";

/** Couleur d'accent de repli (aussi la valeur par défaut de `--accent` dans le CSS). */
export const FALLBACK_ACCENT = "#60cdff";

type RGB = [number, number, number];

function parseHex(hex: string): RGB {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  const h = m ? m : /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(FALLBACK_ACCENT)!;
  return [parseInt(h[1], 16), parseInt(h[2], 16), parseInt(h[3], 16)];
}

const toHex = ([r, g, b]: RGB): string =>
  "#" + [r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("");

/** Mélange `c` avec `target` (0 = noir, 255 = blanc) à hauteur de `amount` (0..1). */
const mix = (c: RGB, target: number, amount: number): RGB => c.map((v) => v + (target - v) * amount) as RGB;

/** Luminance relative WCAG. */
function luminance([r, g, b]: RGB): number {
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Variables CSS dérivées d'une couleur d'accent `#rrggbb` (repli `#60cdff` si le format est invalide). */
export function accentVars(hex: string): Record<string, string> {
  const c = parseHex(hex);
  const l = luminance(c);
  // Texte posé sur l'accent : le noir ou le blanc qui offre le meilleur contraste.
  const onBlack = (l + 0.05) / 0.05;
  const onWhite = 1.05 / (l + 0.05);
  const tint = (a: number): string => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
  return {
    "--accent": toHex(c),
    "--accent-fg": onBlack >= onWhite ? "#000000" : "#ffffff",
    "--accent-hover": toHex(mix(c, 255, 0.15)),
    "--accent-pressed": toHex(mix(c, 0, 0.15)),
    "--accent-tint-12": tint(0.12),
    "--accent-tint-22": tint(0.22),
    "--accent-tint-35": tint(0.35),
  };
}

export function applyAccent(hex: string, root: HTMLElement = document.documentElement): void {
  for (const [k, v] of Object.entries(accentVars(hex))) root.style.setProperty(k, v);
}

/**
 * Applique l'accent Windows et suit ses changements. Ne rejette jamais : si l'accent est illisible, le repli du CSS
 * reste en place. Renvoie la fonction de désabonnement.
 */
export async function initAccent(): Promise<() => void> {
  let stop: () => void = () => {};
  try {
    stop = await onAccentChanged((hex) => {
      applyAccent(hex);
      document.dispatchEvent(new CustomEvent("accent-changed", { detail: hex }));
    });
  } catch (e) {
    console.error("accent: abonnement impossible", e);
  }
  try {
    applyAccent(await getAccentColor());
  } catch (e) {
    console.error("accent: lecture impossible", e);
  }
  return stop;
}
