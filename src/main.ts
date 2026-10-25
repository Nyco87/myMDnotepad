import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  createNote,
  getSettings,
  onFsChanged,
  readNote,
  markReady,
  rootStatus,
  saveSettings,
  writeNote,
  type RootStatus,
  type Settings,
} from "./api";
import type { EditorView } from "prosemirror-view";
import { editDiagramAt } from "./diagram/insert";
import { createEditor } from "./editor/editor";
import { holdDiagramRendering, releaseDiagramRendering } from "./editor/mermaid-view";
import { cursorAnchor } from "./editor/slash";
import { buildSlashCommands } from "./editor/slash-commands";
import { initAccent } from "./ui/accent";
import { showContextMenu } from "./ui/context-menu";
import { showFirstRun } from "./ui/first-run";
import { mountSidebar, type SidebarHandle } from "./ui/sidebar";
import { createTabs, noteTitle, type TabsController } from "./ui/tabs";
import { mountTitlebar } from "./ui/titlebar";
import { mountToast } from "./ui/toast";
import { mountToolbar, type ToolbarHandle } from "./ui/toolbar";

/** Délai pendant lequel une seconde demande de fermeture ferme malgré un échec d'enregistrement. */
const FORCE_CLOSE_MS = 5000;
/** Clé de sessionStorage : relance l'écran de choix du dossier après « Changer de dossier de notes… ». */
const CHANGE_ROOT_KEY = "mdnote.changeRoot";

const errText = (e: unknown): string => (typeof e === "string" ? e : e instanceof Error ? e.message : String(e));

interface Layout {
  titlebar: HTMLElement;
  toolbar: HTMLElement;
  sidebar: HTMLElement;
  editorHost: HTMLElement;
  emptyState: HTMLElement;
}

/** Barre de titre → bandeau → (arborescence | éditeur), selon la maquette dark-fluent-v2. */
function buildLayout(app: HTMLElement): Layout {
  app.textContent = "";
  app.className = "app";
  const titlebar = document.createElement("header");
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar-host";
  const body = document.createElement("div");
  body.className = "app-body";
  const sidebar = document.createElement("aside");
  sidebar.className = "sidebar-host";
  const editorHost = document.createElement("section");
  editorHost.className = "editor-host";
  const emptyState = document.createElement("div");
  emptyState.className = "empty-state";
  editorHost.appendChild(emptyState);
  body.append(sidebar, editorHost);
  app.append(titlebar, toolbar, body);
  return { titlebar, toolbar, sidebar, editorHost, emptyState };
}

async function main(): Promise<void> {
  holdDiagramRendering(); // mermaid ne se charge qu'une fois la fenêtre prête (voir `ready`)
  const app = document.getElementById("app") as HTMLElement;
  const ui = buildLayout(app);
  const toast = mountToast(document.body);
  const win = getCurrentWindow();
  void initAccent(); // sans attendre : la couleur Windows s'applique dès qu'elle est lue, le repli CSS sert d'ici là

  let tabs: TabsController | null = null;
  let toolbar: ToolbarHandle | null = null;
  let sidebar: SidebarHandle | null = null;
  let restoring = true;
  let lastActive: string | null = null;

  const isRenaming = (): boolean => document.activeElement?.classList.contains("sb-rename") ?? false;
  /** Donne le focus à l'éditeur actif, sauf si l'utilisateur est en train de nommer une note dans l'arborescence. */
  const focusEditor = (): void => {
    if (!isRenaming()) tabs?.activeEditor()?.view.focus();
  };

  // ---- Session : enregistrée à chaque changement (lecture-modification-écriture, sérialisée) ----
  let persistChain: Promise<void> = Promise.resolve();
  let persistQueued = false;
  const persist = (): Promise<void> => {
    if (!tabs || restoring || persistQueued) return persistChain;
    persistQueued = true;
    persistChain = persistChain
      .then(async () => {
        persistQueued = false;
        if (!tabs) return;
        const open = tabs.list();
        const active = tabs.active();
        // Relire les réglages : le bandeau enregistre aussi (emojis récents).
        const s = await getSettings();
        if (s.active_tab === active && s.open_tabs.length === open.length && s.open_tabs.every((r, i) => r === open[i])) return;
        await saveSettings({ ...s, open_tabs: open, active_tab: active });
      })
      .catch((e) => toast(`Session non enregistrée : ${errText(e)}`));
    return persistChain;
  };

  const titlebar = mountTitlebar(ui.titlebar, {
    onActivate: (rel) => {
      tabs?.activate(rel);
      focusEditor();
    },
    onClose: (rel) => void tabs?.close(rel).then(focusEditor),
    onNew: () => void sidebar?.newNote(),
    onMenu: (r) => openMenu(r),
  });

  // ---- Menu « ⋯ » ----
  const changeRoot = async (): Promise<void> => {
    try {
      await tabs?.flushAll();
    } catch (e) {
      toast(`Certaines notes n'ont pas pu être enregistrées, le dossier n'a pas été changé (${errText(e)}).`);
      return;
    }
    try {
      restoring = true; // plus aucune écriture de session pendant le changement
      const s = await getSettings();
      await saveSettings({ ...s, open_tabs: [], active_tab: null });
      sessionStorage.setItem(CHANGE_ROOT_KEY, "1");
    } catch (e) {
      restoring = false;
      toast(`Changement de dossier impossible : ${errText(e)}`);
      return;
    }
    location.reload(); // ferme les onglets et repart sur l'écran de premier lancement
  };
  function openMenu(anchor: DOMRect): void {
    showContextMenu(anchor.left, anchor.bottom + 2, [
      { label: "Changer de dossier de notes…", action: () => void changeRoot() },
    ]);
  }

  const onTabsChange = (): void => {
    if (!tabs) return;
    const active = tabs.active();
    titlebar.render(
      tabs.list().map((rel) => ({ rel, title: noteTitle(rel), active: rel === active, missing: tabs!.isMissing(rel) })),
    );
    ui.emptyState.hidden = tabs.list().length > 0;
    toolbar?.refresh();
    if (active !== lastActive) {
      lastActive = active;
      if (active) sidebar?.select(active);
    }
    void persist();
  };

  // ---- Fermeture : tout enregistrer d'abord ----
  let forceCloseUntil = 0;
  let forceNext = false; // l'enregistrement dure trop longtemps : la prochaine demande ferme quand même
  let closing = false;
  const destroy = (): Promise<void> => win.destroy().catch((e) => toast(`Fermeture impossible : ${errText(e)}`));
  void win
    .onCloseRequested(async (event) => {
      event.preventDefault();
      if (forceNext || Date.now() < forceCloseUntil) {
        await destroy(); // seconde demande après un échec ou un enregistrement trop long : on ferme quand même
        return;
      }
      if (closing) return; // une fermeture est déjà en cours
      closing = true;
      const slow = setTimeout(() => {
        forceNext = true;
        toast("L'enregistrement est long. Fermez à nouveau pour quitter quand même.");
      }, FORCE_CLOSE_MS);
      try {
        try {
          await tabs?.flushAll();
        } catch (e) {
          forceCloseUntil = Date.now() + FORCE_CLOSE_MS;
          toast(`Certaines notes n'ont pas pu être enregistrées (${errText(e)}). Fermez à nouveau pour quitter quand même.`);
          return;
        }
        await persist(); // sans effet tant que la restauration n'est pas finie : la session d'origine reste en place
        await destroy();
      } finally {
        clearTimeout(slow);
        closing = false;
      }
    })
    .catch((e) => console.error(e));

  // ---- Raccourcis globaux (phase de capture : avant l'éditeur) ----
  window.addEventListener(
    "keydown",
    (e) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      // Le champ de renommage de l'arborescence garde ses touches.
      if (e.target instanceof HTMLElement && e.target.classList.contains("sb-rename")) return;
      const key = e.key.toLowerCase();
      if (key === "n" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        void sidebar?.newNote();
      } else if (key === "w" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        const active = tabs?.active();
        if (active) void tabs!.close(active).then(focusEditor);
      } else if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        tabs?.next(e.shiftKey ? -1 : 1);
        focusEditor();
      }
    },
    true,
  );

  let readyCalled = false;
  const ready = (): void => {
    if (readyCalled) return;
    readyCalled = true;
    void markReady().catch((e) => console.error(e));
    releaseDiagramRendering();
  };

  /** Monte l'espace de travail (onglets, bandeau, arborescence) pour le dossier courant. */
  const startWorkspace = async (settings: Settings): Promise<void> => {
    app.classList.remove("no-root");
    ui.emptyState.hidden = false;
    ui.emptyState.textContent = "Aucune note ouverte — Ctrl+N pour en créer une";

    // Menu « / » : les commandes qui ouvrent une fenêtre passent par la barre d'outils, ancrées sur le curseur.
    const viaToolbar = (id: string) => (view: EditorView) => toolbar?.invoke(id, cursorAnchor(view));
    const slashCommands = buildSlashCommands({
      table: viaToolbar("table"),
      link: viaToolbar("link"),
      image: viaToolbar("image"),
      symbols: viaToolbar("emoji"),
      diagram: viaToolbar("diagram"),
    });

    tabs = createTabs({
      host: ui.editorHost,
      io: { readNote, writeNote, createNote },
      makeEditor: (mount, opts) => {
        opts.onError = toast;
        opts.slashCommands = () => slashCommands;
        const editor = createEditor(mount, opts);
        // Clic sur un dessin : l'atelier s'ouvre avec son code (chargé à la demande, comme mermaid).
        opts.onEditDiagram = (pos, code) => void editDiagramAt(editor.view, pos, code, toast);
        return editor;
      },
      notify: toast,
      onChange: onTabsChange,
    });
    toolbar = mountToolbar(
      ui.toolbar,
      () => tabs?.activeEditor()?.view ?? null,
      () => tabs?.active() ?? "",
      toast,
    );
    sidebar = mountSidebar(ui.sidebar, {
      beforeMutate: (rel) => (tabs ? tabs.lockUnder(rel) : Promise.resolve()),
      onOpen: (rel) =>
        void tabs?.open(rel).then((ok) => {
          if (ok) focusEditor();
        }),
      onRenamed: (oldRel, newRel) => tabs?.renamed(oldRel, newRel),
      onDeleted: (rel) => tabs?.deleted(rel),
      onError: toast,
    });
    onTabsChange();

    void onFsChanged((paths) => void tabs?.externalChange(paths)).catch((e) => toast(`Surveillance du dossier impossible : ${errText(e)}`));

    // Démarrage rapide : l'onglet actif d'abord, puis l'arborescence et les autres onglets sans bloquer.
    const restore = tabs.restore(settings.open_tabs ?? [], settings.active_tab);
    await restore.active;
    focusEditor();
    ready();
    void sidebar.refresh();
    void restore.all.finally(() => {
      restoring = false;
      void persist();
    });
  };

  try {
    // ---- Réglages et dossier racine (en parallèle) ----
    let settings: Settings | null = null;
    let status: RootStatus = "unset";
    try {
      [settings, status] = await Promise.all([getSettings(), rootStatus()]);
    } catch (e) {
      toast(`Réglages illisibles : ${errText(e)}`);
    }
    let forceChange = false;
    try {
      forceChange = sessionStorage.getItem(CHANGE_ROOT_KEY) === "1";
      sessionStorage.removeItem(CHANGE_ROOT_KEY);
    } catch {
      /* stockage indisponible : on ignore */
    }

    if (!settings || forceChange || status !== "ok") {
      // Premier lancement, dossier introuvable ou changement de dossier.
      app.classList.add("no-root");
      titlebar.render([]);
      const reason = status === "missing" && !forceChange ? "missing" : "unset";
      const shown = showFirstRun(ui.emptyState, reason, settings?.root_dir ?? undefined);
      ready();
      await shown;
      // Nouveau dossier : les onglets de l'ancien ne s'y appliquent pas.
      settings = { ...(await getSettings()), open_tabs: [], active_tab: null };
    }
    await startWorkspace(settings);
  } catch (e) {
    // La barre de titre (boutons de fenêtre) reste utilisable ; l'erreur s'affiche à la place de l'éditeur.
    console.error(e);
    app.classList.add("no-root");
    ui.emptyState.hidden = false;
    ui.emptyState.textContent = `Erreur au démarrage : ${errText(e)}`;
    ready();
  }
}

void main().catch((e) => {
  console.error(e);
  const app = document.getElementById("app");
  if (app) app.textContent = `Erreur au démarrage : ${errText(e)}`;
});
