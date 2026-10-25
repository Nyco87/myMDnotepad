// @vitest-environment jsdom
/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { filterCommands } from "../editor/slash";
import { buildSlashCommands } from "../editor/slash-commands";
import { en } from "./en";
import { fr } from "./fr";
import { detectLanguage, errorText, getLanguage, onLanguageChanged, setLanguage, t, tIn, tr } from "./index";

afterEach(() => setLanguage("fr"));

const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("dictionaries", () => {
  it("define exactly the same keys", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort());
  });
  it("have no empty value and the same {placeholders} in both languages", () => {
    for (const k of Object.keys(fr) as (keyof typeof fr)[]) {
      expect(fr[k], k).not.toBe("");
      expect(en[k], k).not.toBe("");
      expect(placeholders(en[k]), k).toEqual(placeholders(fr[k]));
    }
  });
});

describe("t / setLanguage", () => {
  it("translates and interpolates", () => {
    setLanguage("fr");
    expect(t("tabs.retry")).toBe("Réessayer");
    expect(t("firstRun.missing", { path: "C:/x" })).toBe("Le dossier C:/x est introuvable.");
    setLanguage("en");
    expect(t("tabs.retry")).toBe("Retry");
    expect(t("firstRun.missing", { path: "C:/x" })).toBe("The folder C:/x cannot be found.");
  });
  it("notifies listeners once per change and sets <html lang>", () => {
    const cb = vi.fn();
    const off = onLanguageChanged(cb);
    setLanguage("en");
    setLanguage("en");
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith("en");
    expect(document.documentElement.lang).toBe("en");
    off();
    setLanguage("fr");
    expect(cb).toHaveBeenCalledTimes(1);
    expect(getLanguage()).toBe("fr");
  });
  it("relabels marked elements live", () => {
    const b = tr(document.createElement("button"), { text: "tabs.retry", title: "titlebar.newNote" });
    document.body.appendChild(b);
    expect([b.textContent, b.title]).toEqual(["Réessayer", "Nouvelle note (Ctrl+N)"]);
    setLanguage("en");
    expect([b.textContent, b.title]).toEqual(["Retry", "New note (Ctrl+N)"]);
    b.remove();
  });
  it("keeps parameters when relabelling", () => {
    const p = tr(document.createElement("p"), { text: "firstRun.missing" }, { path: "D:/n" });
    document.body.appendChild(p);
    setLanguage("en");
    expect(p.textContent).toBe("The folder D:/n cannot be found.");
    p.remove();
  });
  it("tIn reads a given language regardless of the current one", () => {
    setLanguage("en");
    expect(tIn("fr", "tabs.retry")).toBe("Réessayer");
  });
  it("detects French from the system language, English otherwise", () => {
    const set = (v: string): void => void vi.spyOn(navigator, "language", "get").mockReturnValue(v);
    set("fr-FR");
    expect(detectLanguage()).toBe("fr");
    set("en-GB");
    expect(detectLanguage()).toBe("en");
    set("de-DE");
    expect(detectLanguage()).toBe("en");
    vi.restoreAllMocks();
  });
});

describe("slash menu", () => {
  const noop = (): void => {};
  const all = buildSlashCommands({ table: noop, link: noop, image: noop, symbols: noop, diagram: noop });
  const ids = (q: string): string[] => filterCommands(all, q, false).map((c) => c.id);
  it("searches the keywords of both languages whatever the current one", () => {
    for (const lang of ["fr", "en"] as const) {
      setLanguage(lang);
      expect(ids("grille"), lang).toContain("table");
      expect(ids("grid"), lang).toContain("table");
      expect(ids("puces"), lang).toContain("bullet");
      expect(ids("divider"), lang).toContain("hr");
    }
  });
  it("shows labels in the current language", () => {
    setLanguage("en");
    expect(all.find((c) => c.id === "h1")?.label).toBe("Heading 1");
    expect(all.find((c) => c.id === "alert-tip")?.label).toBe("Alert — Tip");
    setLanguage("fr");
    expect(all.find((c) => c.id === "alert-tip")?.label).toBe("Alerte — Astuce");
  });
});

describe("errorText", () => {
  it("leaves backend messages alone in French and translates them in English", () => {
    const raw = "Impossible de créer la note : accès refusé";
    expect(errorText(raw)).toBe(raw);
    setLanguage("en");
    expect(errorText(raw)).toBe("Cannot create the note: accès refusé");
    expect(errorText(new Error("Une note ou un dossier porte déjà ce nom."))).toBe("A note or folder with this name already exists.");
    expect(errorText("message inconnu")).toBe("message inconnu");
  });
  it("turns settings error codes into sentences", () => {
    expect(errorText("SETTINGS_INVALID")).toBe(fr["err.SETTINGS_INVALID"]);
    setLanguage("en");
    expect(errorText("SETTINGS_DEST_EXISTS")).toBe(en["err.SETTINGS_DEST_EXISTS"]);
  });
});

/* ---- Aucune chaîne d'interface française codée en dur ---- */

/** Contenu des littéraux de chaîne (les parties fixes des gabarits comprises), commentaires ignorés. */
function literals(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && src[i + 1] === "*") {
      i = src.indexOf("*/", i + 2);
      i = i < 0 ? src.length : i + 2;
    } else if (c === '"' || c === "'" || c === "`") {
      let s = "";
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\") {
          s += src[i + 1];
          i += 2;
        } else if (c === "`" && src[i] === "$" && src[i + 1] === "{") {
          let depth = 1;
          i += 2;
          while (i < src.length && depth > 0) {
            if (src[i] === "{") depth++;
            else if (src[i] === "}") depth--;
            i++;
          }
          s += " ";
        } else s += src[i++];
      }
      i++;
      out.push(s);
    } else if (c === "/" && /[=(,:!&|?{};\n]\s*$/.test(src.slice(Math.max(0, i - 8), i)) ) {
      // littéral d'expression régulière : on saute jusqu'au « / » fermant
      i++;
      while (i < src.length && src[i] !== "/" && src[i] !== "\n") i += src[i] === "\\" ? 2 : 1;
      i++;
    } else i++;
  }
  return out;
}

const FRENCH = /[àâçéèêëîïôûùüœÀÉÈ]|\b(le|la|les|une|des|du|et|ou|pour|avec|sans|dans|sur|est|pas|cette|ajouter|ajoutez|supprimer|annuler|fermer|ouvrir|impossible|aucune|nouvelle|nouveau|dossier|tableau|lien|liste|réessayer|enregistr\w+|texte|titre|forme|vers|jours|valeur|parts|cases|monter|descendre|renommer|choisir|modifier|nom)\b/i;
/** Littéraux autorisés : données, pas des textes d'interface. */
const ALLOWED = new Set<string>([
  "Insérer", // identifiant de groupe du menu « / » (le texte affiché vient de `slash.group.*`)
  "accent: abonnement impossible", // messages de console (développeur), pas d'interface
  "accent: lecture impossible",
  '"Segoe UI Variable Text", "Segoe UI", sans-serif', // police
]);

const modules = import.meta.glob(
  ["../ui/**/*.ts", "../editor/**/*.ts", "../diagram/**/*.ts", "../main.ts", "!**/*.test.ts", "!**/test-helpers.ts", "!**/emoji-data.ts"],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

describe("no hard-coded French UI text", () => {
  it("src/ui, src/editor, src/diagram and main.ts only get their texts from the dictionaries", () => {
    const found: string[] = [];
    expect(Object.keys(modules).length).toBeGreaterThan(30);
    for (const [f, src] of Object.entries(modules)) {
      for (const lit of literals(src)) {
        if (!ALLOWED.has(lit) && FRENCH.test(lit)) found.push(`${f}: ${lit.slice(0, 80)}`);
      }
    }
    expect(found).toEqual([]);
  });
});
