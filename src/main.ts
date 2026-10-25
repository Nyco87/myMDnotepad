import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as pickPath } from "@tauri-apps/plugin-dialog";
import {
  checkSettingsFile,
  createNote,
  getSettings,
  getSettingsLocation,
  loadSettingsFile,
  moveSettings,
  onFsChanged,
  openExternal,
  openInExplorer,
  readNote,
  markReady,
  rootStatus,
  updateSettings,
  setTransparency,
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
import { detectLanguage, errorText, isLang, onLanguageChanged, setLanguage, t, tr } from "./i18n";
import { initAccent } from "./ui/accent";
import { applyTransparencyCss, DEFAULT_TRANSPARENCY } from "./ui/appearance";
import { confirmDialog } from "./ui/confirm-dialog";
import { showFirstRun } from "./ui/first-run";
import { mountSidebar, type SidebarHandle } from "./ui/sidebar";
import { mountSidebarPanel, type SidebarPanelHandle } from "./ui/sidebar-panel";
import { createTabs, NOT_FOUND, noteTitle, type TabsController } from "./ui/tabs";
import { mountSettingsTab, type SettingsTabHandle } from "./ui/settings-tab";
import { mountTitlebar, SETTINGS_TAB, type TabView } from "./ui/titlebar";
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
  /** Conteneur de l'onglet Réglages (caché tant que cet onglet n'est pas affiché). */
  settingsHost: HTMLElement;
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
  const settingsHost = document.createElement("div");
  settingsHost.className = "settings-host";
  settingsHost.hidden = true;
  editorHost.append(emptyState, settingsHost);
  body.append(sidebar, editorHost);
  app.append(titlebar, toolbar, body);
  return { titlebar, toolbar, sidebar, editorHost, emptyState, settingsHost };
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
  let sidebarPanel: SidebarPanelHandle | null = null;
  let restoring = true;
  let lastActive: string | null = null;
  // Onglet Réglages : un seul à la fois, jamais enregistré ni restauré (ce n'est pas une note).
  let view: "notes" | "settings" = "notes";
  let settingsTab: SettingsTabHandle | null = null;
  let holdSettings = false; // fermeture d'une note pendant que Réglages est affiché : on y reste

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
        await updateSettings({ open_tabs: open, active_tab: active });
      })
      .catch((e) => toast(t("main.sessionNotSaved", { err: errorText(e) })));
    return persistChain;
  };

  /** Un schéma en cours d'édition ne doit pas être abandonné en silence par une fermeture d'onglet. */
  const workshopBlocksClose = (): boolean => {
    if (!document.querySelector(".ws-overlay")) return false;
    toast(t("main.finishDiagram"));
    return true;
  };

  const renderTitlebar = (): void => {
    const active = tabs?.active() ?? null;
    const list: TabView[] = (tabs?.list() ?? []).map((rel) => ({
      rel,
      title: noteTitle(rel),
      active: view === "notes" && rel === active,
      missing: tabs!.isMissing(rel),
    }));
    if (settingsTab) list.push({ rel: SETTINGS_TAB, title: t("titlebar.settings"), active: view === "settings", missing: false });
    titlebar.render(list);
  };

  /** Affiche les notes ou l'onglet Réglages (l'éditeur actif reste monté, seulement caché). */
  const setView = (next: "notes" | "settings"): void => {
    view = next;
    app.classList.toggle("settings-view", next === "settings");
    ui.settingsHost.hidden = next !== "settings";
    renderTitlebar();
    toolbar?.refresh();
  };

  const titlebar = mountTitlebar(ui.titlebar, {
    onActivate: (rel) => {
      if (rel === SETTINGS_TAB) return setView("settings");
      setView("notes");
      tabs?.activate(rel);
      focusEditor();
    },
    onClose: (rel) => {
      if (rel === SETTINGS_TAB) return closeSettings();
      if (workshopBlocksClose()) return;
      holdSettings = view === "settings";
      void tabs?.close(rel).then(() => {
        holdSettings = false;
        if (view === "notes") focusEditor();
      });
    },
    onNew: () => void sidebar?.newNote(),
    onSettings: () => void openSettings(),
  });

  // ---- Changement de dossier (bouton « Changer… » de l'onglet Réglages) ----
  const changeRoot = async (): Promise<void> => {
    try {
      await tabs?.flushAll();
    } catch (e) {
      toast(t("main.notesNotSaved", { err: errorText(e) }));
      return;
    }
    try {
      restoring = true; // plus aucune écriture de session pendant le changement
      await updateSettings({ open_tabs: [], active_tab: null });
      sessionStorage.setItem(CHANGE_ROOT_KEY, "1");
    } catch (e) {
      restoring = false;
      toast(t("main.changeRootFailed", { err: errorText(e) }));
      return;
    }
    location.reload(); // ferme les onglets et repart sur l'écran de premier lancement
  };

  // ---- Onglet Réglages ----
  let previewTimer: ReturnType<typeof setTimeout> | null = null;
  let previewAt = 0;
  /** Aperçu en direct : le voile CSS suit tout de suite, l'acrylique natif au plus toutes les 50 ms. */
  const setTransparencyLive = (value: number, persist: boolean): Promise<void> => {
    applyTransparencyCss(value);
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = null;
    if (persist) return setTransparency(value, true);
    const wait = previewAt + 50 - Date.now();
    const send = (): void => {
      previewAt = Date.now();
      void setTransparency(value, false).catch((e) => console.error(e));
    };
    if (wait <= 0) send();
    else previewTimer = setTimeout(send, wait);
    return Promise.resolve();
  };
  const openSettings = async (): Promise<void> => {
    if (!tabs) return; // pas encore d'espace de travail (écran de premier lancement)
    if (!settingsTab) {
      settingsTab = mountSettingsTab(ui.settingsHost, {
        getRoot: async () => (await getSettings()).root_dir,
        getLocation: getSettingsLocation,
        getTransparency: async () => (await getSettings()).transparency ?? DEFAULT_TRANSPARENCY,
        changeRoot,
        openInExplorer,
        pickFolder: async (title) => {
          const p = await pickPath({ directory: true, title });
          return typeof p === "string" ? p : null;
        },
        pickSettingsFile: async () => {
          const p = await pickPath({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
          return typeof p === "string" ? p : null;
        },
        moveSettings,
        checkSettingsFile,
        loadSettingsFile: async (path) => {
          await tabs?.flushAll(); // rien ne doit se perdre : on enregistre avant de remplacer les réglages
          restoring = true; // la session en cours n'écrase pas les réglages chargés
          try {
            await loadSettingsFile(path);
          } catch (e) {
            restoring = false;
            throw e;
          }
          location.reload();
        },
        confirm: (message, okLabel) => confirmDialog(message, okLabel),
        setTransparency: setTransparencyLive,
        setLanguage: async (lang) => {
          setLanguage(lang);
          await updateSettings({ language: lang }); // fusion côté Rust : aucun autre réglage n'est ré-écrit
        },
        openExternal,
        version: getVersion,
        notify: toast,
      });
    }
    setView("settings");
    await settingsTab.refresh();
  };
  function closeSettings(): void {
    settingsTab?.destroy();
    settingsTab = null;
    setView("notes");
    focusEditor();
  }
  onLanguageChanged(() => renderTitlebar());

  const onTabsChange = (): void => {
    if (!tabs) return;
    const active = tabs.active();
    // Une autre note devient active (ouverture, Ctrl+Tab…) : on quitte l'onglet Réglages.
    if (view === "settings" && !holdSettings && active !== null && active !== lastActive) {
      view = "notes";
      app.classList.remove("settings-view");
      ui.settingsHost.hidden = true;
    }
    renderTitlebar();
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
  const destroy = (): Promise<void> => win.destroy().catch((e) => toast(t("main.closeFailed", { err: errorText(e) })));
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
        toast(t("main.savingLong"));
      }, FORCE_CLOSE_MS);
      try {
        try {
          await tabs?.flushAll();
        } catch (e) {
          forceCloseUntil = Date.now() + FORCE_CLOSE_MS;
          toast(t("main.closeAgain", { err: errorText(e) }));
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
      } else if (e.key === "\\" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        sidebarPanel?.toggle();
      } else if (key === "w" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        if (view === "settings") return closeSettings();
        const active = tabs?.active();
        if (workshopBlocksClose()) return;
        if (active) void tabs!.close(active).then(focusEditor);
      } else if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        if (view === "settings") setView("notes");
        else tabs?.next(e.shiftKey ? -1 : 1);
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

  /** Ctrl+clic sur un lien vers une note : l'ouvre dans un onglet, ou signale qu'elle n'existe pas. */
  const openLinkedNote = async (rel: string): Promise<void> => {
    if (!tabs) return;
    const known = tabs.list().find((t) => t.toLowerCase() === rel.toLowerCase());
    if (known) rel = known;
    if (!known) {
      try {
        await readNote(rel);
      } catch (e) {
        if (errText(e) === NOT_FOUND) return toast(t("main.noteNotFound", { rel }));
        // autre erreur : tabs.open la signalera elle-même
      }
    }
    if (await tabs.open(rel)) {
      if (view === "settings") setView("notes");
      focusEditor();
    }
  };

  /** Monte l'espace de travail (onglets, bandeau, arborescence) pour le dossier courant. */
  const startWorkspace = async (settings: Settings): Promise<void> => {
    app.classList.remove("no-root");
    ui.emptyState.hidden = false;
    tr(ui.emptyState, { text: "main.emptyState" });

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
        opts.links = () => ({
          openExternal: (url) => void openExternal(url).catch((e) => toast(t("main.linkFailed", { err: errorText(e) }))),
          openNote: (rel) => void openLinkedNote(rel),
        });
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
          if (!ok) return;
          if (view === "settings") setView("notes");
          focusEditor();
        }),
      onRenamed: (oldRel, newRel) => tabs?.renamed(oldRel, newRel),
      onDeleted: (rel) => tabs?.deleted(rel),
      onError: toast,
    });
    sidebarPanel = mountSidebarPanel(ui.sidebar, {
      width: settings.sidebar_width ?? null,
      collapsed: settings.sidebar_collapsed ?? false,
      onChange: (patch) => void updateSettings(patch).catch((e) => console.error("sidebar layout not saved", e)),
      newNote: () => void sidebar?.newNote(),
    });
    onTabsChange();

    void onFsChanged((paths) => void tabs?.externalChange(paths)).catch((e) => toast(t("main.watchFailed", { err: errorText(e) })));

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
      toast(t("main.settingsUnreadable", { err: errorText(e) }));
    }
    setLanguage(isLang(settings?.language) ? settings.language : detectLanguage());
    applyTransparencyCss(settings?.transparency ?? DEFAULT_TRANSPARENCY);
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
    delete ui.emptyState.dataset.i18nText;
    ui.emptyState.textContent = t("main.startupError", { err: errorText(e) });
    ready();
  }
}

void main().catch((e) => {
  console.error(e);
  const app = document.getElementById("app");
  if (app) app.textContent = t("main.startupError", { err: errorText(e) });
});
