import { invoke, convertFileSrc } from "@tauri-apps/api/core";

export type WindowEffect = "acrylic" | "mica";
export type Settings = {
  root_dir: string | null;
  open_tabs: string[];
  active_tab: string | null;
  recent_emojis: string[];
  window_effect: WindowEffect;
};
export type RootStatus = "ok" | "unset" | "missing";

// Dossier racine absolu mis en cache (mis à jour par getSettings et setRoot).
let root: string | null = null;

export async function getSettings(): Promise<Settings> {
  const s = await invoke<Settings>("get_settings");
  root = s.root_dir;
  return s;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await invoke<void>("save_settings", { settings });
  root = settings.root_dir;
}

export async function setRoot(absPath: string): Promise<void> {
  await invoke<void>("set_root", { abs: absPath });
  root = absPath;
}

export function rootStatus(): Promise<RootStatus> {
  return invoke<RootStatus>("root_status");
}

export function setWindowEffect(effect: WindowEffect): Promise<void> {
  return invoke<void>("set_window_effect", { effect });
}

/** URL utilisable dans le webview pour un fichier relatif à la racine (ex. "images/x.png"). */
export function resolveAsset(rel: string): string {
  const base = (root ?? "").replace(/[\\/]+$/, "");
  return convertFileSrc(`${base}/${rel}`);
}

export type TreeNode = { name: string; rel: string; is_dir: boolean; children: TreeNode[] };
export type NoteFile = { rel: string; content: string; mtime: number };

export function listTree(): Promise<TreeNode> {
  return invoke<TreeNode>("list_tree");
}
export function readNote(rel: string): Promise<NoteFile> {
  return invoke<NoteFile>("read_note", { rel });
}
/** Renvoie le mtime (ms) du fichier écrit. */
export function writeNote(rel: string, content: string): Promise<number> {
  return invoke<number>("write_note", { rel, content });
}
export function createNote(dirRel: string, baseName: string): Promise<string> {
  return invoke<string>("create_note", { dirRel, baseName });
}
export function createFolder(dirRel: string, name: string): Promise<string> {
  return invoke<string>("create_folder", { dirRel, name });
}
export function renameEntry(rel: string, newName: string): Promise<string> {
  return invoke<string>("rename_entry", { rel, newName });
}
export function moveEntry(rel: string, destDirRel: string): Promise<string> {
  return invoke<string>("move_entry", { rel, destDirRel });
}
export function trashEntry(rel: string): Promise<void> {
  return invoke<void>("trash_entry", { rel });
}
