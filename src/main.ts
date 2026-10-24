import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  createNote,
  getSettings,
  onFsChanged,
  readNote,
  rootStatus,
  saveSettings,
  writeNote,
  type RootStatus,
  type Settings,
} from "./api";
import { createEditor } from "./editor/editor";
import { mountSidebar, type SidebarHandle } from "./ui/sidebar";
import { createTabs, noteTitle, type TabsController } from "./ui/tabs";
import { mountTitlebar } from "./ui/titlebar";
import { mountToast } from "./ui/toast";
import { mountToolbar, type ToolbarHandle } from "./ui/toolbar";

/** Délai pendant lequel une seconde demande de fermeture ferme malgré un échec d'enregistrement. */
const FORCE_CLOSE_MS = 5000;

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
  const app = document.getElementById("app") as HTMLElement;
  const ui = buildLayout(app);
  const toast = mountToast(document.body);
  const win = getCurrentWindow();

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
  });

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
  void win
    .onCloseRequested(async (event) => {
      if (Date.now() < forceCloseUntil) return; // seconde demande : on ferme quand même (destroy par l'API)
      event.preventDefault();
      try {
        await tabs?.flushAll();
      } catch (e) {
        forceCloseUntil = Date.now() + FORCE_CLOSE_MS;
        toast(`Certaines notes n'ont pas pu être enregistrées (${errText(e)}). Fermez à nouveau pour quitter quand même.`);
        return;
      }
      await persist(); // sans effet tant que la restauration n'est pas finie : la session d'origine reste en place
      await win.destroy();
    })
    .catch((e) => console.error(e));

  // ---- Raccourcis globaux (phase de capture : avant l'éditeur) ----
  window.addEventListener(
    "keydown",
    (e) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
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

  // ---- Réglages et dossier racine ----
  let settings: Settings | null = null;
  let status: RootStatus = "unset";
  try {
    settings = await getSettings();
    status = settings.root_dir ? await rootStatus() : "unset";
  } catch (e) {
    toast(`Réglages illisibles : ${errText(e)}`);
  }
  if (!settings || status !== "ok") {
    // Écran de premier lancement : tâche 13.
    app.classList.add("no-root");
    ui.emptyState.textContent = "Aucun dossier de notes";
    titlebar.render([]);
    return;
  }
  ui.emptyState.textContent = "Aucune note ouverte — Ctrl+N pour en créer une";

  tabs = createTabs({
    host: ui.editorHost,
    io: { readNote, writeNote, createNote },
    makeEditor: (mount, opts) => {
      opts.onError = toast;
      return createEditor(mount, opts);
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
  void sidebar.refresh();
  void restore.all.finally(() => {
    restoring = false;
    void persist();
  });
}

void main().catch((e) => {
  console.error(e);
  const app = document.getElementById("app");
  if (app) app.textContent = `Erreur au démarrage : ${errText(e)}`;
});
