import type { NoteFile } from "../api";
import type { EditorHandle, EditorOptions } from "../editor/editor";
import { createAutosaver, type Autosaver } from "../editor/autosave";

/** Accès disque utilisé par les onglets (injecté : `api` dans l'app, une fausse implémentation dans les tests). */
export interface TabsIO {
  readNote(rel: string): Promise<NoteFile>;
  writeNote(rel: string, content: string): Promise<number>;
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
  /** Message pour l'utilisateur (erreur, conflit). */
  notify?: (message: string) => void;
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
  /** Une note ou un dossier a changé de chemin : remappe l'onglet exact et ceux sous `oldRel + "/"`. */
  renamed(oldRel: string, newRel: string): void;
  /** Une note ou un dossier est parti à la Corbeille : ferme sans enregistrer (sinon le fichier serait recréé). */
  deleted(rel: string): void;
  flushAll(): Promise<void>;
  list(): string[];
  active(): string | null;
  activeEditor(): EditorHandle | null;
  /** Le fichier de l'onglet a disparu du disque (changement externe). */
  isMissing(rel: string): boolean;
  /** À appeler sur `fs-changed` : recharge, ignore l'écho de nos écritures ou crée une copie de conflit. */
  externalChange(paths: string[]): Promise<void>;
  /**
   * Avant de renommer, déplacer ou supprimer `prefix` (note ou dossier) : attend la fin des écritures en cours des
   * onglets concernés et suspend les suivantes jusqu'à l'appel de la fonction renvoyée. Appeler `renamed`/`deleted`
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
const errText = (e: unknown): string => (typeof e === "string" ? e : e instanceof Error ? e.message : String(e));

/** Nom d'affichage d'une note : son nom de fichier sans `.md`. */
export const noteTitle = (rel: string): string => rel.slice(rel.lastIndexOf("/") + 1).replace(/\.md$/i, "");

/** Dossier et nom de base de la copie de conflit : `<stem> (conflit AAAA-MM-JJ HHmm)`. */
export function conflictName(rel: string, at: Date): { dir: string; base: string } {
  const i = rel.lastIndexOf("/");
  const dir = i >= 0 ? rel.slice(0, i) : "";
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}${pad(at.getMinutes())}`;
  return { dir, base: `${noteTitle(rel)} (conflit ${stamp})` };
}

const under = (rel: string, prefix: string): boolean => rel === prefix || rel.startsWith(prefix + "/");

export function createTabs(o: TabsOptions): TabsController {
  const tabs: Tab[] = [];
  const opening = new Map<string, Promise<boolean>>();
  let activeRel: string | null = null;
  const notify = (m: string): void => (o.notify ?? console.error)(m);
  const changed = (): void => o.onChange?.();
  const now = o.now ?? (() => new Date());
  const find = (rel: string): Tab | undefined => tabs.find((t) => t.rel === rel);

  const show = (rel: string | null): void => {
    // En quittant un onglet, on enregistre tout de suite (et on retente une écriture en échec : pas de nouvel essai automatique).
    const prev = activeRel === null || activeRel === rel ? undefined : find(activeRel);
    if (prev?.saver.pending()) {
      prev.saver.flush().catch((e) => notify(`Enregistrement de « ${noteTitle(prev.rel)} » impossible : ${errText(e)}`));
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
      if (!quiet) notify(`Impossible d'ouvrir « ${noteTitle(rel)} » : ${errText(e)}`);
      return false;
    }
    if (find(rel)) return true;
    const mount = document.createElement("div");
    mount.className = "editor-pane";
    mount.hidden = true;
    o.host.appendChild(mount);
    const tab = {
      rel,
      mount,
      lastKnownMtime: file.mtime_ms,
      diskKnown: file.content,
      writing: null,
      missing: false,
      closed: false,
      check: Promise.resolve(),
      conflicts: [],
      locks: new Set(),
      inflight: null,
      resolving: null,
    } as Partial<Tab> as Tab;
    tab.saver = createAutosaver(
      async (md) => {
        await waitUnlocked(tab);
        // Une version externe en attente de copie bloque l'écriture (le contenu reste en file, pending() reste vrai).
        if (!tab.closed && tab.conflicts.length > 0) await resolveConflicts(tab);
        await waitUnlocked(tab);
        if (tab.closed) return tab.lastKnownMtime; // onglet supprimé : ne jamais recréer le fichier
        tab.writing = md;
        try {
          const p = o.io.writeNote(tab.rel, md);
          tab.inflight = p;
          const mtime = await p;
          tab.lastKnownMtime = mtime;
          tab.diskKnown = md;
          if (tab.missing) {
            tab.missing = false;
            changed();
          }
          return mtime;
        } finally {
          tab.writing = null;
          tab.inflight = null;
        }
      },
      o.autosaveDelayMs ?? 400,
      (e) => notify(`Enregistrement de « ${noteTitle(tab.rel)} » impossible : ${errText(e)}`),
    );
    tab.opts = { markdown: file.content, noteRel: rel, onChange: (md) => tab.saver.schedule(md) };
    tab.editor = o.makeEditor(mount, tab.opts);
    tabs.push(tab);
    if (activeRel === null) show(rel);
    else changed();
    return true;
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
      notify(`Note modifiée hors de MDnote : l'autre version est enregistrée dans « ${noteTitle(c.copy)} ».`);
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

  const checkTab = async (tab: Tab): Promise<void> => {
    if (tab.closed) return;
    const rel = tab.rel;
    let file: NoteFile;
    try {
      file = await o.io.readNote(rel);
    } catch {
      if (tab.closed || tab.rel !== rel) return;
      // Fichier disparu : on garde l'onglet et son contenu, sans recréer le fichier.
      if (!tab.missing) {
        tab.missing = true;
        changed();
      }
      return;
    }
    if (tab.closed || tab.rel !== rel) return;
    if (tab.missing) {
      tab.missing = false;
      changed();
    }
    // Écho de nos propres écritures (ou rien de nouveau) : on compare le contenu, pas seulement le mtime.
    if (file.content === tab.diskKnown || file.content === tab.writing || file.content === tab.editor.getMarkdown()) {
      tab.lastKnownMtime = file.mtime_ms;
      tab.diskKnown = file.content;
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
          ? `Conflit sur « ${noteTitle(tab.rel)} » : copie de l'autre version impossible (${errText(e)}). La note ne sera pas enregistrée tant que la copie n'aura pas réussi.`
          : `Enregistrement de « ${noteTitle(tab.rel)} » impossible : ${errText(e)}`,
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
      try {
        // Des frappes pendant l'enregistrement peuvent remettre du contenu en file : on recommence (borné).
        for (let i = 0; i < 5 && (tab.saver.pending() || tab.conflicts.length > 0); i++) {
          await tab.saver.flush();
          await settleConflicts(tab);
        }
      } catch (e) {
        notify(`« ${noteTitle(tab.rel)} » n'a pas pu être enregistrée, l'onglet reste ouvert : ${errText(e)}`);
        return false;
      }
      if (tab.saver.pending() || tab.conflicts.length > 0) {
        notify(`« ${noteTitle(tab.rel)} » est encore en cours d'enregistrement, l'onglet reste ouvert.`);
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

    renamed(oldRel, newRel) {
      let touched = false;
      for (const t of tabs) {
        if (!under(t.rel, oldRel)) continue;
        const next = newRel + t.rel.slice(oldRel.length);
        if (activeRel === t.rel) activeRel = next;
        t.rel = next;
        t.opts.noteRel = next;
        t.missing = false;
        touched = true;
      }
      if (touched) changed();
    },

    deleted(rel) {
      for (const t of tabs.filter((t) => under(t.rel, rel))) remove(t);
    },

    async flushAll() {
      const results = await Promise.allSettled(
        tabs.map(async (t) => {
          await t.saver.flush();
          await settleConflicts(t);
        }),
      );
      const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failed) throw failed.reason;
    },

    list: () => tabs.map((t) => t.rel),
    active: () => activeRel,
    activeEditor: () => (activeRel === null ? null : (find(activeRel)?.editor ?? null)),
    isMissing: (rel) => find(rel)?.missing ?? false,

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
      let unlock!: () => void;
      const lock = new Promise<void>((r) => (unlock = r));
      const held = tabs.filter((t) => under(t.rel, prefix));
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
