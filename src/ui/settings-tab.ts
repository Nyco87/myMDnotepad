import type { LocationMode, SettingsLocation } from "../api";
import { errorText, getLanguage, onLanguageChanged, t, type Lang } from "../i18n";
import { DEFAULT_TRANSPARENCY } from "./appearance";

/** Tout ce que l'écran Réglages demande à l'application (injecté : `main.ts` dans l'app, des doubles dans les tests). */
export interface SettingsTabDeps {
  /** Dossier des notes courant (null s'il n'est pas défini). */
  getRoot(): Promise<string | null>;
  getLocation(): Promise<SettingsLocation>;
  getTransparency(): Promise<number>;
  /** « Changer… » : même flux sûr que l'ancien menu (enregistrer tout, puis écran de choix du dossier). */
  changeRoot(): Promise<void>;
  openInExplorer(path: string): Promise<void>;
  /** Boîte « choisir un dossier » ; null si annulée. */
  pickFolder(title: string): Promise<string | null>;
  /** Boîte « choisir un fichier .json » ; null si annulée. */
  pickSettingsFile(): Promise<string | null>;
  moveSettings(destDir: string): Promise<SettingsLocation>;
  /** Valide le fichier (rejette avec SETTINGS_INVALID / SETTINGS_UNREADABLE) sans rien changer. */
  checkSettingsFile(path: string): Promise<{ root_dir: string | null }>;
  /** Adopte le fichier à l'emplacement courant puis recharge l'application. */
  loadSettingsFile(path: string): Promise<void>;
  confirm(message: string, okLabel: string): Promise<boolean>;
  /** `persist` faux pendant le glissement du curseur (aperçu), vrai au relâchement. */
  setTransparency(value: number, persist: boolean): void | Promise<void>;
  setLanguage(lang: Lang): void | Promise<void>;
  openExternal(url: string): Promise<void>;
  version(): Promise<string>;
  notify(message: string): void;
}

export interface SettingsTabHandle {
  readonly el: HTMLElement;
  /** Relit l'état (dossier, emplacement des réglages…) et redessine l'écran. */
  refresh(): Promise<void>;
  destroy(): void;
}

export const GITHUB_URL = "https://github.com/Nyco87/myMDnotepad";
const LIBRARIES = ["Tauri", "ProseMirror", "markdown-it", "mermaid"];

interface State {
  root: string | null;
  location: SettingsLocation | null;
  transparency: number;
  version: string;
}

const MODE_HINT: Record<LocationMode, "settings.file.hint.appdata" | "settings.file.hint.portable" | "settings.file.hint.custom"> = {
  appdata: "settings.file.hint.appdata",
  portable: "settings.file.hint.portable",
  custom: "settings.file.hint.custom",
};

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

/** Écran « Réglages » (monté dans un onglet spécial) : dossier des notes, fichier de réglages, apparence, langue, à propos. */
export function mountSettingsTab(host: HTMLElement, deps: SettingsTabDeps): SettingsTabHandle {
  const el = make("div", "settings");
  el.setAttribute("role", "region");
  host.appendChild(el);
  const state: State = { root: null, location: null, transparency: DEFAULT_TRANSPARENCY, version: "" };
  let busy = false;

  const fail = (key: "settings.file.moveFailed" | "settings.file.loadFailed" | "settings.openFailed", e: unknown): void =>
    deps.notify(t(key, { err: errorText(e) }));

  /** Exécute une action de bouton sans jamais en laisser deux en parallèle (double clic). */
  const guard = (run: () => Promise<void>): (() => void) => () => {
    if (busy) return;
    busy = true;
    void run().finally(() => {
      busy = false;
    });
  };

  const button = (text: string, onClick: () => void, className = "settings-btn"): HTMLButtonElement => {
    const b = make("button", className, text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  };

  const card = (): HTMLElement => make("div", "settings-card");
  const row = (): HTMLElement => make("div", "settings-row");
  /** Groupe flexible (libellé + valeur) ; les boutons vont dans `actions`, qui passe sous la ligne si la place manque. */
  const main = (...kids: HTMLElement[]): HTMLElement => {
    const m = make("div", "settings-main");
    m.append(...kids);
    return m;
  };
  const actions = (...kids: HTMLElement[]): HTMLElement => {
    const a = make("div", "settings-actions");
    a.append(...kids);
    return a;
  };
  const hint = (text: string, cls = ""): HTMLElement => make("div", `settings-hint ${cls}`.trim(), text);
  const pathBox = (path: string | null): HTMLElement => {
    const p = make("span", "settings-path", path ?? t("settings.notes.none"));
    if (path) p.title = path;
    return p;
  };

  // ---- Actions ----
  const openPath = (path: string | null): (() => void) =>
    guard(async () => {
      if (!path) return;
      try {
        await deps.openInExplorer(path);
      } catch (e) {
        fail("settings.openFailed", e);
      }
    });

  const moveTo = async (dir: string | null): Promise<void> => {
    if (!dir) return;
    try {
      const next = await deps.moveSettings(dir);
      state.location = next;
      render();
      deps.notify(t("settings.file.moved", { path: next.path }));
    } catch (e) {
      fail("settings.file.moveFailed", e);
    }
  };

  const onMove = guard(async () => moveTo(await deps.pickFolder(t("settings.file.pickFolder"))));
  const onMoveToAppdata = guard(async () => moveTo(state.location?.default_dir ?? null));

  const onLoad = guard(async () => {
    let path: string | null;
    let incoming: { root_dir: string | null };
    try {
      path = await deps.pickSettingsFile();
      if (!path) return;
      incoming = await deps.checkSettingsFile(path); // invalide : on le dit avant de demander quoi que ce soit
    } catch (e) {
      fail("settings.file.loadFailed", e);
      return;
    }
    const message = t("settings.file.loadConfirmRoot", { root: incoming.root_dir ?? t("settings.file.loadNoRoot") });
    if (!(await deps.confirm(message, t("settings.file.loadOk")))) return;
    try {
      await deps.loadSettingsFile(path);
    } catch (e) {
      fail("settings.file.loadFailed", e);
    }
  });

  const onChangeRoot = guard(async () => {
    await deps.changeRoot();
  });

  // ---- Rendu ----
  function render(): void {
    const scroll = el.scrollTop;
    el.textContent = "";
    el.setAttribute("aria-label", t("settings.title"));
    const body = make("div", "settings-body");
    const section = (title: string): HTMLElement => {
      const h = make("h3", "", title);
      body.appendChild(h);
      const c = card();
      body.appendChild(c);
      return c;
    };

    // Notes
    {
      const c = section(t("settings.notes.h"));
      const r = row();
      const openBtn = button(t("settings.notes.open"), openPath(state.root));
      openBtn.disabled = !state.root;
      r.append(
        main(make("span", "settings-label", t("settings.notes.folder")), pathBox(state.root)),
        actions(openBtn, button(t("settings.notes.change"), onChangeRoot, "settings-btn settings-primary")),
      );
      c.appendChild(r);
    }

    // Fichier de réglages
    {
      const c = section(t("settings.file.h"));
      const loc = state.location;
      const r = row();
      r.appendChild(main(make("span", "settings-label", t("settings.file.location")), pathBox(loc?.path ?? null)));
      r.appendChild(
        actions(
          button(t("settings.file.openFolder"), openPath(loc?.path ?? null)),
          loc?.mode === "portable" ? button(t("settings.file.moveToAppdata"), onMoveToAppdata) : button(t("settings.file.move"), onMove),
          button(t("settings.file.load"), onLoad),
        ),
      );
      c.appendChild(r);
      if (loc) c.appendChild(hint(t(MODE_HINT[loc.mode])));
      if (loc?.warning) c.appendChild(hint(t(`settings.file.warn.${loc.warning}` as const), "settings-warn"));
    }

    // Apparence
    {
      const c = section(t("settings.appearance.h"));
      const r = row();
      const slider = make("input", "settings-slider");
      slider.type = "range";
      slider.min = "0";
      slider.max = "100";
      slider.step = "1";
      slider.value = String(state.transparency);
      slider.setAttribute("aria-label", t("settings.appearance.transparency"));
      slider.addEventListener("input", () => {
        state.transparency = Number(slider.value);
        void Promise.resolve(deps.setTransparency(state.transparency, false)).catch((e) => console.error(e));
      });
      slider.addEventListener("change", () => {
        state.transparency = Number(slider.value);
        void Promise.resolve(deps.setTransparency(state.transparency, true)).catch((e) => deps.notify(errorText(e)));
      });
      r.append(
        make("span", "settings-label", t("settings.appearance.transparency")),
        main(make("span", "settings-end", t("settings.appearance.opaque")), slider, make("span", "settings-end", t("settings.appearance.transparent"))),
      );
      c.append(r, hint(t("settings.appearance.hint")));
    }

    // Langue
    {
      const c = section(t("settings.language.h"));
      const r = row();
      const select = make("select", "settings-select");
      select.setAttribute("aria-label", t("settings.language.label"));
      for (const [value, label] of [
        ["fr", "Français"],
        ["en", "English"],
      ] as const) {
        const o = make("option", "", label);
        o.value = value;
        select.appendChild(o);
      }
      select.value = getLanguage();
      select.addEventListener("change", () => {
        const lang: Lang = select.value === "en" ? "en" : "fr";
        void Promise.resolve(deps.setLanguage(lang)).catch((e) => deps.notify(errorText(e)));
      });
      const label = make("span", "settings-label settings-grow", t("settings.language.label"));
      r.append(label, select);
      c.append(r, hint(t("settings.language.hint")));
    }

    // À propos
    {
      const c = section(t("settings.about.h"));
      c.classList.add("settings-about");
      const icon = make("img", "settings-icon");
      icon.src = new URL("../assets/app-icon.png", import.meta.url).href;
      icon.alt = "";
      icon.width = 48;
      icon.height = 48;
      const info = make("div", "settings-about-info");
      const name = make("div", "");
      name.append(make("b", "", t("app.name")));
      if (state.version) name.append(` · ${t("settings.about.version", { version: state.version })}`);
      const link = make("a", "settings-link", "github.com/Nyco87/myMDnotepad");
      link.href = GITHUB_URL;
      link.addEventListener("click", (e) => {
        e.preventDefault();
        void deps.openExternal(GITHUB_URL).catch((err) => deps.notify(t("settings.openFailed", { err: errorText(err) })));
      });
      const tagline = make("div", "settings-muted");
      tagline.append(`${t("settings.about.tagline")} · `, link);
      info.append(
        name,
        tagline,
        make("div", "settings-muted", t("settings.about.license")),
        make("div", "settings-muted", t("settings.about.libs", { list: LIBRARIES.join(", ") })),
      );
      c.append(icon, info);
    }

    el.appendChild(body);
    el.scrollTop = scroll;
  }

  async function refresh(): Promise<void> {
    const [root, location, transparency, version] = await Promise.all([
      deps.getRoot().catch(() => null),
      deps.getLocation().catch(() => null),
      deps.getTransparency().catch(() => DEFAULT_TRANSPARENCY),
      deps.version().catch(() => ""),
    ]);
    state.root = root;
    state.location = location;
    state.transparency = transparency;
    state.version = version;
    render();
  }

  render();
  const off = onLanguageChanged(render);
  return {
    el,
    refresh,
    destroy() {
      off();
      el.remove();
    },
  };
}
