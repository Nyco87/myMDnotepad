// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsLocation } from "../api";
import { setLanguage } from "../i18n";
import { GITHUB_URL, mountSettingsTab, type SettingsTabDeps, type SettingsTabHandle } from "./settings-tab";

const appdata: SettingsLocation = {
  path: "C:/Users/me/AppData/Roaming/myMDnotepad/mymdnotepad.settings.json",
  mode: "appdata",
  default_dir: "C:/Users/me/AppData/Roaming/myMDnotepad",
};
const portable: SettingsLocation = { ...appdata, path: "C:/app/mymdnotepad.settings.json", mode: "portable" };

function setup(
  over: Partial<SettingsTabDeps> = {},
  location: SettingsLocation = appdata,
): { deps: SettingsTabDeps; tab: SettingsTabHandle; host: HTMLElement } {
  const deps: SettingsTabDeps = {
    getRoot: vi.fn(async () => "C:/Notes" as string | null),
    getLocation: vi.fn(async () => location),
    getTransparency: vi.fn(async () => 50),
    changeRoot: vi.fn(async () => {}),
    openInExplorer: vi.fn(async () => {}),
    pickFolder: vi.fn(async () => "D:/OneDrive" as string | null),
    pickSettingsFile: vi.fn(async () => "D:/other.json" as string | null),
    moveSettings: vi.fn(async (dir: string) => ({ ...location, path: `${dir}/mymdnotepad.settings.json`, mode: "custom" as const })),
    checkSettingsFile: vi.fn(async () => ({ root_dir: "E:/Autres notes" as string | null })),
    loadSettingsFile: vi.fn(async () => {}),
    confirm: vi.fn(async () => true),
    setTransparency: vi.fn(),
    setLanguage: vi.fn((l) => setLanguage(l)),
    openExternal: vi.fn(async () => {}),
    version: vi.fn(async () => "0.1.0"),
    notify: vi.fn(),
    ...over,
  };
  const host = document.createElement("div");
  document.body.appendChild(host);
  return { deps, tab: mountSettingsTab(host, deps), host };
}

const buttons = (host: HTMLElement): Record<string, HTMLButtonElement> =>
  Object.fromEntries([...host.querySelectorAll("button")].map((b) => [b.textContent ?? "", b]));
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => setLanguage("fr"));
afterEach(() => {
  document.body.textContent = "";
  setLanguage("fr");
});

describe("settings tab", () => {
  it("shows the notes folder, the settings file location, the version and the libraries", async () => {
    const { tab, host } = setup();
    await tab.refresh();
    const text = host.textContent ?? "";
    expect(text).toContain("C:/Notes");
    expect(text).toContain(appdata.path);
    expect(text).toContain("version 0.1.0");
    for (const lib of ["Tauri", "ProseMirror", "markdown-it", "mermaid"]) expect(text).toContain(lib);
    expect(host.querySelector("h3")?.textContent).toBe("Notes");
  });

  it("opens the notes folder in the explorer and changes it through the safe flow", async () => {
    const { deps, tab, host } = setup();
    await tab.refresh();
    buttons(host)["Ouvrir"].click();
    expect(deps.openInExplorer).toHaveBeenCalledWith("C:/Notes");
    await flush();
    buttons(host)["Changer…"].click();
    expect(deps.changeRoot).toHaveBeenCalledTimes(1);
  });

  it("disables « Ouvrir » when no notes folder is set", async () => {
    const { tab, host } = setup({ getRoot: vi.fn(async () => null) });
    await tab.refresh();
    expect(buttons(host)["Ouvrir"].disabled).toBe(true);
  });

  it("moves the settings file to the chosen folder and says the old one is kept", async () => {
    const { deps, tab, host } = setup();
    await tab.refresh();
    buttons(host)["Déplacer…"].click();
    await flush();
    expect(deps.moveSettings).toHaveBeenCalledWith("D:/OneDrive");
    expect(host.textContent).toContain("D:/OneDrive/mymdnotepad.settings.json");
    expect(vi.mocked(deps.notify).mock.calls[0][0]).toMatch(/conserv/);
  });

  it("does nothing when the folder dialog is cancelled", async () => {
    const { deps, tab, host } = setup({ pickFolder: vi.fn(async () => null) });
    await tab.refresh();
    buttons(host)["Déplacer…"].click();
    await flush();
    expect(deps.moveSettings).not.toHaveBeenCalled();
  });

  it("reports a refused move with a translated message", async () => {
    const { deps, tab, host } = setup({ moveSettings: vi.fn(() => Promise.reject("SETTINGS_DEST_EXISTS")) });
    await tab.refresh();
    buttons(host)["Déplacer…"].click();
    await flush();
    expect(vi.mocked(deps.notify).mock.calls[0][0]).toContain("pas été remplacé");
  });

  it("offers « Déplacer vers AppData » in portable mode and moves to the default folder", async () => {
    const { deps, tab, host } = setup({}, portable);
    await tab.refresh();
    expect(buttons(host)["Déplacer…"]).toBeUndefined();
    expect(host.textContent).toContain("Mode portable");
    buttons(host)["Déplacer vers AppData"].click();
    await flush();
    expect(deps.moveSettings).toHaveBeenCalledWith(appdata.default_dir);
  });

  it("shows a warning when the location pointer was unusable at startup", async () => {
    const { tab, host } = setup({}, { ...appdata, warning: "pointer_missing" });
    await tab.refresh();
    expect(host.querySelector(".settings-warn")?.textContent).toContain("location.json");
  });

  it("loads a settings file only after validating it and confirming the replacement", async () => {
    const { deps, tab, host } = setup();
    await tab.refresh();
    buttons(host)["Charger…"].click();
    await flush();
    expect(deps.checkSettingsFile).toHaveBeenCalledWith("D:/other.json");
    const [message, ok] = vi.mocked(deps.confirm).mock.calls[0];
    expect(message).toContain("Remplacer les réglages actuels");
    expect(message).toContain("E:/Autres notes");
    expect(ok).toBe("Remplacer");
    expect(deps.loadSettingsFile).toHaveBeenCalledWith("D:/other.json");
  });

  it("does not load when the confirmation is refused", async () => {
    const { deps, tab, host } = setup({ confirm: vi.fn(async () => false) });
    await tab.refresh();
    buttons(host)["Charger…"].click();
    await flush();
    expect(deps.loadSettingsFile).not.toHaveBeenCalled();
  });

  it("rejects an invalid file before asking for confirmation", async () => {
    const { deps, tab, host } = setup({ checkSettingsFile: vi.fn(() => Promise.reject("SETTINGS_INVALID")) });
    await tab.refresh();
    buttons(host)["Charger…"].click();
    await flush();
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.loadSettingsFile).not.toHaveBeenCalled();
    expect(vi.mocked(deps.notify).mock.calls[0][0]).toContain("pas un fichier de réglages valide");
  });

  it("previews the transparency while dragging and saves it on release", async () => {
    const { deps, tab, host } = setup();
    await tab.refresh();
    const slider = host.querySelector<HTMLInputElement>("input[type=range]")!;
    expect(slider.value).toBe("50");
    slider.value = "80";
    slider.dispatchEvent(new Event("input"));
    expect(deps.setTransparency).toHaveBeenLastCalledWith(80, false);
    slider.dispatchEvent(new Event("change"));
    expect(deps.setTransparency).toHaveBeenLastCalledWith(80, true);
  });

  it("switches the language of the whole screen at once", async () => {
    const { deps, tab, host } = setup();
    await tab.refresh();
    const select = host.querySelector<HTMLSelectElement>("select")!;
    expect(select.value).toBe("fr");
    select.value = "en";
    select.dispatchEvent(new Event("change"));
    expect(deps.setLanguage).toHaveBeenCalledWith("en");
    const t = host.textContent ?? "";
    expect(t).toContain("Notes folder");
    expect(t).toContain("Settings file");
    expect(t).toContain("Window transparency");
    expect(t).not.toContain("Dossier des notes");
    expect(host.querySelector<HTMLSelectElement>("select")!.value).toBe("en");
  });

  it("opens the GitHub page through the opener, never as a navigation", async () => {
    const { deps, tab, host } = setup();
    await tab.refresh();
    const link = host.querySelector<HTMLAnchorElement>("a.settings-link")!;
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(deps.openExternal).toHaveBeenCalledWith(GITHUB_URL);
    expect(GITHUB_URL).toBe("https://github.com/Nyco87/myMDnotepad");
  });

  it("destroy removes the screen and stops following the language", async () => {
    const { tab, host } = setup();
    await tab.refresh();
    tab.destroy();
    expect(host.children.length).toBe(0);
    setLanguage("en"); // ne doit rien lever
  });
});
