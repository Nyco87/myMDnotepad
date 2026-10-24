use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

const FILE_NAME: &str = "mdnote.settings.json";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct Settings {
    pub root_dir: Option<String>,
    pub open_tabs: Vec<String>,
    pub active_tab: Option<String>,
    pub recent_emojis: Vec<String>,
    pub window_effect: String,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            root_dir: None,
            open_tabs: vec![],
            active_tab: None,
            recent_emojis: vec![],
            window_effect: "acrylic".into(),
        }
    }
}

pub struct AppState {
    pub settings_path: PathBuf,
    pub settings: Mutex<Settings>,
}

impl AppState {
    /// Dossier racine des notes, ou une erreur en français s'il n'est pas défini.
    #[allow(dead_code)] // utilisé par les tâches suivantes
    pub fn root(&self) -> Result<PathBuf, String> {
        let s = self.settings.lock().map_err(|_| "Réglages indisponibles".to_string())?;
        s.root_dir
            .as_ref()
            .map(PathBuf::from)
            .ok_or_else(|| "Aucun dossier de notes n'est défini".to_string())
    }
}

/// `exe_dir/mdnote.settings.json` si le dossier est inscriptible, sinon `appdata/MDnote/…`.
pub fn settings_path(exe_dir: &Path, appdata: &Path) -> PathBuf {
    let probe = exe_dir.join(".mdnote-write-test");
    let writable = std::fs::write(&probe, b"").is_ok();
    if writable {
        let _ = std::fs::remove_file(&probe);
        exe_dir.join(FILE_NAME)
    } else {
        appdata.join("MDnote").join(FILE_NAME)
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
    std::fs::write(path, json).map_err(|e| format!("Impossible d'enregistrer les réglages : {e}"))
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
pub fn set_root(state: State<AppState>, abs: String) -> Result<(), String> {
    if !Path::new(&abs).is_dir() {
        return Err(format!("Ce dossier n'existe pas : {abs}"));
    }
    let mut cur = state.settings.lock().map_err(|_| "Réglages indisponibles")?;
    let mut next = cur.clone();
    next.root_dir = Some(abs);
    save(&state.settings_path, &next)?;
    *cur = next;
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
        assert_eq!(s.window_effect, "acrylic");
    }
    #[test] fn load_corrupt_json_gives_defaults() {
        let d = tempdir().unwrap();
        let p = d.path().join("s.json");
        std::fs::write(&p, "{ not json").unwrap();
        assert_eq!(load(&p).window_effect, "acrylic");
    }
    #[test] fn load_partial_json_fills_defaults() {
        let d = tempdir().unwrap();
        let p = d.path().join("s.json");
        std::fs::write(&p, r#"{"root_dir":"C:/n"}"#).unwrap();
        let s = load(&p);
        assert_eq!(s.root_dir.as_deref(), Some("C:/n"));
        assert_eq!(s.window_effect, "acrylic");
    }
    #[test] fn save_then_load_roundtrip() {
        let d = tempdir().unwrap();
        let p = d.path().join("s.json");
        let s = Settings { root_dir: Some("C:/n".into()), open_tabs: vec!["a.md".into()], active_tab: Some("a.md".into()), recent_emojis: vec!["x".into()], window_effect: "mica".into() };
        save(&p, &s).unwrap();
        assert_eq!(load(&p), s);
    }
    #[test] fn settings_path_uses_exe_dir_when_writable() {
        let e = tempdir().unwrap(); let a = tempdir().unwrap();
        assert_eq!(settings_path(e.path(), a.path()), e.path().join("mdnote.settings.json"));
    }
    #[test] fn settings_path_falls_back_when_exe_dir_readonly() {
        let a = tempdir().unwrap();
        let p = settings_path(&a.path().join("missing_dir"), a.path());
        assert_eq!(p, a.path().join("MDnote").join("mdnote.settings.json"));
    }
}
