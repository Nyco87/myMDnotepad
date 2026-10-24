use crate::paths::{resolve, to_rel};
use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::Path;

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Folder,
    Note,
}

#[derive(Serialize, Clone, Debug)]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    pub kind: Kind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<TreeNode>>,
}

#[derive(Serialize, Clone, Debug)]
pub struct NoteFile {
    pub content: String,
    pub mtime_ms: u64,
}

pub fn is_md(p: &Path) -> bool {
    p.extension().is_some_and(|e| e.eq_ignore_ascii_case("md"))
}

pub fn mtime_ms(p: &Path) -> u64 {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Écriture atomique : fichier temporaire `.<nom>.tmp` dans le même dossier, puis renommage.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = path.parent().ok_or("Chemin invalide")?;
    let name = path.file_name().ok_or("Chemin invalide")?.to_string_lossy();
    let tmp = dir.join(format!(".{name}.tmp"));
    let res = (|| -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, path)
    })();
    if let Err(e) = res {
        let _ = fs::remove_file(&tmp);
        return Err(format!("Impossible d'écrire le fichier : {e}"));
    }
    Ok(())
}

fn build(dir: &Path, root: &Path, name: String) -> TreeNode {
    let mut folders = vec![];
    let mut notes = vec![];
    if let Ok(rd) = fs::read_dir(dir) {
        for e in rd.flatten() {
            let Ok(ft) = e.file_type() else { continue };
            let fname = e.file_name().to_string_lossy().into_owned();
            let p = e.path();
            if ft.is_dir() {
                if fname.starts_with('.') || fname.eq_ignore_ascii_case("images") {
                    continue;
                }
                folders.push(build(&p, root, fname));
            } else if ft.is_file() && is_md(&p) && !fname.starts_with('.') {
                let stem = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or(fname);
                notes.push(TreeNode { name: stem, path: to_rel(root, &p), kind: Kind::Note, children: None });
            }
        }
    }
    folders.sort_by_key(|n| n.name.to_lowercase());
    notes.sort_by_key(|n| n.name.to_lowercase());
    folders.extend(notes);
    TreeNode { name, path: to_rel(root, dir), kind: Kind::Folder, children: Some(folders) }
}

pub fn list_tree(root: &Path) -> Result<TreeNode, String> {
    if !root.is_dir() {
        return Err(format!("Ce dossier n'existe pas : {}", root.display()));
    }
    let name = root.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    Ok(build(root, root, name))
}

pub fn read_note(root: &Path, rel: &str) -> Result<NoteFile, String> {
    let p = resolve(root, rel)?;
    let bytes = fs::read(&p).map_err(|e| format!("Impossible de lire la note : {e}"))?;
    let body = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes);
    // Pas de conversion « lossy » : un fichier Latin-1 ouvert puis enregistré serait abîmé (caractères remplacés par �).
    let text = std::str::from_utf8(body)
        .map_err(|_| "Cette note n'est pas encodée en UTF-8 : ouverture refusée pour ne pas l'abîmer.".to_string())?;
    let text = text.replace("\r\n", "\n");
    Ok(NoteFile { content: text, mtime_ms: mtime_ms(&p) })
}

/// Erreur renvoyée par `write_note` quand le fichier a changé depuis la dernière lecture/écriture connue.
pub const CONFLICT: &str = "CONFLICT";

/// Écrit la note. Compare-and-swap : si `expected_mtime` est fourni et que le fichier existe avec un autre
/// mtime (modification externe pas encore vue), rien n'est écrit et l'erreur `CONFLICT` est renvoyée.
pub fn write_note(root: &Path, rel: &str, content: &str, expected_mtime: Option<u64>) -> Result<u64, String> {
    let p = resolve(root, rel)?;
    if let Some(expected) = expected_mtime {
        if p.is_file() && mtime_ms(&p) != expected {
            return Err(CONFLICT.to_string());
        }
    }
    write_atomic(&p, content.as_bytes())?;
    Ok(mtime_ms(&p))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use std::fs;

    #[test] fn list_tree_filters_and_sorts() {
        let d = tempdir().unwrap(); let r = d.path();
        fs::write(r.join("b.md"), "").unwrap();
        fs::write(r.join("A.md"), "").unwrap();
        fs::write(r.join("x.txt"), "").unwrap();
        fs::create_dir_all(r.join("images")).unwrap();
        fs::write(r.join("images/p.png"), "").unwrap();
        fs::create_dir_all(r.join(".git")).unwrap();
        fs::write(r.join(".git/c.md"), "").unwrap();
        fs::create_dir_all(r.join("Dossier")).unwrap();
        fs::write(r.join("Dossier/n.md"), "").unwrap();
        fs::create_dir_all(r.join("Vide")).unwrap();
        let t = list_tree(r).unwrap();
        let kids = t.children.as_ref().unwrap();
        let names: Vec<_> = kids.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, ["Dossier", "Vide", "A", "b"]);
        assert_eq!(kids[0].children.as_ref().unwrap()[0].path, "Dossier/n.md");
    }
    #[test] fn read_note_normalizes_crlf_and_bom() {
        let d = tempdir().unwrap();
        let mut b = vec![0xEF, 0xBB, 0xBF]; b.extend_from_slice(b"# T\r\nx\r\n");
        fs::write(d.path().join("n.md"), b).unwrap();
        assert_eq!(read_note(d.path(), "n.md").unwrap().content, "# T\nx\n");
    }
    #[test] fn read_note_refuses_non_utf8() {
        let d = tempdir().unwrap();
        // « Été » en Latin-1 (Windows-1252) : É = 0xC9, é = 0xE9.
        let latin1: &[u8] = &[0xC9, b't', 0xE9, b'\n'];
        fs::write(d.path().join("latin1.md"), latin1).unwrap();
        assert_eq!(
            read_note(d.path(), "latin1.md").unwrap_err(),
            "Cette note n'est pas encodée en UTF-8 : ouverture refusée pour ne pas l'abîmer."
        );
        // Le fichier n'est pas touché.
        assert_eq!(fs::read(d.path().join("latin1.md")).unwrap(), latin1);
        // BOM UTF-8 suivi de texte valide : accepté.
        fs::write(d.path().join("bom.md"), [0xEF, 0xBB, 0xBF, 0xC3, 0xA9, b't', 0xC3, 0xA9]).unwrap();
        assert_eq!(read_note(d.path(), "bom.md").unwrap().content, "\u{e9}t\u{e9}");
    }
    #[test] fn write_note_is_atomic_and_leaves_no_tmp() {
        let d = tempdir().unwrap();
        write_note(d.path(), "n.md", "old", None).unwrap();
        let m = write_note(d.path(), "n.md", "salut\n", None).unwrap();
        assert!(m > 0);
        let files: Vec<_> = fs::read_dir(d.path()).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        assert_eq!(files, ["n.md"]);
        assert_eq!(fs::read_to_string(d.path().join("n.md")).unwrap(), "salut\n");
    }
    #[test] fn write_note_with_stale_expected_mtime_is_a_conflict() {
        let d = tempdir().unwrap();
        let m = write_note(d.path(), "n.md", "v1", None).unwrap();
        // Écriture externe (OneDrive, VS Code) : le mtime change.
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(d.path().join("n.md"), "externe").unwrap();
        assert_eq!(write_note(d.path(), "n.md", "local", Some(m)), Err("CONFLICT".to_string()));
        assert_eq!(fs::read_to_string(d.path().join("n.md")).unwrap(), "externe");
        // Avec le mtime à jour, l'écriture passe ; un fichier absent s'écrit quel que soit `expected`.
        let fresh = mtime_ms(&d.path().join("n.md"));
        assert!(write_note(d.path(), "n.md", "local", Some(fresh)).is_ok());
        assert_eq!(fs::read_to_string(d.path().join("n.md")).unwrap(), "local");
        assert!(write_note(d.path(), "absent.md", "x", Some(1)).is_ok());
    }
}
