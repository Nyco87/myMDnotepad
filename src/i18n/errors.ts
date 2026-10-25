/**
 * Les messages d'erreur du backend Rust sont écrits en français (et les codes `SETTINGS_*` / `PATH_NOT_FOUND`
 * sont des identifiants) : en anglais, on les traduit ici. En français, le texte est renvoyé tel quel.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts any i18n key
type T = (key: any, params?: Record<string, string | number>) => string;

const RULES: [RegExp, string][] = [
  [/^Une note ou un dossier porte déjà ce nom\.$/, "A note or folder with this name already exists."],
  [/^Le nom ne peut pas être vide\.$/, "The name cannot be empty."],
  [/^Le nom est trop long \(200 caractères maximum\)\.$/, "The name is too long (200 characters maximum)."],
  [/^Le nom contient un caractère interdit : (.*)$/s, "The name contains a forbidden character: $1"],
  [/^Le nom ne peut pas finir par un point ou un espace\.$/, "The name cannot end with a dot or a space."],
  [/^Ce nom est réservé par Windows\.$/, "This name is reserved by Windows."],
  [/^Le dossier de destination n'existe pas\.$/, "The destination folder does not exist."],
  [/^Impossible de créer la note : (.*)$/s, "Cannot create the note: $1"],
  [/^Impossible de créer le dossier des images : (.*)$/s, "Cannot create the images folder: $1"],
  [/^Impossible de créer le dossier des réglages : (.*)$/s, "Cannot create the settings folder: $1"],
  [/^Impossible de créer le dossier : (.*)$/s, "Cannot create the folder: $1"],
  [/^Impossible de copier l'image : (.*)$/s, "Cannot copy the image: $1"],
  [/^Impossible de déplacer l'image : (.*)$/s, "Cannot move the image: $1"],
  [/^Déplacement effectué, mais certains liens d'images n'ont pas pu être mis à jour : (.*)$/s, "Moved, but some image links could not be updated: $1"],
  [/^Impossible de renommer le dossier racine\.$/, "Cannot rename the root folder."],
  [/^Impossible de renommer : (.*)$/s, "Cannot rename: $1"],
  [/^L'élément à renommer n'existe plus\.$/, "The item to rename no longer exists."],
  [/^Impossible de déplacer le dossier racine\.$/, "Cannot move the root folder."],
  [/^L'élément à déplacer n'existe plus\.$/, "The item to move no longer exists."],
  [/^Impossible de déplacer un dossier dans lui-même\.$/, "Cannot move a folder into itself."],
  [/^Impossible de déplacer : (.*)$/s, "Cannot move: $1"],
  [/^Impossible de supprimer le dossier racine\.$/, "Cannot delete the root folder."],
  [/^L'élément à supprimer n'existe plus\.$/, "The item to delete no longer exists."],
  [/^Impossible de mettre à la corbeille : (.*)$/s, "Cannot move to the Recycle Bin: $1"],
  [/^Impossible d'enregistrer l'image : (.*)$/s, "Cannot save the image: $1"],
  [/^Format d'image non pris en charge \(png, jpg, jpeg, gif, webp\)\.$/, "Unsupported image format (png, jpg, jpeg, gif, webp)."],
  [/^Impossible de lire l'image : (.*)$/s, "Cannot read the image: $1"],
  [/^Impossible d'écrire le fichier : (.*)$/s, "Cannot write the file: $1"],
  [/^Ce dossier n'existe pas : (.*)$/s, "This folder does not exist: $1"],
  [/^Impossible de lire la note : (.*)$/s, "Cannot read the note: $1"],
  [/^Cette note n'est pas encodée en UTF-8 : ouverture refusée pour ne pas l'abîmer\.$/, "This note is not UTF-8 encoded: opening refused so it is not damaged."],
  [/^Chemin invalide \(caractère « \\ » interdit\) : (.*)$/s, "Invalid path (the \"\\\" character is not allowed): $1"],
  [/^Chemin absolu interdit : (.*)$/s, "Absolute path not allowed: $1"],
  [/^Chemin hors du dossier de notes : (.*)$/s, "Path outside the notes folder: $1"],
  [/^Chemin invalide( : (.*))?$/s, "Invalid path$1"],
  [/^Impossible de surveiller le dossier : (.*)$/s, "Cannot watch the folder: $1"],
  [/^Impossible d'enregistrer les réglages : (.*)$/s, "Cannot save the settings: $1"],
  [/^Impossible d'autoriser l'accès aux images : (.*)$/s, "Cannot allow access to images: $1"],
  [/^Réglages indisponibles$/, "Settings unavailable"],
  [/^Aucun dossier de notes n'est défini$/, "No notes folder is set"],
  [/^Ce dossier n'existe pas : (.*)$/s, "This folder does not exist: $1"],
];

const CODES = ["SETTINGS_UNREADABLE", "SETTINGS_INVALID", "SETTINGS_NO_KNOWN_KEYS", "SETTINGS_DEST_INVALID", "SETTINGS_DEST_EXISTS", "SETTINGS_OLD_LOCKED", "PATH_NOT_FOUND"];

export function localizeError(raw: string, lang: "fr" | "en", t: T): string {
  const code = CODES.find((c) => raw === c || raw.endsWith(`: ${c}`));
  if (code) return t(`err.${code}`);
  if (lang === "fr") return raw;
  for (const [re, en] of RULES) {
    if (re.test(raw)) return raw.replace(re, en);
  }
  return raw;
}
