import type { NoteFile } from "../api";
import type { EditorHandle, EditorOptions } from "../editor/editor";
import { createAutosaver, type Autosaver } from "../editor/autosave";
import { errorText, t, tr } from "../i18n";
import { confirmDialog } from "./confirm-dialog";

/** Accès disque utilisé par les onglets (injecté : `api` dans l'app, une fausse implémentation dans les tests). */
export interface TabsIO {
  readNote(rel: string): Promise<NoteFile>;
  /** Avec `expectedMtime` : rejette avec "CONFLICT" si le fichier existe et que son mtime a changé. */
  writeNote(rel: string, content: string, expectedMtime?: number): Promise<number>;
  createNote(dirRel: string, baseName: string): Promise<string>;
}

export interface TabsOptions {
  /** Conteneur des éditeurs : chaque onglet y monte son propre éditeur (caché quand inactif). */
  host: HTMLElement;
  io: TabsIO;
  makeEditor(mount: HTMLElement, opts: EditorOptions): EditorHandle;
  autosaveDelayMs?: number;
  /** Horloge (nom des copies de conflit). */
  now?: () => Date;
  /** Message pour l'utilisateur (erreur, conflit). `sticky` : reste affiché jusqu'au clic (avis de conflit). */
  notify?: (message: string, opts?: { sticky?: boolean }) => void;
  /** Confirmation avant d'abandonner les modifications d'une note illisible (défaut : modale sombre). */
  confirmDiscard?: (message: string, okLabel: string) => Promise<boolean>;
  /** Liste, onglet actif, marque « introuvable » ou contenu remplacé : la barre de titre/le bandeau doivent se mettre à jour. */
  onChange?: () => void;
}

export interface OpenOptions {
  /** Active l'onglet (défaut : true). */
  activate?: boolean;
  /** N'affiche pas d'erreur si la note ne peut pas être lue (restauration de session). */
  quiet?: boolean;
}

export interface TabsController {
  /** Ouvre la note (ou bascule dessus si elle est déjà ouverte). Renvoie false si elle n'a pas pu être lue. */
  open(rel: string, opts?: OpenOptions): Promise<boolean>;
  /** Enregistre puis ferme l'onglet. Renvoie false (onglet conservé) si l'enregistrement échoue. */
  close(rel: string): Promise<boolean>;
  activate(rel: string): void;
  next(dir: 1 | -1): void;
  /**
   * Une note ou un dossier a changé de chemin : remappe l'onglet exact et ceux sous `oldRel + "/"`, puis relit
   * chacune de ces notes à son nouveau chemin (liens d'images réécrits par le backend). À appeler sous `lockUnder`.
   */
  renamed(oldRel: string, newRel: string): Promise<void>;
  /** Une note ou un dossier est parti à la Corbeille : ferme sans enregistrer (sinon le fichier serait recréé). */
  deleted(rel: string): void;
  flushAll(): Promise<void>;
  list(): string[];
  active(): string | null;
  activeEditor(): EditorHandle | null;
  /** Le fichier de l'onglet a disparu du disque (changement externe). */
  isMissing(rel: string): boolean;
  /** Le fichier existe mais ne peut pas être relu (ex. pas en UTF-8) : les enregistrements sont suspendus. */
  isUnreadable(rel: string): boolean;
  /** Relit une note illisible (bouton « Réessayer ») ; rétablit l'enregistrement si elle est de nouveau lisible. */
  retryRead(rel: string): Promise<void>;
  /** À appeler sur `fs-changed` : recharge, ignore l'écho de nos écritures ou crée une copie de conflit. */
  externalChange(paths: string[]): Promise<void>;
  /**
   * Avant de renommer, déplacer ou supprimer `prefix` (note ou dossier) : enregistre les frappes en file des onglets
   * concernés (rejette si c'est impossible : l'opération doit être annulée), attend la fin des écritures en cours
   * et suspend les suivantes jusqu'à l'appel de la fonction renvoyée. Appeler `renamed`/`deleted`
   * AVANT de libérer : les écritures en attente iront au nouveau chemin (ou n'auront pas lieu si l'onglet est fermé).
   */
  lockUnder(prefix: string): Promise<() => void>;
  /** Rouvre la session : l'onglet actif d'abord (`active`), puis les autres dans l'ordre (`all`). */
  restore(rels: string[], active: string | null): { active: Promise<void>; all: Promise<void> };
}

interface Tab {
  rel: string;
  mount: HTMLElement;
  opts: EditorOptions;
  editor: EditorHandle;
  saver: Autosaver;
  lastKnownMtime: number;
  /** Dernier contenu connu sur le disque : chargé, rechargé, ou écrit par nous. */
  diskKnown: string;
  /** Contenu en cours d'écriture (pour reconnaître l'écho reçu avant la fin de l'écriture). */
  writing: string | null;
  missing: boolean;
  /** Raison pour laquelle le fichier ne peut pas être relu ; tant qu'elle est définie, rien n'est écrit. */
  unreadable: string | null;
  /** Bandeau « note illisible » au-dessus de l'éditeur. */
  banner: HTMLElement;
  closed: boolean;
  /** Vérifications de changement externe sérialisées par onglet. */
  check: Promise<void>;
  /** Versions externes à copier en « (conflit …) » avant toute écriture de la version locale. */
  conflicts: { content: string; copy: string | null }[];
  /** Verrous posés par `lockUnder` : aucune écriture tant qu'il en reste. */
  locks: Set<Promise<void>>;
  /** Écriture disque en cours. */
  inflight: Promise<unknown> | null;
  /** Copie des conflits en cours (une seule à la fois). */
  resolving: Promise<void> | null;
}

const pad = (n: number): string => String(n).padStart(2, "0");
/** Erreur renvoyée par `writeNote` quand le fichier a changé depuis le mtime attendu. */
export const CONFLICT = "CONFLICT";
/** Erreur interne de l'écriture tant que la note est illisible (le contenu reste en file). */
export const UNREADABLE = "UNREADABLE";
/** Erreur renvoyée par `readNote` quand le fichier n'existe pas. */
export const NOT_FOUND = "NOT_FOUND";

/** Dernier essai d'écriture refusé par le compare-and-swap : le message est déjà prêt pour l'utilisateur. */
class ConflictGiveUp extends Error {}
const errText = (e: unknown): string => (typeof e === "string" ? e : e instanceof Error ? e.message : String(e));

/** Nom d'affichage d'une note : son nom de fichier sans `.md`. */
export const noteTitle = (rel: string): string => rel.slice(rel.lastIndexOf("/") + 1).replace(/\.md$/i, "");

/** Dossier et nom de base de la copie de conflit : `<stem> (conflit AAAA-MM-JJ HHmm)`. */
export function conflictName(rel: string, at: Date): { dir: string; base: string } {
  const i = rel.lastIndexOf("/");
  const dir = i >= 0 ? rel.slice(0, i) : "";
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}${pad(at.getMinutes())}`;
  return { dir, base: `${noteTitle(rel)} (${t("tabs.conflictWord")} ${stamp})` };
}

const under = (rel: string, prefix: string): boolean => rel === prefix || rel.startsWith(prefix + "/");

export function createTabs(o: TabsOptions): TabsController {
  const askDiscard = o.confirmDiscard ?? ((m: string, ok: string) => confirmDialog(m, ok, t("common.cancel")));
  const unreadableMessage = (rel: string): string =>
    t("tabs.unreadable", { title: noteTitle(rel) });
  /** Note illisible avec des modifications en attente : demande s'il faut les abandonner (null = abandonnées, sinon l'onglet dont la confirmation a été refusée). */
  const discardUnreadable = async (list: Tab[], ok: string, question: string): Promise<Tab | null> => {
    // Toutes les confirmations d'abord ; on n'abandonne rien tant qu'une seule a été refusée.
    const risky = list.filter((t) => t.unreadable !== null && t.saver.pending());
    for (const t of risky) {
      if (!(await askDiscard(`${unreadableMessage(t.rel)} ${question}`, ok))) return t;
    }
    for (const t of risky) t.saver.discard();
    return null;
  };
  /** Message pour un enregistrement raté ; rien pour une note illisible (le bandeau l'explique déjà). */
  const saveFailure = (rel: string, e: unknown): string | null => {
    if (e instanceof ConflictGiveUp) return e.message;
    if (errText(e) === UNREADABLE || (e instanceof Error && e.message === UNREADABLE)) return null;
    return t("tabs.saveFailed", { title: noteTitle(rel), err: errorText(e) });
  };
  /** Texte d'erreur lisible : « UNREADABLE » devient une phrase française. */
  const friendly = (rel: string, e: unknown): string => (errText(e) === UNREADABLE ? unreadableMessage(rel) : errorText(e));
  const reportSave = (rel: string, e: unknown): void => {
    const m = saveFailure(rel, e);
    if (m) notify(m);
  };
  const tabs: Tab[] = [];
  const opening = new Map<string, Promise<boolean>>();
  let activeRel: string | null = null;
  const notify = (m: string, opts?: { sticky?: boolean }): void => (o.notify ? o.notify(m, opts) : console.error(m));
  const changed = (): void => o.onChange?.();
  const now = o.now ?? (() => new Date());
  const find = (rel: string): Tab | undefined => tabs.find((t) => t.rel === rel);

  const show = (rel: string | null): void => {
    // En quittant un onglet, on enregistre tout de suite (et on retente une écriture en échec : pas de nouvel essai automatique).
    const prev = activeRel === null || activeRel === rel ? undefined : find(activeRel);
    if (prev?.saver.pending()) {
      prev.saver.flush().catch((e) => reportSave(prev.rel, e));
    }
    activeRel = rel;
    for (const t of tabs) t.mount.hidden = t.rel !== rel;
    changed();
  };

  const load = async (rel: string, quiet: boolean): Promise<boolean> => {
    let file: NoteFile;
    try {
      file = await o.io.readNote(rel);
    } catch (e) {
      if (!quiet) notify(t("tabs.openFailed", { title: noteTitle(rel), err: errText(e) === NOT_FOUND ? t("tabs.notFound") : errorText(e) }));
      return false;
    }
    if (find(rel)) return true;
    const mount = document.createElement("div");
    mount.className = "editor-pane";
    mount.hidden = true;
    const banner = document.createElement("div");
    banner.className = "note-banner";
    banner.setAttribute("role", "alert");
    banner.hidden = true;
    mount.appendChild(banner);
    o.host.appendChild(mount);
    const tab = {
      rel,
      mount,
      lastKnownMtime: file.mtime_ms,
      diskKnown: file.content,
      writing: null,
      missing: false,
      unreadable: null,
      banner,
      closed: false,
      check: Promise.resolve(),
      conflicts: [],
      locks: new Set(),
      inflight: null,
      resolving: null,
    } as Partial<Tab> as Tab;
    tab.saver = createAutosaver(
      async (md) => {
        // Une version externe en attente de copie bloque l'écriture (le contenu reste en file, pending() reste vrai).
        // La condition est revérifiée de façon synchrone juste avant l'écriture : un verrou posé entre-temps relance l'attente.
        for (let attempt = 0; ; attempt++) {
          for (;;) {
            await waitUnlocked(tab);
            if (!tab.closed && tab.conflicts.length > 0) await resolveConflicts(tab);
            if (tab.closed || (tab.locks.size === 0 && tab.conflicts.length === 0)) break;
          }
          if (tab.closed) return tab.lastKnownMtime; // onglet supprimé : ne jamais recréer le fichier
          // Fichier illisible : on ne sait pas ce qu'il contient, on n'écrase rien (le contenu reste en file).
          if (tab.unreadable !== null) throw new Error(UNREADABLE);
          tab.writing = md;
          try {
            // Compare-and-swap : refusé si le fichier a changé depuis notre dernière lecture/écriture.
            const p = o.io.writeNote(tab.rel, md, tab.lastKnownMtime);
            tab.inflight = p;
            const mtime = await p;
            tab.lastKnownMtime = mtime;
            tab.diskKnown = md;
            if (tab.missing) {
              tab.missing = false;
              changed();
            }
            return mtime;
          } catch (e) {
            if (errText(e) !== CONFLICT) throw e;
            if (attempt >= 5) {
              throw new ConflictGiveUp(
                t("tabs.conflictGiveUp", { title: noteTitle(tab.rel) }),
              );
            }
          } finally {
            tab.writing = null;
            tab.inflight = null;
          }
          // Le fichier a changé sur le disque avant que le watcher ne le signale : on le relit et, si c'est une
          // autre version, elle est copiée en « (conflit …) » avant d'écrire la version locale (boucle ci-dessus).
          await takeExternal(tab, md);
        }
      },
      o.autosaveDelayMs ?? 400,
      (e) => reportSave(tab.rel, e),
    );
    tab.opts = { markdown: file.content, noteRel: rel, onChange: (md) => tab.saver.schedule(md) };
    tab.editor = o.makeEditor(mount, tab.opts);
    tabs.push(tab);
    if (activeRel === null) show(rel);
    else changed();
    return true;
  };

  /** Relit le fichier après un refus "CONFLICT" ; une version inconnue est mise en file de copie de conflit. */
  const takeExternal = async (tab: Tab, local: string): Promise<void> => {
    const rel = tab.rel;
    const file = await o.io.readNote(rel);
    if (tab.closed || tab.rel !== rel) return;
    tab.lastKnownMtime = file.mtime_ms;
    if (file.content !== tab.diskKnown && file.content !== local) tab.conflicts.push({ content: file.content, copy: null });
    tab.diskKnown = file.content;
  };

  /** Après un renommage/déplacement : relit la note à son nouveau chemin et remplace le contenu de l'éditeur. */
  const reloadAfterMove = async (tab: Tab): Promise<void> => {
    const rel = tab.rel;
    let file: NoteFile;
    try {
      file = await o.io.readNote(rel);
    } catch {
      return; // illisible : l'écriture suivante passera par le compare-and-swap
    }
    if (tab.closed || tab.rel !== rel) return;
    tab.lastKnownMtime = file.mtime_ms;
    if (file.content === tab.diskKnown) return; // aucun lien réécrit
    if (tab.saver.pending() || tab.conflicts.length > 0) {
      // Frappe arrivée pendant l'opération : on garde la version locale et la version réécrite en copie de conflit.
      tab.conflicts.push({ content: file.content, copy: null });
      tab.diskKnown = file.content;
      return;
    }
    tab.diskKnown = file.content;
    tab.editor.setMarkdown(file.content);
    tab.saver.markSaved(file.content);
    changed();
  };

  const waitUnlocked = async (tab: Tab): Promise<void> => {
    while (tab.locks.size > 0) await Promise.all([...tab.locks]);
  };

  /** Écrit chaque version externe en attente dans sa copie « (conflit …) ». Lève une erreur si une copie échoue. */
  const resolveConflicts = (tab: Tab): Promise<void> => {
    if (!tab.resolving) {
      const p: Promise<void> = copyConflicts(tab).finally(() => {
        if (tab.resolving === p) tab.resolving = null;
      });
      tab.resolving = p;
    }
    return tab.resolving;
  };

  /**
   * Hors de l'autosaver (rien en file) : copie les versions externes puis réécrit la version locale,
   * car le fichier contient peut-être encore la version externe.
   */
  const settleConflicts = async (tab: Tab): Promise<void> => {
    if (tab.closed || tab.conflicts.length === 0) return;
    await resolveConflicts(tab);
    if (tab.closed) return;
    tab.saver.markSaved(null);
    tab.saver.schedule(tab.editor.getMarkdown());
    await tab.saver.flush();
  };

  const copyConflicts = async (tab: Tab): Promise<void> => {
    while (tab.conflicts.length > 0) {
      const c = tab.conflicts[0];
      if (c.copy === null) {
        const { dir, base } = conflictName(tab.rel, now());
        c.copy = await o.io.createNote(dir, base);
      }
      await o.io.writeNote(c.copy, c.content);
      tab.conflicts.shift();
      notify(t("tabs.conflictCopied", { title: noteTitle(c.copy) }), { sticky: true });
    }
  };

  const remove = (tab: Tab): void => {
    const idx = tabs.indexOf(tab);
    if (idx < 0) return;
    tab.closed = true;
    tabs.splice(idx, 1);
    tab.editor.destroy();
    tab.mount.remove();
    if (activeRel === tab.rel) show((tabs[idx] ?? tabs[idx - 1])?.rel ?? null);
    else changed();
  };

  /** Affiche (ou retire) le bandeau « note illisible ». */
  const setUnreadable = (tab: Tab, reason: string | null): void => {
    if (tab.unreadable === reason) return;
    tab.unreadable = reason;
    tab.banner.replaceChildren();
    tab.banner.hidden = reason === null;
    if (reason !== null) {
      const text = document.createElement("span");
      tr(text, { text: "tabs.unreadableBanner" }, { reason });
      const retry = document.createElement("button");
      retry.type = "button";
      tr(retry, { text: "tabs.retry" });
      retry.addEventListener("click", () => void ctl.retryRead(tab.rel));
      tab.banner.append(text, retry);
    }
    changed();
  };

  const checkTab = async (tab: Tab): Promise<void> => {
    if (tab.closed) return;
    const rel = tab.rel;
    let file: NoteFile;
    try {
      file = await o.io.readNote(rel);
    } catch (e) {
      if (tab.closed || tab.rel !== rel) return;
      if (errText(e) === NOT_FOUND) {
        // Fichier disparu : on garde l'onglet et son contenu, sans recréer le fichier.
        if (!tab.missing) {
          tab.missing = true;
          changed();
        }
        setUnreadable(tab, null);
      } else {
        // Le fichier est là mais illisible : on suspend les enregistrements pour ne rien écraser.
        setUnreadable(tab, errorText(e));
      }
      return;
    }
    if (tab.closed || tab.rel !== rel) return;
    const wasUnreadable = tab.unreadable !== null;
    setUnreadable(tab, null);
    if (tab.missing) {
      tab.missing = false;
      changed();
    }
    // Écho de nos propres écritures (ou rien de nouveau) : on compare le contenu, pas seulement le mtime.
    if (file.content === tab.diskKnown || file.content === tab.writing || file.content === tab.editor.getMarkdown()) {
      tab.lastKnownMtime = file.mtime_ms;
      tab.diskKnown = file.content;
      // Les frappes mises en file pendant que la note était illisible partent maintenant.
      if (wasUnreadable && tab.saver.pending()) void tab.saver.flush().catch((e) => reportSave(tab.rel, e));
      return;
    }
    tab.lastKnownMtime = file.mtime_ms;
    if (!tab.saver.pending() && tab.conflicts.length === 0) {
      tab.diskKnown = file.content;
      tab.editor.setMarkdown(file.content);
      // Nouvelle référence : revenir ensuite au contenu enregistré avant doit bien être écrit.
      tab.saver.markSaved(file.content);
      changed();
      return;
    }
    // Modifications locales non enregistrées ET version externe différente : on garde les deux.
    // La version externe est copiée avant toute écriture locale (voir l'autosaver) ; tant que la copie
    // échoue, la version locale reste en attente et le fichier n'est pas écrasé.
    tab.conflicts.push({ content: file.content, copy: null });
    tab.diskKnown = file.content;
    try {
      // Attend l'écriture en cours ; une écriture en file copie d'abord le conflit puis écrit la version locale.
      await tab.saver.flush();
      // Rien n'était en file (le conflit venait d'une écriture en cours) : copie puis réécriture locale.
      await settleConflicts(tab);
    } catch (e) {
      notify(
        tab.conflicts.length > 0
          ? t("tabs.conflictCopyFailed", { title: noteTitle(tab.rel), err: errorText(e) })
          : t("tabs.saveFailed", { title: noteTitle(tab.rel), err: errorText(e) }),
        { sticky: tab.conflicts.length > 0 },
      );
    }
  };

  const ctl: TabsController = {
    async open(rel, opts = {}) {
      const activate = opts.activate ?? true;
      if (!find(rel)) {
        let p = opening.get(rel);
        if (!p) {
          p = load(rel, opts.quiet ?? false).finally(() => opening.delete(rel));
          opening.set(rel, p);
        }
        if (!(await p)) return false;
      }
      if (activate && find(rel)) show(rel);
      return !!find(rel);
    },

    async close(rel) {
      const tab = find(rel);
      if (!tab) return true;
      if (await discardUnreadable([tab], t("tabs.closeNoSave"), t("tabs.closeNoSaveQ"))) return false;
      try {
        // Des frappes pendant l'enregistrement peuvent remettre du contenu en file : on recommence (borné).
        for (let i = 0; i < 5 && (tab.saver.pending() || tab.conflicts.length > 0); i++) {
          await tab.saver.flush();
          await settleConflicts(tab);
        }
      } catch (e) {
        notify(t("tabs.notSavedKeepOpen", { title: noteTitle(tab.rel), err: friendly(tab.rel, e) }));
        return false;
      }
      if (tab.saver.pending() || tab.conflicts.length > 0) {
        notify(t("tabs.stillSaving", { title: noteTitle(tab.rel) }));
        return false;
      }
      remove(tab);
      return true;
    },

    activate(rel) {
      if (find(rel)) show(rel);
    },

    next(dir) {
      if (tabs.length === 0) return;
      const i = tabs.findIndex((t) => t.rel === activeRel);
      show(tabs[(i + dir + tabs.length) % tabs.length].rel);
    },

    async renamed(oldRel, newRel) {
      const moved: Tab[] = [];
      for (const t of tabs) {
        if (!under(t.rel, oldRel)) continue;
        const next = newRel + t.rel.slice(oldRel.length);
        if (activeRel === t.rel) activeRel = next;
        t.rel = next;
        t.opts.noteRel = next;
        t.missing = false;
        moved.push(t);
      }
      if (moved.length === 0) return;
      changed();
      // Le backend a pu réécrire les liens d'images (note renommée/déplacée, ou liens sortant d'un dossier déplacé) :
      // on recharge chaque note déplacée depuis son nouveau chemin, encore sous verrou, pour ne pas réécrire les anciens liens.
      await Promise.all(moved.map((t) => reloadAfterMove(t)));
    },

    deleted(rel) {
      for (const t of tabs.filter((t) => under(t.rel, rel))) remove(t);
    },

    async flushAll() {
      const all = tabs.slice();
      const refused = await discardUnreadable(all, t("tabs.closeNoSave"), t("tabs.closeNoSaveQ"));
      if (refused) throw new Error(unreadableMessage(refused.rel));
      const results = await Promise.allSettled(
        all.map(async (t) => {
          await t.saver.flush();
          await settleConflicts(t);
        }),
      );
      const failedIdx = results.findIndex((r) => r.status === "rejected");
      if (failedIdx >= 0) {
        throw new Error(friendly(all[failedIdx]?.rel ?? "", (results[failedIdx] as PromiseRejectedResult).reason));
      }
    },

    list: () => tabs.map((t) => t.rel),
    active: () => activeRel,
    activeEditor: () => (activeRel === null ? null : (find(activeRel)?.editor ?? null)),
    isMissing: (rel) => find(rel)?.missing ?? false,
    isUnreadable: (rel) => (find(rel)?.unreadable ?? null) !== null,

    async retryRead(rel) {
      const t = find(rel);
      if (!t) return;
      t.check = t.check.then(() => checkTab(t)).catch((e) => notify(errText(e)));
      await t.check;
    },

    async externalChange(paths) {
      const hit = tabs.filter((t) => paths.some((p) => under(t.rel, p)));
      await Promise.all(
        hit.map((t) => {
          t.check = t.check.then(() => checkTab(t)).catch((e) => notify(errText(e)));
          return t.check;
        }),
      );
    },

    async lockUnder(prefix) {
      // D'abord enregistrer les frappes en file : une écriture faite après le renommage partirait de l'ancien contenu
      // (anciens liens d'images). Si l'enregistrement échoue, on refuse : l'appelant annule l'opération.
      const held = tabs.filter((t) => under(t.rel, prefix));
      const refused = await discardUnreadable(held, t("tabs.continueNoSave"), t("tabs.continueNoSaveQ"));
      if (refused) throw new Error(`${unreadableMessage(refused.rel)} ${t("tabs.opCancelled")}`);
      for (const h of held) {
        try {
          await h.saver.flush();
        } catch (e) {
          // eslint-disable-next-line preserve-caught-error -- ES2020 lib has no Error `cause` option
          throw new Error(t("tabs.notSavedAbort", { title: noteTitle(h.rel), err: friendly(h.rel, e) }));
        }
      }
      let unlock!: () => void;
      const lock = new Promise<void>((r) => (unlock = r));
      for (const t of held) t.locks.add(lock);
      await Promise.all(held.map((t) => t.inflight?.catch(() => {})));
      return () => {
        for (const t of held) t.locks.delete(lock);
        unlock();
      };
    },

    restore(rels, active) {
      const order = (t: Tab): number => {
        const i = rels.indexOf(t.rel);
        return i < 0 ? Number.MAX_SAFE_INTEGER : i;
      };
      const first = active !== null && rels.includes(active) ? active : (rels[0] ?? null);
      const activeP = first === null ? Promise.resolve() : ctl.open(first, { quiet: true }).then(() => {});
      const all = activeP.then(async () => {
        for (const rel of rels) {
          if (rel === first) continue;
          await ctl.open(rel, { activate: false, quiet: true });
          tabs.sort((a, b) => order(a) - order(b));
        }
        changed();
      });
      return { active: activeP, all };
    },
  };
  return ctl;
}
