use crate::paths::{resolve, to_rel};
use std::fs;
use std::path::{Path, PathBuf};

const EXISTS: &str = "Une note ou un dossier porte déjà ce nom.";

pub fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Le nom ne peut pas être vide.".into());
    }
    if name.chars().count() > 200 {
        return Err("Le nom est trop long (200 caractères maximum).".into());
    }
    if name.chars().any(|c| "<>:\"/\\|?*".contains(c) || c.is_control()) {
        return Err("Le nom contient un caractère interdit : < > : \" / \\ | ? *".into());
    }
    if name.ends_with('.') || name.ends_with(' ') {
        return Err("Le nom ne peut pas finir par un point ou un espace.".into());
    }
    let base = name.split('.').next().unwrap_or("").trim_end().to_ascii_uppercase();
    let reserved = matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((base.starts_with("COM") || base.starts_with("LPT"))
            && base.len() == 4
            && matches!(base.as_bytes()[3], b'1'..=b'9'));
    if reserved {
        return Err("Ce nom est réservé par Windows.".into());
    }
    Ok(())
}

pub fn unique_path(dir: &Path, stem: &str, ext: Option<&str>) -> PathBuf {
    let make = |s: &str| match ext {
        Some(e) => dir.join(format!("{s}.{e}")),
        None => dir.join(s),
    };
    let first = make(stem);
    if !first.exists() {
        return first;
    }
    (2u32..)
        .map(|n| make(&format!("{stem} {n}")))
        .find(|p| !p.exists())
        .expect("compteur illimité")
}

fn strip_md(name: &str) -> &str {
    let t = name.trim();
    if t.len() > 3 && t[t.len() - 3..].eq_ignore_ascii_case(".md") { &t[..t.len() - 3] } else { t }
}

pub fn create_note(root: &Path, dir_rel: &str, base: &str) -> Result<String, String> {
    let stem = strip_md(base);
    validate_name(stem)?;
    let dir = resolve(root, dir_rel)?;
    if !dir.is_dir() {
        return Err("Le dossier de destination n'existe pas.".into());
    }
    let p = unique_path(&dir, stem, Some("md"));
    fs::File::create_new(&p).map_err(|e| format!("Impossible de créer la note : {e}"))?;
    Ok(to_rel(root, &p))
}

pub fn create_folder(root: &Path, dir_rel: &str, name: &str) -> Result<String, String> {
    let name = name.trim();
    validate_name(name)?;
    let dir = resolve(root, dir_rel)?;
    if !dir.is_dir() {
        return Err("Le dossier de destination n'existe pas.".into());
    }
    let p = unique_path(&dir, name, None);
    fs::create_dir(&p).map_err(|e| format!("Impossible de créer le dossier : {e}"))?;
    Ok(to_rel(root, &p))
}

pub fn rename_entry(root: &Path, rel: &str, new_name: &str) -> Result<String, String> {
    let src = resolve(root, rel)?;
    if src == root {
        return Err("Impossible de renommer le dossier racine.".into());
    }
    if !src.exists() {
        return Err("L'élément à renommer n'existe plus.".into());
    }
    let is_note = src.is_file();
    let new_name = new_name.trim();
    let stem = if is_note { strip_md(new_name) } else { new_name };
    validate_name(stem)?;
    let final_name = if is_note { format!("{stem}.md") } else { stem.to_string() };
    let dst = src.with_file_name(&final_name);
    if dst != src {
        // Sous Windows, un simple changement de casse désigne le même fichier.
        let same = src.file_name().is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case(&final_name));
        if dst.exists() && !same {
            return Err(EXISTS.into());
        }
        fs::rename(&src, &dst).map_err(|e| format!("Impossible de renommer : {e}"))?;
    }
    Ok(to_rel(root, &dst))
}

pub fn move_entry(root: &Path, rel: &str, dest_dir_rel: &str) -> Result<String, String> {
    let src = resolve(root, rel)?;
    if src == root {
        return Err("Impossible de déplacer le dossier racine.".into());
    }
    let dest_dir = resolve(root, dest_dir_rel)?;
    if !src.exists() {
        return Err("L'élément à déplacer n'existe plus.".into());
    }
    if !dest_dir.is_dir() {
        return Err("Le dossier de destination n'existe pas.".into());
    }
    if src.is_dir() && dest_dir.starts_with(&src) {
        return Err("Impossible de déplacer un dossier dans lui-même.".into());
    }
    if src.parent() == Some(dest_dir.as_path()) {
        return Ok(to_rel(root, &src));
    }
    let (stem, ext) = if src.is_file() {
        (
            src.file_stem().unwrap_or_default().to_string_lossy().into_owned(),
            src.extension().map(|e| e.to_string_lossy().into_owned()),
        )
    } else {
        (src.file_name().unwrap_or_default().to_string_lossy().into_owned(), None)
    };
    let dst = unique_path(&dest_dir, &stem, ext.as_deref());
    fs::rename(&src, &dst).map_err(|e| format!("Impossible de déplacer : {e}"))?;
    Ok(to_rel(root, &dst))
}

pub fn trash_entry(root: &Path, rel: &str) -> Result<(), String> {
    let p = resolve(root, rel)?;
    if p == root {
        return Err("Impossible de supprimer le dossier racine.".into());
    }
    if !p.exists() {
        return Err("L'élément à supprimer n'existe plus.".into());
    }
    trash::delete(&p).map_err(|e| format!("Impossible de mettre à la corbeille : {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use std::fs;

    #[test] fn validate_name_rejects() {
        for n in ["", "a?b", "CON", "con.md", "nom.", "nom ", "a/b"] {
            assert!(validate_name(n).is_err(), "{n:?} should be rejected");
        }
        assert!(validate_name(&"a".repeat(201)).is_err());
    }
    #[test] fn validate_name_accepts() { assert!(validate_name("Réunion 24-10 ✅").is_ok()); }
    #[test] fn create_note_suffixes_on_conflict() {
        let d = tempdir().unwrap();
        assert_eq!(create_note(d.path(), "", "Nouvelle note").unwrap(), "Nouvelle note.md");
        assert_eq!(create_note(d.path(), "", "Nouvelle note").unwrap(), "Nouvelle note 2.md");
    }
    #[test] fn rename_refuses_existing_target() {
        let d = tempdir().unwrap();
        fs::write(d.path().join("a.md"), "").unwrap();
        fs::write(d.path().join("b.md"), "").unwrap();
        assert_eq!(rename_entry(d.path(), "a.md", "b").unwrap_err(), "Une note ou un dossier porte déjà ce nom.");
        assert_eq!(rename_entry(d.path(), "a.md", "c").unwrap(), "c.md");
    }
    #[test] fn move_suffixes_on_conflict() {
        let d = tempdir().unwrap();
        fs::create_dir(d.path().join("D")).unwrap();
        fs::write(d.path().join("D/a.md"), "").unwrap();
        fs::write(d.path().join("a.md"), "").unwrap();
        assert_eq!(move_entry(d.path(), "a.md", "D").unwrap(), "D/a 2.md");
    }
    #[test] fn move_folder_into_itself_is_refused() {
        let d = tempdir().unwrap();
        fs::create_dir_all(d.path().join("A/B")).unwrap();
        assert!(move_entry(d.path(), "A", "A/B").is_err());
        assert!(move_entry(d.path(), "A", "A").is_err());
    }
    #[test] fn trash_entry_removes_file() {
        let d = tempdir().unwrap();
        fs::write(d.path().join("t.md"), "x").unwrap();
        trash_entry(d.path(), "t.md").unwrap();
        assert!(!d.path().join("t.md").exists());
    }
}
