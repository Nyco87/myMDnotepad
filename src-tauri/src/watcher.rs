//! Surveillance du dossier de notes : émet `fs-changed` (chemins relatifs) vers le front.
use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub type Watcher = Debouncer<RecommendedWatcher>;

#[derive(Serialize, Clone)]
struct FsChanged {
    paths: Vec<String>,
}

/// Fichier temporaire d'écriture atomique de MDnote (`.<nom>.tmp`).
fn is_tmp(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.starts_with('.') && n.ends_with(".tmp"))
}

/// Chemins relatifs (séparateur `/`) sous `root`, sans les `.tmp` de MDnote ni la racine elle-même.
pub fn relevant_paths(root: &Path, paths: &[PathBuf]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for p in paths {
        if is_tmp(p) {
            continue;
        }
        let Ok(rel) = p.strip_prefix(root) else { continue };
        let parts: Vec<String> = rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
        if parts.is_empty() {
            continue;
        }
        let s = parts.join("/");
        if !out.contains(&s) {
            out.push(s);
        }
    }
    out
}

/// Démarre la surveillance récursive de `root` (anti-rebond 250 ms).
pub fn start(app: AppHandle, root: PathBuf) -> Result<Watcher, String> {
    let base = root.clone();
    let mut debouncer = new_debouncer(Duration::from_millis(250), move |res: DebounceEventResult| {
        if let Ok(events) = res {
            let paths: Vec<PathBuf> = events.into_iter().map(|e| e.path).collect();
            let rel = relevant_paths(&base, &paths);
            if !rel.is_empty() {
                let _ = app.emit("fs-changed", FsChanged { paths: rel });
            }
        }
    })
    .map_err(|e| format!("Impossible de surveiller le dossier : {e}"))?;
    debouncer
        .watcher()
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| format!("Impossible de surveiller le dossier : {e}"))?;
    Ok(debouncer)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> PathBuf {
        PathBuf::from(if cfg!(windows) { r"C:\notes" } else { "/notes" })
    }

    #[test]
    fn ignores_mdnote_tmp_files() {
        let r = root();
        let got = relevant_paths(&r, &[r.join(".Courses.md.tmp"), r.join("a").join(".x.tmp"), r.join("a").join("b.md")]);
        assert_eq!(got, vec!["a/b.md".to_string()]);
    }

    #[test]
    fn keeps_user_files_ending_in_tmp_without_dot_prefix() {
        let r = root();
        assert_eq!(relevant_paths(&r, &[r.join("x.tmp")]), vec!["x.tmp".to_string()]);
    }

    #[test]
    fn drops_paths_outside_root_and_root_itself() {
        let r = root();
        let other = if cfg!(windows) { PathBuf::from(r"C:\other\a.md") } else { PathBuf::from("/other/a.md") };
        assert!(relevant_paths(&r, &[other, r.clone()]).is_empty());
    }

    #[test]
    fn uses_forward_slashes_and_dedups() {
        let r = root();
        let p = r.join("Projets").join("MDnote").join("n.md");
        assert_eq!(relevant_paths(&r, &[p.clone(), p]), vec!["Projets/MDnote/n.md".to_string()]);
    }
}
