import { fr } from "./fr";
import { en } from "./en";
import { localizeError as localize } from "./errors";

export type Lang = "fr" | "en";
export type Key = keyof typeof fr;
export type Params = Record<string, string | number>;

const dictionaries: Record<Lang, Record<Key, string>> = { fr, en };

/** Langue de Windows (via le webview) : français pour `fr*`, anglais sinon. */
export function detectLanguage(): Lang {
  const nav = typeof navigator !== "undefined" ? navigator.language : "";
  return /^fr\b/i.test(nav ?? "") ? "fr" : "en";
}

export const isLang = (v: unknown): v is Lang => v === "fr" || v === "en";

let current: Lang = detectLanguage();
const listeners = new Set<(lang: Lang) => void>();

export const getLanguage = (): Lang => current;

/** Traduit `key` ; `{nom}` est remplacé par `params.nom`. */
export function t(key: Key, params?: Params): string {
  const raw = dictionaries[current][key] ?? fr[key] ?? key;
  return params ? raw.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : raw;
}

/** Traduction dans une langue précise (mots-clés de recherche du menu « / » dans les deux langues). */
export function tIn(lang: Lang, key: Key): string {
  return dictionaries[lang][key];
}

/** Texte d'erreur lisible dans la langue courante (les messages du backend sont écrits en français). */
export function errorText(e: unknown): string {
  const raw = typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
  return localize(raw, current, t);
}

/* ---- Éléments « traduisibles » : mis à jour d'un coup quand la langue change ---- */

export interface Spec {
  text?: Key;
  title?: Key;
  aria?: Key;
  placeholder?: Key;
}
const ATTRS = ["text", "title", "aria", "placeholder"] as const;
const dataName = (a: string): string => `i18n${a[0].toUpperCase()}${a.slice(1)}`;

function applyTo(el: HTMLElement): void {
  let params: Params | undefined;
  try {
    params = el.dataset.i18nParams ? (JSON.parse(el.dataset.i18nParams) as Params) : undefined;
  } catch {
    params = undefined;
  }
  const text = el.dataset[dataName("text")];
  if (text) el.textContent = t(text as Key, params);
  const title = el.dataset[dataName("title")];
  if (title) el.title = t(title as Key, params);
  const aria = el.dataset[dataName("aria")];
  if (aria) el.setAttribute("aria-label", t(aria as Key, params));
  const ph = el.dataset[dataName("placeholder")];
  if (ph) (el as HTMLInputElement).placeholder = t(ph as Key, params);
}

/** Pose texte / infobulle / aria-label / placeholder depuis des clés et les rafraîchit à chaque changement de langue. */
export function tr<E extends HTMLElement>(el: E, spec: Spec, params?: Params): E {
  for (const a of ATTRS) {
    const key = spec[a];
    if (key) el.dataset[dataName(a)] = key;
  }
  if (params) el.dataset.i18nParams = JSON.stringify(params);
  applyTo(el);
  return el;
}

/** Réapplique toutes les traductions marquées sous `root`. */
export function retranslate(root: ParentNode = document): void {
  root
    .querySelectorAll<HTMLElement>("[data-i18n-text],[data-i18n-title],[data-i18n-aria],[data-i18n-placeholder]")
    .forEach(applyTo);
}

export function setLanguage(lang: Lang): void {
  if (lang === current) {
    if (typeof document !== "undefined") document.documentElement.lang = lang;
    return;
  }
  current = lang;
  if (typeof document !== "undefined") {
    document.documentElement.lang = lang;
    document.title = t("app.name");
    retranslate();
  }
  for (const cb of [...listeners]) cb(lang);
}

export function onLanguageChanged(cb: (lang: Lang) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
