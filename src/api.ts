import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";

export type Settings = {
  root_dir: string | null;
  open_tabs: string[];
  active_tab: string | null;
  recent_emojis: string[];
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

/** Signale au backend que l'interface est affichée (mesure du temps de démarrage). */
export function markReady(): Promise<void> {
  return invoke<void>("mark_ready");
}

/** URL utilisable dans le webview pour un fichier relatif à la racine (ex. "images/x.png"). */
export function resolveAsset(rel: string): string {
  const base = (root ?? "").replace(/[\\/]+$/, "");
  return convertFileSrc(`${base}/${rel}`);
}

export type TreeNode = { name: string; path: string; kind: "folder" | "note"; children?: TreeNode[] };
export type NoteFile = { content: string; mtime_ms: number };

export function listTree(): Promise<TreeNode> {
  return invoke<TreeNode>("list_tree");
}
export function readNote(rel: string): Promise<NoteFile> {
  return invoke<NoteFile>("read_note", { rel });
}
/**
 * Renvoie le mtime (ms) du fichier écrit. Avec `expectedMtime`, l'écriture est refusée (erreur "CONFLICT")
 * si le fichier existe et a changé depuis ce mtime (modification externe pas encore vue).
 */
export function writeNote(rel: string, content: string, expectedMtime?: number): Promise<number> {
  return invoke<number>("write_note", { rel, content, expectedMtime: expectedMtime ?? null });
}
export function createNote(dirRel: string, baseName: string): Promise<string> {
  return invoke<string>("create_note", { dirRel, baseName });
}
export function createFolder(dirRel: string, baseName: string): Promise<string> {
  return invoke<string>("create_folder", { dirRel, name: baseName });
}
/**
 * Renommage/déplacement réussi : nouveau chemin, et éventuel avertissement (l'élément a bien changé de chemin
 * mais certains liens d'images n'ont pas pu être mis à jour).
 */
export type Moved = { rel: string; warning?: string };

export function renameEntry(rel: string, newName: string): Promise<Moved> {
  return invoke<Moved>("rename_entry", { rel, newName });
}
export function moveEntry(rel: string, destDirRel: string): Promise<Moved> {
  return invoke<Moved>("move_entry", { rel, destDirRel });
}
export function trashEntry(rel: string): Promise<void> {
  return invoke<void>("trash_entry", { rel });
}

/** Enregistre une image (collée) à côté de la note ; renvoie le lien relatif ("images/…"). */
export function saveImage(noteRel: string, bytes: Uint8Array, ext: string): Promise<string> {
  return invoke<string>("save_image", { noteRel, bytes: Array.from(bytes), ext });
}
/** Copie une image du disque à côté de la note ; renvoie le lien relatif ("images/…"). */
export function importImage(noteRel: string, srcAbs: string): Promise<string> {
  return invoke<string>("import_image", { noteRel, srcAbs });
}

/** Abonnement aux changements du dossier de notes (chemins relatifs). Renvoie la fonction de désabonnement. */
export function onFsChanged(cb: (paths: string[]) => void): Promise<() => void> {
  return listen<{ paths: string[] }>("fs-changed", (e) => cb(e.payload.paths));
}

/** Ouvre une URL http(s) / mailto dans le navigateur par défaut (la capacité Tauri refuse tout autre schéma). */
export function openExternal(url: string): Promise<void> {
  return openUrl(url);
}

/** Couleur d'accent de Windows, `#rrggbb`. */
export function getAccentColor(): Promise<string> {
  return invoke<string>("get_accent_color");
}
/** S'abonne aux changements de l'accent de Windows (événement `accent-changed`). */
export function onAccentChanged(cb: (hex: string) => void): Promise<() => void> {
  return listen<string>("accent-changed", (e) => cb(e.payload));
}
