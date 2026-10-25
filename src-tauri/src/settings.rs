use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Manager, State};

const FILE_NAME: &str = "mymdnotepad.settings.json";
const APPDATA_DIR: &str = "myMDnotepad";
const POINTER_NAME: &str = "location.json";
/// Nom sous lequel l'ancien fichier portable est conservé (jamais supprimé) quand on le déplace hors de l'exe.
const MOVED_PORTABLE_NAME: &str = "mymdnotepad.settings.moved.json";
/// Anciens noms (avant le renommage en myMDnotepad) : lus une fois pour migration, jamais supprimés.
const LEGACY_FILE_NAME: &str = "mdnote.settings.json";
const LEGACY_APPDATA_DIR: &str = "MDnote";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct Settings {
    pub root_dir: Option<String>,
    pub open_tabs: Vec<String>,
    pub active_tab: Option<String>,
    pub recent_emojis: Vec<String>,
    /// 0 = voile opaque, 100 = voile transparent (50 = rendu historique).
    pub transparency: u8,
    /// "fr" | "en" ; `None` = langue de Windows.
    pub language: Option<String>,
    /// Largeur du panneau latéral en px (`None` = défaut de l'interface).
    pub sidebar_width: Option<u16>,
    /// Panneau latéral réduit à une bande étroite.
    pub sidebar_collapsed: bool,
}

pub const DEFAULT_TRANSPARENCY: u8 = 50;

impl Default for Settings {
    fn default() -> Self {
        Settings {
            root_dir: None,
            open_tabs: vec![],
            active_tab: None,
            recent_emojis: vec![],
            transparency: DEFAULT_TRANSPARENCY,
            language: None,
            sidebar_width: None,
            sidebar_collapsed: false,
        }
    }
}

pub struct AppState {
    /// Emplacement courant du fichier de réglages (change après `move_settings`).
    pub location: Mutex<SettingsLocation>,
    pub settings: Mutex<Settings>,
    /// Surveillance du dossier racine (remplacée à chaque `set_root`).
    pub watcher: Mutex<Option<crate::watcher::Watcher>>,
}

impl AppState {
    /// (Re)lance la surveillance de `root` ; ne plante jamais si le dossier est absent.
    pub fn restart_watcher(&self, app: &tauri::AppHandle, root: &Path) {
        let next = if root.is_dir() { crate::watcher::start(app.clone(), root.to_path_buf()).ok() } else { None };
        if let Ok(mut w) = self.watcher.lock() {
            *w = next; // l'ancien watcher est arrêté (drop)
        }
    }
}

impl AppState {
    /// Dossier racine des notes, ou une erreur en français s'il n'est pas défini.
    pub fn root(&self) -> Result<PathBuf, String> {
        let s = self.settings.lock().map_err(|_| "Réglages indisponibles".to_string())?;
        s.root_dir
            .as_ref()
            .map(PathBuf::from)
            .ok_or_else(|| "Aucun dossier de notes n'est défini".to_string())
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum LocationMode {
    Portable,
    Appdata,
    Custom,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct SettingsLocation {
    pub path: PathBuf,
    pub mode: LocationMode,
    /// Code (traduit côté interface) si le pointeur était inutilisable au démarrage : "pointer_missing" | "pointer_invalid".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
    /// Dossier AppData par défaut des réglages (cible de « Déplacer vers AppData »).
    pub default_dir: PathBuf,
}

#[derive(Serialize, Deserialize)]
struct Pointer {
    settings_path: String,
}

fn default_path(appdata: &Path) -> PathBuf {
    appdata.join(APPDATA_DIR).join(FILE_NAME)
}

fn pointer_path(appdata: &Path) -> PathBuf {
    appdata.join(APPDATA_DIR).join(POINTER_NAME)
}

/// Emplacement du fichier de réglages : à côté de l'exe s'il y existe (mode portable, prioritaire), sinon le
/// pointeur `%APPDATA%\myMDnotepad\location.json` s'il est valide, sinon `%APPDATA%\myMDnotepad\…`.
/// Ne crée, ne modifie et ne supprime rien.
pub fn resolve_location(exe_dir: &Path, appdata: &Path) -> SettingsLocation {
    let exe_file = exe_dir.join(FILE_NAME);
    if exe_file.is_file() {
        return SettingsLocation { path: exe_file, mode: LocationMode::Portable, warning: None, default_dir: appdata.join(APPDATA_DIR) };
    }
    let default = default_path(appdata);
    let mut warning = None;
    if let Ok(text) = std::fs::read_to_string(pointer_path(appdata)) {
        match serde_json::from_str::<Pointer>(&text) {
            Ok(p) => {
                let target = PathBuf::from(&p.settings_path);
                if target.is_file() {
                    let mode = if target == default { LocationMode::Appdata } else { LocationMode::Custom };
                    return SettingsLocation { path: target, mode, warning: None, default_dir: appdata.join(APPDATA_DIR) };
                }
                warning = Some("pointer_missing".to_string());
            }
            Err(_) => warning = Some("pointer_invalid".to_string()),
        }
    }
    SettingsLocation { path: default, mode: LocationMode::Appdata, warning, default_dir: appdata.join(APPDATA_DIR) }
}

/// Premier lancement sous le nouveau nom : si `path` n'existe pas mais qu'un ancien fichier de réglages existe
/// (à côté de l'exe, sinon dans `appdata/MDnote`), il est relu et enregistré sous le nouveau nom. L'ancien fichier
/// n'est jamais modifié ni supprimé. Renvoie vrai si une migration a eu lieu.
pub fn migrate_legacy(path: &Path, exe_dir: &Path, appdata: &Path) -> bool {
    if path.exists() {
        return false;
    }
    let candidates = [
        exe_dir.join(LEGACY_FILE_NAME),
        appdata.join(LEGACY_APPDATA_DIR).join(LEGACY_FILE_NAME),
    ];
    // Le premier ancien fichier lisible gagne ; un fichier illisible laisse la chance au suivant.
    let parsed = candidates.iter().find_map(|p| {
        std::fs::read_to_string(p).ok().and_then(|t| serde_json::from_str::<Settings>(&t).ok())
    });
    match parsed {
        Some(s) => save(path, &s).is_ok(),
        None => false,
    }
}

/// Fichier absent ou corrompu : valeurs par défaut, jamais d'erreur.
pub fn load(path: &Path) -> Settings {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub fn save(path: &Path, s: &Settings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Impossible de créer le dossier des réglages : {e}"))?;
    }
    let json = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    crate::notes_fs::write_atomic(path, json.as_bytes())
        .map_err(|e| format!("Impossible d'enregistrer les réglages : {e}"))
}

/// Lit et valide un fichier de réglages choisi par l'utilisateur : JSON objet valide (champs manquants → défauts).
pub fn check_file(path: &Path) -> Result<Settings, String> {
    let text = std::fs::read_to_string(path).map_err(|_| "SETTINGS_UNREADABLE".to_string())?;
    let value = serde_json::from_str::<serde_json::Value>(&text).map_err(|_| "SETTINGS_INVALID".to_string())?;
    let obj = value.as_object().ok_or_else(|| "SETTINGS_INVALID".to_string())?;
    // `{}`, un package.json, un location.json… ne sont pas des réglages : ils effaceraient tout par des valeurs par défaut.
    if !KNOWN_KEYS.iter().any(|k| obj.contains_key(*k)) {
        return Err("SETTINGS_NO_KNOWN_KEYS".into());
    }
    serde_json::from_value::<Settings>(value).map_err(|_| "SETTINGS_INVALID".to_string())
}

const KNOWN_KEYS: [&str; 8] = ["root_dir", "open_tabs", "active_tab", "recent_emojis", "transparency", "language", "sidebar_width", "sidebar_collapsed"];

/// Copie le fichier de réglages actuel à côté de lui sous un nom unique `mymdnotepad.settings.replaced[-N].json`
/// (avant de le remplacer par un fichier chargé). Renvoie la copie, ou `None` s'il n'y avait rien à copier.
pub fn backup_before_replace(path: &Path) -> Result<Option<PathBuf>, String> {
    if !path.is_file() {
        return Ok(None);
    }
    let dir = path.parent().unwrap_or(Path::new("."));
    let mut dest = dir.join("mymdnotepad.settings.replaced.json");
    let mut n = 2;
    while dest.exists() {
        dest = dir.join(format!("mymdnotepad.settings.replaced-{n}.json"));
        n += 1;
    }
    std::fs::copy(path, &dest).map_err(|e| format!("Impossible d'enregistrer les réglages : {e}"))?;
    Ok(Some(dest))
}

/// Fusionne dans `cur` uniquement les champs présents dans `patch` (les autres restent tels quels).
pub fn apply_patch(cur: &Settings, patch: &serde_json::Map<String, serde_json::Value>) -> Result<Settings, String> {
    let mut value = serde_json::to_value(cur).map_err(|e| e.to_string())?;
    let obj = value.as_object_mut().ok_or("Réglages indisponibles")?;
    for k in ["root_dir", "open_tabs", "active_tab", "recent_emojis", "transparency", "language", "sidebar_width", "sidebar_collapsed"] {
        if let Some(v) = patch.get(k) {
            obj.insert(k.to_string(), v.clone());
        }
    }
    serde_json::from_value(value).map_err(|e| e.to_string())
}

/// Écrit `s` à l'emplacement courant. Si on est revenu sur AppData à cause d'un pointeur cassé, le pointeur est
/// réécrit vers ce fichier : un ancien fichier qui réapparaîtrait ne peut plus l'emporter en silence.
pub fn write_current(loc: &mut SettingsLocation, s: &Settings, appdata: &Path) -> Result<(), String> {
    save(&loc.path, s)?;
    if loc.warning.is_some() && write_pointer(appdata, &loc.path).is_ok() {
        loc.warning = None;
    }
    Ok(())
}

fn write_pointer(appdata: &Path, target: &Path) -> Result<(), String> {
    let p = Pointer { settings_path: target.to_string_lossy().into_owned() };
    let json = serde_json::to_string_pretty(&p).map_err(|e| e.to_string())?;
    let path = pointer_path(appdata);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Impossible de créer le dossier des réglages : {e}"))?;
    }
    crate::notes_fs::write_atomic(&path, json.as_bytes())
}

fn unique_moved_name(dir: &Path) -> PathBuf {
    let first = dir.join(MOVED_PORTABLE_NAME);
    if !first.exists() {
        return first;
    }
    (2..)
        .map(|i| dir.join(format!("mymdnotepad.settings.moved{i}.json")))
        .find(|p| !p.exists())
        .unwrap()
}

/// Déplace les réglages dans `dest_dir` : écrit le nouveau fichier (jamais par-dessus un fichier existant), enregistre
/// le pointeur, puis bascule. L'ancien fichier n'est jamais supprimé ; s'il était à côté de l'exe (prioritaire au
/// démarrage) il est seulement renommé en `mymdnotepad.settings.moved.json` pour que le déplacement soit effectif.
pub fn move_settings_to(
    current: &SettingsLocation,
    settings: &Settings,
    dest_dir: &Path,
    exe_dir: &Path,
    appdata: &Path,
) -> Result<SettingsLocation, String> {
    if dest_dir == appdata.join(APPDATA_DIR) {
        let _ = std::fs::create_dir_all(dest_dir); // le dossier par défaut peut ne pas exister encore
    }
    if !dest_dir.is_dir() {
        return Err("SETTINGS_DEST_INVALID".into());
    }
    let dest = dest_dir.join(FILE_NAME);
    if dest == current.path {
        return Ok(current.clone());
    }
    if dest.exists() {
        return Err("SETTINGS_DEST_EXISTS".into());
    }
    let mode = if dest_dir == exe_dir {
        LocationMode::Portable
    } else if dest == default_path(appdata) {
        LocationMode::Appdata
    } else {
        LocationMode::Custom
    };
    save(&dest, settings)?;
    let undo = |renamed: Option<&(PathBuf, PathBuf)>| {
        if let Some((from, to)) = renamed {
            let _ = std::fs::rename(to, from);
        }
        let _ = std::fs::remove_file(&dest); // fichier créé à l'instant par nous
    };
    let mut renamed: Option<(PathBuf, PathBuf)> = None;
    if current.mode == LocationMode::Portable && mode != LocationMode::Portable {
        let to = unique_moved_name(current.path.parent().unwrap_or(exe_dir));
        if std::fs::rename(&current.path, &to).is_err() {
            undo(None);
            return Err("SETTINGS_OLD_LOCKED".into());
        }
        renamed = Some((current.path.clone(), to));
    }
    if mode != LocationMode::Portable {
        if let Err(e) = write_pointer(appdata, &dest) {
            undo(renamed.as_ref());
            return Err(e);
        }
    }
    Ok(SettingsLocation { path: dest, mode, warning: None, default_dir: appdata.join(APPDATA_DIR) })
}

fn exe_and_appdata() -> (PathBuf, PathBuf) {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));
    let appdata = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(|| exe_dir.clone());
    (exe_dir, appdata)
}

const UNAVAILABLE: &str = "Réglages indisponibles";

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Result<Settings, String> {
    Ok(state.settings.lock().map_err(|_| UNAVAILABLE)?.clone())
}

// Ordre des verrous, partout : `settings` puis `location` (le chemin est lu SOUS le verrou des réglages,
// sinon une écriture concurrente d'un `move_settings` pourrait recréer l'ancien fichier).

#[tauri::command]
pub fn save_settings(state: State<AppState>, settings: Settings) -> Result<(), String> {
    let (_, appdata) = exe_and_appdata();
    let mut cur = state.settings.lock().map_err(|_| UNAVAILABLE)?;
    let mut loc = state.location.lock().map_err(|_| UNAVAILABLE)?;
    write_current(&mut loc, &settings, &appdata)?;
    *cur = settings;
    Ok(())
}

/// Mise à jour partielle : seuls les champs présents dans `patch` changent (open_tabs, active_tab, recent_emojis,
/// transparency, language, root_dir). Évite qu'une copie périmée côté interface écrase un autre réglage.
#[tauri::command]
pub fn update_settings(state: State<AppState>, patch: serde_json::Map<String, serde_json::Value>) -> Result<Settings, String> {
    let (_, appdata) = exe_and_appdata();
    let mut cur = state.settings.lock().map_err(|_| UNAVAILABLE)?;
    let mut loc = state.location.lock().map_err(|_| UNAVAILABLE)?;
    let next = apply_patch(&cur, &patch)?;
    write_current(&mut loc, &next, &appdata)?;
    *cur = next.clone();
    Ok(next)
}

#[tauri::command]
pub fn get_settings_location(state: State<AppState>) -> Result<SettingsLocation, String> {
    Ok(state.location.lock().map_err(|_| UNAVAILABLE)?.clone())
}

#[tauri::command]
pub fn move_settings(state: State<AppState>, dest_dir: String) -> Result<SettingsLocation, String> {
    let (exe_dir, appdata) = exe_and_appdata();
    let cur = state.settings.lock().map_err(|_| UNAVAILABLE)?;
    let mut loc = state.location.lock().map_err(|_| UNAVAILABLE)?;
    let next = move_settings_to(&loc, &cur, Path::new(&dest_dir), &exe_dir, &appdata)?;
    *loc = next.clone();
    Ok(next)
}

/// Valide un fichier de réglages sans rien changer et renvoie son contenu (l'interface affiche son dossier de notes
/// dans la confirmation). Erreurs : SETTINGS_UNREADABLE / SETTINGS_INVALID / SETTINGS_NO_KNOWN_KEYS.
#[tauri::command]
pub fn check_settings_file(path: String) -> Result<Settings, String> {
    check_file(Path::new(&path))
}

/// Adopte un fichier de réglages : validé, l'actuel est copié en `mymdnotepad.settings.replaced[-N].json`, puis le
/// nouveau est enregistré à l'emplacement courant (la confirmation est demandée par l'interface avant l'appel).
#[tauri::command]
pub fn load_settings_file(app: tauri::AppHandle, state: State<AppState>, path: String) -> Result<Settings, String> {
    let (_, appdata) = exe_and_appdata();
    let loaded = check_file(Path::new(&path))?;
    let mut cur = state.settings.lock().map_err(|_| UNAVAILABLE)?;
    let mut loc = state.location.lock().map_err(|_| UNAVAILABLE)?;
    backup_before_replace(&loc.path)?;
    write_current(&mut loc, &loaded, &appdata)?;
    *cur = loaded.clone();
    drop(loc);
    drop(cur);
    if let Some(r) = loaded.root_dir.as_deref().filter(|r| Path::new(r).is_dir()) {
        let _ = app.asset_protocol_scope().allow_directory(r, true);
        state.restart_watcher(&app, Path::new(r));
    }
    crate::window_fx::apply_transparency(&app, loaded.transparency);
    Ok(loaded)
}

/// Règle l'opacité du voile acrylique (0 opaque … 100 transparent) ; `persist` l'enregistre dans les réglages.
#[tauri::command]
pub fn set_transparency(app: tauri::AppHandle, state: State<AppState>, value: u8, persist: bool) -> Result<(), String> {
    let value = value.min(100);
    crate::window_fx::apply_transparency(&app, value);
    if persist {
        let (_, appdata) = exe_and_appdata();
        let mut cur = state.settings.lock().map_err(|_| UNAVAILABLE)?;
        let mut loc = state.location.lock().map_err(|_| UNAVAILABLE)?;
        let mut next = cur.clone();
        next.transparency = value;
        write_current(&mut loc, &next, &appdata)?;
        *cur = next;
    }
    Ok(())
}

/// Ouvre un dossier dans l'Explorateur ; pour un fichier, l'Explorateur l'affiche sélectionné (jamais exécuté).
#[tauri::command]
pub fn open_in_explorer(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    let mut cmd = std::process::Command::new("explorer");
    if p.is_dir() {
        cmd.arg(p);
    } else if p.is_file() {
        cmd.arg(format!("/select,{}", p.display()));
    } else {
        return Err("PATH_NOT_FOUND".into());
    }
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_root(app: tauri::AppHandle, state: State<AppState>, abs: String) -> Result<(), String> {
    if !Path::new(&abs).is_dir() {
        return Err(format!("Ce dossier n'existe pas : {abs}"));
    }
    let (_, appdata) = exe_and_appdata();
    let mut cur = state.settings.lock().map_err(|_| UNAVAILABLE)?;
    let mut loc = state.location.lock().map_err(|_| UNAVAILABLE)?;
    let mut next = cur.clone();
    let abs_dir = abs.clone();
    next.root_dir = Some(abs);
    write_current(&mut loc, &next, &appdata)?;
    drop(loc);
    *cur = next;
    // Autorise le protocole asset (aperçu des images) sur le nouveau dossier.
    app.asset_protocol_scope()
        .allow_directory(&abs_dir, true)
        .map_err(|e| format!("Impossible d'autoriser l'accès aux images : {e}"))?;
    drop(cur);
    state.restart_watcher(&app, Path::new(&abs_dir));
    Ok(())
}

#[tauri::command]
pub fn root_status(state: State<AppState>) -> Result<String, String> {
    let s = state.settings.lock().map_err(|_| "Réglages indisponibles")?;
    Ok(match &s.root_dir {
        None => "unset",
        Some(p) if Path::new(p).is_dir() => "ok",
        Some(_) => "missing",
    }
    .to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test] fn load_missing_file_gives_defaults() {
        let d = tempdir().unwrap();
        let s = load(&d.path().join("nope.json"));
        assert_eq!(s.root_dir, None);
    }
    #[test] fn load_corrupt_json_gives_defaults() {
        let d = tempdir().unwrap();
        let p = d.path().join("s.json");
        std::fs::write(&p, "{ not json").unwrap();
        assert_eq!(load(&p), Settings::default());
    }
    #[test] fn load_partial_json_fills_defaults() {
        let d = tempdir().unwrap();
        let p = d.path().join("s.json");
        std::fs::write(&p, r#"{"root_dir":"C:/n"}"#).unwrap();
        let s = load(&p);
        assert_eq!(s.root_dir.as_deref(), Some("C:/n"));
    }
    #[test] fn old_settings_with_window_effect_still_load() {
        let d = tempdir().unwrap();
        let p = d.path().join("s.json");
        std::fs::write(&p, r#"{"root_dir":"C:/n","window_effect":"mica"}"#).unwrap();
        assert_eq!(load(&p).root_dir.as_deref(), Some("C:/n"));
    }
    #[test] fn save_then_load_roundtrip() {
        let d = tempdir().unwrap();
        let p = d.path().join("s.json");
        let s = Settings { root_dir: Some("C:/n".into()), open_tabs: vec!["a.md".into()], active_tab: Some("a.md".into()), recent_emojis: vec!["x".into()], transparency: 70, language: Some("fr".into()), sidebar_width: Some(300), sidebar_collapsed: true };
        save(&p, &s).unwrap();
        assert_eq!(load(&p), s);
    }
    fn loc(p: PathBuf, mode: LocationMode) -> SettingsLocation { SettingsLocation { path: p, mode, warning: None, default_dir: PathBuf::new() } }
    fn pointer(a: &Path, target: &Path) {
        std::fs::create_dir_all(a.join("myMDnotepad")).unwrap();
        write_pointer(a, target).unwrap();
    }
    #[test] fn defaults_to_appdata() {
        let e = tempdir().unwrap(); let a = tempdir().unwrap();
        let l = resolve_location(e.path(), a.path());
        assert_eq!(l.path, a.path().join("myMDnotepad").join("mymdnotepad.settings.json"));
        assert_eq!(l.mode, LocationMode::Appdata);
        assert!(l.warning.is_none());
    }
    #[test] fn exe_file_has_priority_over_pointer() {
        let e = tempdir().unwrap(); let a = tempdir().unwrap(); let c = tempdir().unwrap();
        std::fs::write(e.path().join("mymdnotepad.settings.json"), "{}").unwrap();
        let custom = c.path().join("mymdnotepad.settings.json");
        std::fs::write(&custom, "{}").unwrap();
        pointer(a.path(), &custom);
        let l = resolve_location(e.path(), a.path());
        assert_eq!(l.mode, LocationMode::Portable);
        assert_eq!(l.path, e.path().join("mymdnotepad.settings.json"));
    }
    #[test] fn valid_pointer_is_used() {
        let e = tempdir().unwrap(); let a = tempdir().unwrap(); let c = tempdir().unwrap();
        let custom = c.path().join("mymdnotepad.settings.json");
        std::fs::write(&custom, "{}").unwrap();
        pointer(a.path(), &custom);
        let l = resolve_location(e.path(), a.path());
        assert_eq!((l.path, l.mode), (custom, LocationMode::Custom));
    }
    #[test] fn broken_pointer_falls_back_without_touching_anything() {
        let e = tempdir().unwrap(); let a = tempdir().unwrap();
        pointer(a.path(), &a.path().join("gone").join("mymdnotepad.settings.json"));
        let before = std::fs::read_to_string(a.path().join("myMDnotepad").join("location.json")).unwrap();
        let l = resolve_location(e.path(), a.path());
        assert_eq!(l.mode, LocationMode::Appdata);
        assert_eq!(l.warning.as_deref(), Some("pointer_missing"));
        assert_eq!(std::fs::read_to_string(a.path().join("myMDnotepad").join("location.json")).unwrap(), before);
        assert!(!l.path.exists());
    }
    #[test] fn corrupt_pointer_falls_back_with_warning() {
        let e = tempdir().unwrap(); let a = tempdir().unwrap();
        std::fs::create_dir_all(a.path().join("myMDnotepad")).unwrap();
        std::fs::write(a.path().join("myMDnotepad").join("location.json"), "{ nope").unwrap();
        let l = resolve_location(e.path(), a.path());
        assert_eq!((l.mode, l.warning.as_deref()), (LocationMode::Appdata, Some("pointer_invalid")));
    }
    #[test]
    fn sidebar_fields_default_and_patch() {
        let d: Settings = serde_json::from_str("{}").unwrap();
        assert_eq!(d.sidebar_width, None);
        assert!(!d.sidebar_collapsed);
        let patch = serde_json::json!({"sidebar_width": 300, "sidebar_collapsed": true});
        let n = apply_patch(&d, patch.as_object().unwrap()).unwrap();
        assert_eq!((n.sidebar_width, n.sidebar_collapsed), (Some(300), true));
        let patch = serde_json::json!({"sidebar_width": null});
        assert_eq!(apply_patch(&n, patch.as_object().unwrap()).unwrap().sidebar_width, None);
    }

    fn sample() -> Settings { Settings { root_dir: Some("C:/n".into()), transparency: 20, language: Some("en".into()), ..Settings::default() } }
    #[test] fn move_writes_new_file_and_pointer_and_keeps_old() {
        let e = tempdir().unwrap(); let a = tempdir().unwrap(); let d = tempdir().unwrap();
        let old = a.path().join("myMDnotepad").join("mymdnotepad.settings.json");
        save(&old, &sample()).unwrap();
        let cur = loc(old.clone(), LocationMode::Appdata);
        let n = move_settings_to(&cur, &sample(), d.path(), e.path(), a.path()).unwrap();
        assert_eq!(n.mode, LocationMode::Custom);
        assert_eq!(load(&n.path), sample());
        assert!(old.exists());
        assert_eq!(resolve_location(e.path(), a.path()).path, n.path);
    }
    #[test] fn move_refuses_to_overwrite_an_existing_file() {
        let e = tempdir().unwrap(); let a = tempdir().unwrap(); let d = tempdir().unwrap();
        std::fs::write(d.path().join("mymdnotepad.settings.json"), "precious").unwrap();
        let cur = loc(a.path().join("myMDnotepad").join("mymdnotepad.settings.json"), LocationMode::Appdata);
        let r = move_settings_to(&cur, &sample(), d.path(), e.path(), a.path());
        assert_eq!(r.unwrap_err(), "SETTINGS_DEST_EXISTS");
        assert_eq!(std::fs::read_to_string(d.path().join("mymdnotepad.settings.json")).unwrap(), "precious");
    }
    #[test] fn move_from_portable_to_appdata_renames_old_and_wins_at_next_start() {
        let e = tempdir().unwrap(); let a = tempdir().unwrap();
        let old = e.path().join("mymdnotepad.settings.json");
        save(&old, &sample()).unwrap();
        let cur = loc(old.clone(), LocationMode::Portable);
        let dest_dir = a.path().join("myMDnotepad"); // n'existe pas encore : créé par le déplacement
        let n = move_settings_to(&cur, &sample(), &dest_dir, e.path(), a.path()).unwrap();
        assert_eq!(n.mode, LocationMode::Appdata);
        assert!(!old.exists());
        assert!(e.path().join("mymdnotepad.settings.moved.json").exists()); // conservé, jamais supprimé
        assert_eq!(resolve_location(e.path(), a.path()).path, n.path);
    }
    #[test] fn move_to_exe_dir_is_portable() {
        let e = tempdir().unwrap(); let a = tempdir().unwrap();
        let cur = loc(a.path().join("myMDnotepad").join("mymdnotepad.settings.json"), LocationMode::Appdata);
        let n = move_settings_to(&cur, &sample(), e.path(), e.path(), a.path()).unwrap();
        assert_eq!(n.mode, LocationMode::Portable);
        assert_eq!(resolve_location(e.path(), a.path()).mode, LocationMode::Portable);
    }
    #[test] fn move_to_missing_dir_fails() {
        let e = tempdir().unwrap(); let a = tempdir().unwrap();
        let cur = loc(a.path().join("x.json"), LocationMode::Appdata);
        assert_eq!(move_settings_to(&cur, &sample(), &a.path().join("nope"), e.path(), a.path()).unwrap_err(), "SETTINGS_DEST_INVALID");
    }
    #[test] fn check_file_accepts_partial_and_rejects_garbage() {
        let d = tempdir().unwrap();
        let ok = d.path().join("ok.json");
        std::fs::write(&ok, r#"{"language":"en"}"#).unwrap();
        let s = check_file(&ok).unwrap();
        assert_eq!((s.language.as_deref(), s.transparency), (Some("en"), 50));
        let bad = d.path().join("bad.json");
        std::fs::write(&bad, "[1,2").unwrap();
        assert_eq!(check_file(&bad).unwrap_err(), "SETTINGS_INVALID");
        std::fs::write(&bad, "42").unwrap();
        assert_eq!(check_file(&bad).unwrap_err(), "SETTINGS_INVALID");
        assert_eq!(check_file(&d.path().join("none.json")).unwrap_err(), "SETTINGS_UNREADABLE");
    }
    #[test] fn check_file_rejects_json_without_any_known_key() {
        let d = tempdir().unwrap();
        let p = d.path().join("x.json");
        for text in ["{}", r#"{"name":"pkg","version":"1.0.0"}"#, r#"{"settings_path":"C:/x.json"}"#] {
            std::fs::write(&p, text).unwrap();
            assert_eq!(check_file(&p).unwrap_err(), "SETTINGS_NO_KNOWN_KEYS", "{text}");
        }
    }
    #[test] fn backup_keeps_the_current_file_under_unique_names() {
        let d = tempdir().unwrap();
        let p = d.path().join("mymdnotepad.settings.json");
        assert_eq!(backup_before_replace(&p).unwrap(), None);
        save(&p, &sample()).unwrap();
        let b1 = backup_before_replace(&p).unwrap().unwrap();
        let b2 = backup_before_replace(&p).unwrap().unwrap();
        assert_eq!(b1, d.path().join("mymdnotepad.settings.replaced.json"));
        assert_eq!(b2, d.path().join("mymdnotepad.settings.replaced-2.json"));
        assert_eq!(load(&b1), sample());
        assert!(p.exists());
    }
    #[test] fn patch_only_touches_the_given_fields() {
        let cur = Settings { root_dir: Some("C:/n".into()), transparency: 20, language: Some("en".into()), open_tabs: vec!["a.md".into()], ..Settings::default() };
        let patch: serde_json::Map<String, serde_json::Value> = serde_json::from_str(r#"{"open_tabs":["b.md"],"active_tab":"b.md","bogus":1}"#).unwrap();
        let next = apply_patch(&cur, &patch).unwrap();
        assert_eq!((next.open_tabs.clone(), next.active_tab.clone()), (vec!["b.md".to_string()], Some("b.md".to_string())));
        assert_eq!((next.transparency, next.language.clone(), next.root_dir.clone()), (20, Some("en".into()), Some("C:/n".into())));
        let clear: serde_json::Map<String, serde_json::Value> = serde_json::from_str(r#"{"active_tab":null}"#).unwrap();
        assert_eq!(apply_patch(&next, &clear).unwrap().active_tab, None);
    }
    #[test] fn writing_after_a_pointer_fallback_rewrites_the_dead_pointer() {
        let e = tempdir().unwrap(); let a = tempdir().unwrap();
        let old = tempdir().unwrap();
        let gone = old.path().join("mymdnotepad.settings.json");
        pointer(a.path(), &gone);
        let mut l = resolve_location(e.path(), a.path());
        assert_eq!(l.warning.as_deref(), Some("pointer_missing"));
        write_current(&mut l, &sample(), a.path()).unwrap();
        assert!(l.warning.is_none());
        // l'ancien fichier réapparaît : il ne l'emporte plus
        std::fs::write(&gone, "{}").unwrap();
        let again = resolve_location(e.path(), a.path());
        assert_eq!(again.path, l.path);
        assert!(again.warning.is_none());
    }
    #[test] fn writes_follow_the_location_they_are_given_not_a_stale_one() {
        // Après un déplacement, une écriture passe par le nouvel emplacement : l'ancien fichier n'est pas recréé.
        let e = tempdir().unwrap(); let a = tempdir().unwrap(); let d = tempdir().unwrap();
        let old = a.path().join("myMDnotepad").join("mymdnotepad.settings.json");
        save(&old, &sample()).unwrap();
        let cur = loc(old.clone(), LocationMode::Appdata);
        let mut moved = move_settings_to(&cur, &sample(), d.path(), e.path(), a.path()).unwrap();
        std::fs::remove_file(&old).unwrap();
        write_current(&mut moved, &Settings::default(), a.path()).unwrap();
        assert!(!old.exists());
        assert!(moved.path.exists());
    }
    #[test] fn old_files_without_new_fields_get_defaults() {
        let d = tempdir().unwrap(); let p = d.path().join("s.json");
        std::fs::write(&p, r#"{"root_dir":"C:/n"}"#).unwrap();
        let s = load(&p);
        assert_eq!((s.transparency, s.language), (50, None));
    }
    fn old(dir: &Path, root: &str) -> PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        let p = dir.join("mdnote.settings.json");
        std::fs::write(&p, format!(r#"{{"root_dir":"{root}","open_tabs":["a.md"]}}"#)).unwrap();
        p
    }
    #[test] fn migrates_exe_dir_file_and_keeps_the_old_one() {
        let e = tempdir().unwrap(); let a = tempdir().unwrap();
        let o = old(e.path(), "C:/n");
        let new = e.path().join("mymdnotepad.settings.json");
        assert!(migrate_legacy(&new, e.path(), a.path()));
        let s = load(&new);
        assert_eq!(s.root_dir.as_deref(), Some("C:/n"));
        assert_eq!(s.open_tabs, vec!["a.md".to_string()]);
        assert!(o.exists());
    }
    #[test] fn corrupt_first_candidate_falls_through_to_the_next() {
        let e = tempdir().unwrap(); let a = tempdir().unwrap();
        std::fs::write(e.path().join("mdnote.settings.json"), "{ pas du json").unwrap();
        old(&a.path().join("MDnote"), "C:/ok");
        let new = e.path().join("mymdnotepad.settings.json");
        assert!(migrate_legacy(&new, e.path(), a.path()));
        assert_eq!(load(&new).root_dir.as_deref(), Some("C:/ok"));
    }
    #[test] fn migrates_appdata_file() {
        let e = tempdir().unwrap(); let a = tempdir().unwrap();
        let o = old(&a.path().join("MDnote"), "C:/m");
        let new = a.path().join("myMDnotepad").join("mymdnotepad.settings.json");
        assert!(migrate_legacy(&new, e.path(), a.path()));
        assert_eq!(load(&new).root_dir.as_deref(), Some("C:/m"));
        assert!(o.exists());
    }
    #[test] fn never_overwrites_an_existing_new_file() {
        let e = tempdir().unwrap(); let a = tempdir().unwrap();
        old(e.path(), "C:/old");
        let new = e.path().join("mymdnotepad.settings.json");
        save(&new, &Settings { root_dir: Some("C:/new".into()), ..Settings::default() }).unwrap();
        assert!(!migrate_legacy(&new, e.path(), a.path()));
        assert_eq!(load(&new).root_dir.as_deref(), Some("C:/new"));
    }
    #[test] fn no_legacy_file_means_no_migration() {
        let e = tempdir().unwrap(); let a = tempdir().unwrap();
        let new = e.path().join("mymdnotepad.settings.json");
        assert!(!migrate_legacy(&new, e.path(), a.path()));
        assert!(!new.exists());
    }
}
