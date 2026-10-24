use crate::images::{self, norm_join, rel_between};
use crate::notes_fs::{is_md, read_note, write_note};
use crate::paths::{resolve, to_rel};
use std::collections::{HashMap, HashSet};
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

fn split_rel(rel: &str) -> (&str, &str) {
    let (dir, file) = rel.rsplit_once('/').unwrap_or(("", rel));
    (dir, file.rsplit_once('.').map_or(file, |(s, _)| s))
}

/// Clés (chemins normalisés, minuscules) des images référencées par les notes autres que `exclude`.
fn referenced_elsewhere(root: &Path, exclude: &Path) -> HashSet<String> {
    let mut notes = vec![];
    collect_md(root, &mut notes);
    let mut referenced = HashSet::new();
    for n in notes {
        if n == exclude {
            continue;
        }
        let nrel = to_rel(root, &n);
        let ndir = split_rel(&nrel).0.to_string();
        let Ok(other) = read_note(root, &nrel) else { continue };
        for l in images::image_links(&other.content) {
            if let Some(parts) = norm_join(&ndir, &l) {
                referenced.insert(parts.join("/").to_lowercase());
            }
        }
    }
    referenced
}

/// Déplace (ou copie si une autre note y fait référence) les images possédées, et recalcule
/// les autres liens. Remplit `map` au fur et à mesure pour qu'un échec partiel reste cohérent.
fn relocate_links(
    root: &Path, old_rel: &str, new_rel: &str, links: &[String], map: &mut HashMap<String, String>,
) -> Result<(), String> {
    let (old_dir, old_stem) = split_rel(old_rel);
    let (new_dir, new_stem) = split_rel(new_rel);
    let owned_prefix = format!("images/{}-", images::slug(old_stem));
    let new_slug = images::slug(new_stem);
    let mut shared: Option<HashSet<String>> = None;
    for link in links {
        if map.contains_key(link) {
            continue;
        }
        let rest = link.strip_prefix(&owned_prefix).filter(|r| !r.contains('/'));
        if let Some(rest) = rest {
            let from = resolve(root, &format!("{old_dir}/{link}").trim_start_matches('/').to_string())?;
            if !from.is_file() {
                continue;
            }
            let dest_dir = resolve(root, &format!("{new_dir}/images").trim_start_matches('/').to_string())?;
            let new_name = format!("{new_slug}-{rest}");
            let direct = dest_dir.join(&new_name);
            if from == direct {
                continue;
            }
            let case_only = from.parent() == Some(dest_dir.as_path())
                && from.file_name().is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case(&new_name));
            let key = norm_join(old_dir, link).map(|p| p.join("/").to_lowercase()).unwrap_or_default();
            let is_shared = shared
                .get_or_insert_with(|| {
                    let this = resolve(root, new_rel).unwrap_or_default();
                    referenced_elsewhere(root, &this)
                })
                .contains(&key);
            let to = if case_only && !is_shared {
                direct
            } else {
                let p = Path::new(&new_name);
                let stem = p.file_stem().unwrap_or_default().to_string_lossy().into_owned();
                let ext = p.extension().map(|e| e.to_string_lossy().into_owned());
                fs::create_dir_all(&dest_dir).map_err(|e| format!("Impossible de créer le dossier des images : {e}"))?;
                unique_path(&dest_dir, &stem, ext.as_deref())
            };
            if is_shared {
                fs::copy(&from, &to).map_err(|e| format!("Impossible de copier l'image : {e}"))?;
            } else {
                fs::rename(&from, &to).map_err(|e| format!("Impossible de déplacer l'image : {e}"))?;
            }
            let name = to.file_name().unwrap_or_default().to_string_lossy().into_owned();
            map.insert(link.clone(), format!("images/{name}"));
        } else if old_dir != new_dir {
            if let Some(target) = norm_join(old_dir, link) {
                let nl = rel_between(new_dir, &target);
                if nl != *link {
                    map.insert(link.clone(), nl);
                }
            }
        }
    }
    Ok(())
}

/// Après le renommage/déplacement d'une note de `old_rel` vers `new_rel` : ses images possédées
/// la suivent (jamais d'écrasement) et les autres liens relatifs sont recalculés.
/// La note n'est réécrite que si au moins un lien a changé. En cas d'échec en cours de route,
/// les liens des images déjà déplacées sont écrits avant de renvoyer l'erreur.
fn follow_note(root: &Path, old_rel: &str, new_rel: &str) -> Result<(), String> {
    let note = read_note(root, new_rel)?;
    let links = images::image_links(&note.content);
    if links.is_empty() {
        return Ok(());
    }
    let mut map: HashMap<String, String> = HashMap::new();
    let res = relocate_links(root, old_rel, new_rel, &links, &mut map);
    let updated = images::rewrite_image_links(&note.content, |l| map.get(l).cloned());
    if updated != note.content {
        write_note(root, new_rel, &updated, None)?;
    }
    res
}

fn collect_md(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let Ok(ft) = e.file_type() else { continue };
        let p = e.path();
        if ft.is_dir() {
            if !e.file_name().to_string_lossy().starts_with('.') {
                collect_md(&p, out);
            }
        } else if ft.is_file() && is_md(&p) {
            out.push(p);
        }
    }
}

/// Images possédées par la note `rel` et qu'aucune autre note ne référence (chemins absolus).
fn unshared_owned_images(root: &Path, rel: &str) -> Vec<PathBuf> {
    let (dir, stem) = split_rel(rel);
    let Ok(note) = read_note(root, rel) else { return vec![] };
    let links = images::image_links(&note.content);
    let mut mine: Vec<(String, PathBuf)> = vec![];
    for link in images::owned_images(stem, &links) {
        let Some(parts) = norm_join(dir, &link) else { continue };
        if let Ok(p) = resolve(root, &parts.join("/")) {
            if p.is_file() {
                mine.push((parts.join("/").to_lowercase(), p));
            }
        }
    }
    if mine.is_empty() {
        return vec![];
    }
    let referenced = referenced_elsewhere(root, &resolve(root, rel).unwrap_or_default());
    let mut seen = HashSet::new();
    mine.into_iter().filter(|(k, _)| !referenced.contains(k) && seen.insert(k.clone())).map(|(_, p)| p).collect()
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
        if is_note {
            follow_note(root, rel, &to_rel(root, &dst))?;
        }
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
    let new_rel = to_rel(root, &dst);
    if src.extension().is_some() && is_md(&dst) && dst.is_file() {
        follow_note(root, rel, &new_rel)?;
    }
    Ok(new_rel)
}

pub fn trash_entry(root: &Path, rel: &str) -> Result<(), String> {
    let p = resolve(root, rel)?;
    if p == root {
        return Err("Impossible de supprimer le dossier racine.".into());
    }
    if !p.exists() {
        return Err("L'élément à supprimer n'existe plus.".into());
    }
    let images = if p.is_file() && is_md(&p) { unshared_owned_images(root, rel) } else { vec![] };
    trash::delete(&p).map_err(|e| format!("Impossible de mettre à la corbeille : {e}"))?;
    for img in images {
        let _ = trash::delete(&img); // au mieux : la note est déjà à la Corbeille
    }
    Ok(())
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
    fn md_with(root: &std::path::Path, rel: &str, c: &str) { let p = root.join(rel); fs::create_dir_all(p.parent().unwrap()).unwrap(); fs::write(p, c).unwrap(); }
    #[test] fn rename_note_renames_owned_images() {
        let d = tempdir().unwrap(); let r = d.path();
        md_with(r, "n.md", "![](images/n-2026-10-24-1.png)");
        md_with(r, "images/n-2026-10-24-1.png", "img");
        assert_eq!(rename_entry(r, "n.md", "m").unwrap(), "m.md");
        assert!(r.join("images/m-2026-10-24-1.png").is_file());
        assert!(!r.join("images/n-2026-10-24-1.png").exists());
        assert_eq!(fs::read_to_string(r.join("m.md")).unwrap(), "![](images/m-2026-10-24-1.png)");
    }
    #[test] fn move_note_carries_images_and_fixes_other_links() {
        let d = tempdir().unwrap(); let r = d.path();
        md_with(r, "A/n.md", "![](images/n-2026-10-24-1.png)
![](../shared/s.png)");
        md_with(r, "A/images/n-2026-10-24-1.png", "img");
        md_with(r, "shared/s.png", "s");
        fs::create_dir_all(r.join("B/C")).unwrap();
        assert_eq!(move_entry(r, "A/n.md", "B/C").unwrap(), "B/C/n.md");
        assert!(r.join("B/C/images/n-2026-10-24-1.png").is_file());
        assert!(!r.join("A/images/n-2026-10-24-1.png").exists());
        assert_eq!(fs::read_to_string(r.join("B/C/n.md")).unwrap(), "![](images/n-2026-10-24-1.png)
![](../../shared/s.png)");
    }
    #[test] fn move_never_overwrites_existing_image() {
        let d = tempdir().unwrap(); let r = d.path();
        md_with(r, "A/n.md", "![](images/n-1.png)");
        md_with(r, "A/images/n-1.png", "mine");
        md_with(r, "B/images/n-1.png", "other");
        move_entry(r, "A/n.md", "B").unwrap();
        assert_eq!(fs::read_to_string(r.join("B/images/n-1.png")).unwrap(), "other");
        assert_eq!(fs::read_to_string(r.join("B/images/n-1 2.png")).unwrap(), "mine");
        assert_eq!(fs::read_to_string(r.join("B/n.md")).unwrap(), "![](images/n-1 2.png)");
    }
    #[test] fn trash_note_keeps_shared_image() {
        let d = tempdir().unwrap(); let r = d.path();
        md_with(r, "n.md", "![](images/n-2026-10-24-1.png)");
        md_with(r, "o.md", "![](images/n-2026-10-24-1.png)");
        md_with(r, "images/n-2026-10-24-1.png", "img");
        trash_entry(r, "n.md").unwrap();
        assert!(r.join("images/n-2026-10-24-1.png").is_file());
    }
    #[test] fn trash_note_trashes_unshared_images() {
        let d = tempdir().unwrap(); let r = d.path();
        md_with(r, "n.md", "![](images/n-1.png)");
        md_with(r, "images/n-1.png", "img");
        trash_entry(r, "n.md").unwrap();
        assert!(!r.join("images/n-1.png").exists());
    }
    #[test] fn move_without_links_does_not_rewrite() {
        let d = tempdir().unwrap(); let r = d.path();
        md_with(r, "n.md", "# rien
sans image
");
        fs::create_dir(r.join("D")).unwrap();
        let before = fs::metadata(r.join("n.md")).unwrap().modified().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(50));
        move_entry(r, "n.md", "D").unwrap();
        assert_eq!(fs::metadata(r.join("D/n.md")).unwrap().modified().unwrap(), before);
    }
    #[test] fn move_folder_keeps_images_inside() {
        let d = tempdir().unwrap(); let r = d.path();
        md_with(r, "A/n.md", "![](images/n-1.png)");
        md_with(r, "A/images/n-1.png", "img");
        fs::create_dir(r.join("B")).unwrap();
        move_entry(r, "A", "B").unwrap();
        assert!(r.join("B/A/images/n-1.png").is_file());
        assert_eq!(fs::read_to_string(r.join("B/A/n.md")).unwrap(), "![](images/n-1.png)");
    }
    #[test] fn rename_note_with_spaces_slugs_images() {
        let d = tempdir().unwrap(); let r = d.path();
        md_with(r, "Ma note.md", "![](images/Ma-note-2026-10-24-1.png)");
        md_with(r, "images/Ma-note-2026-10-24-1.png", "img");
        assert_eq!(rename_entry(r, "Ma note.md", "Autre note").unwrap(), "Autre note.md");
        assert!(r.join("images/Autre-note-2026-10-24-1.png").is_file());
        assert_eq!(fs::read_to_string(r.join("Autre note.md")).unwrap(), "![](images/Autre-note-2026-10-24-1.png)");
    }
    #[test] fn move_copies_image_shared_with_other_note() {
        let d = tempdir().unwrap(); let r = d.path();
        md_with(r, "n.md", "![](images/n-1.png)");
        md_with(r, "o.md", "![](images/n-1.png)");
        md_with(r, "images/n-1.png", "img");
        fs::create_dir(r.join("B")).unwrap();
        move_entry(r, "n.md", "B").unwrap();
        assert!(r.join("B/images/n-1.png").is_file());
        assert!(r.join("images/n-1.png").is_file());
        assert_eq!(fs::read_to_string(r.join("o.md")).unwrap(), "![](images/n-1.png)");
        assert_eq!(fs::read_to_string(r.join("B/n.md")).unwrap(), "![](images/n-1.png)");
    }
    #[cfg(windows)]
    #[test] fn partial_failure_still_rewrites_moved_links() {
        use std::os::windows::fs::OpenOptionsExt;
        let d = tempdir().unwrap(); let r = d.path();
        md_with(r, "n.md", "![](images/n-1.png) ![](images/n-2.png)");
        md_with(r, "images/n-1.png", "a");
        md_with(r, "images/n-2.png", "b");
        fs::create_dir(r.join("B")).unwrap();
        // Verrou sans partage de suppression sur la 2e image : son déplacement échoue.
        let _lock = fs::OpenOptions::new().read(true).share_mode(1).open(r.join("images/n-2.png")).unwrap();
        assert!(move_entry(r, "n.md", "B").is_err());
        assert_eq!(fs::read_to_string(r.join("B/n.md")).unwrap(), "![](images/n-1.png) ![](images/n-2.png)");
        assert!(r.join("B/images/n-1.png").is_file());
    }
}
