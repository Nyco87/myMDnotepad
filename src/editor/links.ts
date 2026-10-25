import { keymap } from "prosemirror-keymap";
import { Plugin } from "prosemirror-state";

/** Où va un lien cliqué : navigateur par défaut, autre note du dossier, ou nulle part. */
export type LinkTarget =
  | { kind: "external"; url: string }
  | { kind: "note"; rel: string }
  | { kind: "ignore" };

export interface LinkHandlers {
  openExternal(url: string): void;
  /** `rel` : chemin de la note relatif au dossier racine, séparateurs « / ». */
  openNote(rel: string): void;
}

const SCHEME = /^[a-z][a-z0-9+.-]+:/i; // 2+ lettres : « C:\ » n'est pas un schéma
const EXTERNAL = /^(https?:|mailto:)/i;

/**
 * Classe un `href` écrit dans la note `noteRel`. http/https/mailto → navigateur ; lien relatif vers un `.md` → note,
 * résolue depuis le dossier de la note courante (`.` et `..` normalisés, `#ancre` et `?requête` retirés) ; le reste
 * (autres schémas, lecteur Windows, ancre seule, `..` qui sortirait du dossier racine) est ignoré.
 */
export function resolveLink(href: string, noteRel: string): LinkTarget {
  const raw = href.trim();
  if (EXTERNAL.test(raw)) return { kind: "external", url: raw };
  if (raw === "" || SCHEME.test(raw) || /^[a-z]:[\\/]/i.test(raw)) return { kind: "ignore" };

  let path = raw.replace(/[#?][\s\S]*$/, "");
  try {
    path = decodeURIComponent(path);
  } catch {
    // pourcentage mal formé : on garde le texte tel quel
  }
  if (!/\.md$/i.test(path)) return { kind: "ignore" };

  const rootRelative = path.startsWith("/") || path.startsWith("\\");
  const parts = rootRelative ? [] : noteRel.split(/[\\/]/).slice(0, -1);
  for (const seg of path.split(/[\\/]/)) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return { kind: "ignore" };
      parts.pop();
    } else parts.push(seg);
  }
  return { kind: "note", rel: parts.join("/") };
}

export function routeLink(href: string, noteRel: string, h: LinkHandlers): void {
  const t = resolveLink(href, noteRel);
  if (t.kind === "external") h.openExternal(t.url);
  else if (t.kind === "note") h.openNote(t.rel);
}

export interface LinkContext {
  noteRel: string;
  handlers: LinkHandlers | undefined;
}

/**
 * Ctrl+clic sur un lien : l'ouvre. Un clic simple garde son rôle (placer le curseur). `get` est lu à chaque
 * événement (le chemin de la note peut changer ; sans gestionnaires rien ne s'ouvre).
 */
export function linkOpenPlugin(get: () => LinkContext): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        click(_view, event) {
          const e = event as MouseEvent;
          if (!e.ctrlKey && !e.metaKey) return false;
          const a = (e.target as HTMLElement | null)?.closest?.("a[href]");
          if (!a) return false;
          // Sans preventDefault, le webview navigue lui-même vers le lien.
          e.preventDefault();
          const { noteRel, handlers } = get();
          if (!handlers) return true;
          routeLink(a.getAttribute("href") ?? "", noteRel, handlers);
          return true;
        },
      },
    },
  });
}

/** Ctrl+Entrée avec le curseur dans un lien. Placé après le keymap principal : « cocher une tâche » garde la priorité. */
export function linkKeymap(get: () => LinkContext): Plugin {
  return keymap({
    "Mod-Enter": (state) => {
      const { $from, empty, from, to } = state.selection;
      const type = state.schema.marks.link;
      const mark = empty
        ? type.isInSet($from.nodeAfter?.marks ?? []) ?? type.isInSet($from.nodeBefore?.marks ?? [])
        : state.doc.rangeHasMark(from, to, type)
          ? type.isInSet(state.doc.resolve(from + 1).marks())
          : null;
      if (!mark) return false;
      const { noteRel, handlers } = get();
      if (!handlers) return false;
      routeLink(mark.attrs.href as string, noteRel, handlers);
      return true;
    },
  });
}
