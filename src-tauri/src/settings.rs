use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Manager, State};

const FILE_NAME: &str = "mymdnotepad.settings.json";
const APPDATA_DIR: &str = "myMDnotepad";
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
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            root_dir: None,
            open_tabs: vec![],
            active_tab: None,
            recent_emojis: vec![],
        }
    }
}

pub struct AppState {
    pub settings_path: PathBuf,
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

/// `exe_dir/mymdnotepad.settings.json` si le dossier est inscriptible, sinon `appdata/myMDnotepad/…`.
pub fn settings_path(exe_dir: &Path, appdata: &Path) -> PathBuf {
    let probe = exe_dir.join(".mymdnotepad-write-test");
    let writable = std::fs::write(&probe, b"").is_ok();
    if writable {
        let _ = std::fs::remove_file(&probe);
        exe_dir.join(FILE_NAME)
    } else {
        appdata.join(APPDATA_DIR).join(FILE_NAME)
    }
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

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Result<Settings, String> {
    Ok(state.settings.lock().map_err(|_| "Réglages indisponibles")?.clone())
}

#[tauri::command]
pub fn save_settings(state: State<AppState>, settings: Settings) -> Result<(), String> {
    let mut cur = state.settings.lock().map_err(|_| "Réglages indisponibles")?;
    save(&state.settings_path, &settings)?;
    *cur = settings;
    Ok(())
}

#[tauri::command]
pub fn set_root(app: tauri::AppHandle, state: State<AppState>, abs: String) -> Result<(), String> {
    if !Path::new(&abs).is_dir() {
        return Err(format!("Ce dossier n'existe pas : {abs}"));
    }
    let mut cur = state.settings.lock().map_err(|_| "Réglages indisponibles")?;
    let mut next = cur.clone();
    let abs_dir = abs.clone();
    next.root_dir = Some(abs);
    save(&state.settings_path, &next)?;
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
        let s = Settings { root_dir: Some("C:/n".into()), open_tabs: vec!["a.md".into()], active_tab: Some("a.md".into()), recent_emojis: vec!["x".into()] };
        save(&p, &s).unwrap();
        assert_eq!(load(&p), s);
    }
    #[test] fn settings_path_uses_exe_dir_when_writable() {
        let e = tempdir().unwrap(); let a = tempdir().unwrap();
        assert_eq!(settings_path(e.path(), a.path()), e.path().join("mymdnotepad.settings.json"));
    }
    #[test] fn settings_path_falls_back_when_exe_dir_readonly() {
        let a = tempdir().unwrap();
        let p = settings_path(&a.path().join("missing_dir"), a.path());
        assert_eq!(p, a.path().join("myMDnotepad").join("mymdnotepad.settings.json"));
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
