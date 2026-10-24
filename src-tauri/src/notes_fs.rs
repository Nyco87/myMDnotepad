use crate::paths::{resolve, to_rel};
use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::Path;

#[derive(Serialize, Clone, Debug)]
pub struct TreeNode {
    pub name: String,
    pub rel: String,
    pub is_dir: bool,
    pub children: Vec<TreeNode>,
}

#[derive(Serialize, Clone, Debug)]
pub struct NoteFile {
    pub rel: String,
    pub content: String,
    pub mtime: u64,
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
                notes.push(TreeNode { name: stem, rel: to_rel(root, &p), is_dir: false, children: vec![] });
            }
        }
    }
    folders.sort_by_key(|n| n.name.to_lowercase());
    notes.sort_by_key(|n| n.name.to_lowercase());
    folders.extend(notes);
    TreeNode { name, rel: to_rel(root, dir), is_dir: true, children: folders }
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
    let text = String::from_utf8_lossy(&bytes);
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text).replace("\r\n", "\n");
    Ok(NoteFile { rel: rel.to_string(), content: text, mtime: mtime_ms(&p) })
}

pub fn write_note(root: &Path, rel: &str, content: &str) -> Result<u64, String> {
    let p = resolve(root, rel)?;
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
        let names: Vec<_> = t.children.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, ["Dossier", "Vide", "A", "b"]);
        assert_eq!(t.children[0].children[0].rel, "Dossier/n.md");
    }
    #[test] fn read_note_normalizes_crlf_and_bom() {
        let d = tempdir().unwrap();
        let mut b = vec![0xEF, 0xBB, 0xBF]; b.extend_from_slice(b"# T\r\nx\r\n");
        fs::write(d.path().join("n.md"), b).unwrap();
        assert_eq!(read_note(d.path(), "n.md").unwrap().content, "# T\nx\n");
    }
    #[test] fn write_note_is_atomic_and_leaves_no_tmp() {
        let d = tempdir().unwrap();
        write_note(d.path(), "n.md", "old").unwrap();
        let m = write_note(d.path(), "n.md", "salut\n").unwrap();
        assert!(m > 0);
        let files: Vec<_> = fs::read_dir(d.path()).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        assert_eq!(files, ["n.md"]);
        assert_eq!(fs::read_to_string(d.path().join("n.md")).unwrap(), "salut\n");
    }
}
