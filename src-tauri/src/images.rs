//! Images collées ou importées : enregistrement à côté de la note et utilitaires de liens.
use crate::paths::resolve;
use regex::Regex;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::sync::OnceLock;

const ALLOWED_EXT: [&str; 5] = ["png", "jpg", "jpeg", "gif", "webp"];

fn img_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(\s+"[^"]*")?\s*\)"#).expect("regex valide")
    })
}

/// Vrai pour une cible relative (ni URL, ni lecteur Windows, ni chemin absolu).
pub fn is_relative_target(t: &str) -> bool {
    if t.is_empty() || t.starts_with('/') || t.starts_with('\\') || t.starts_with('#') {
        return false;
    }
    // Schéma (`http:`, `data:`…) ou lecteur (`C:`) : un « : » avant tout « / ».
    match (t.find(':'), t.find('/')) {
        (Some(c), Some(s)) => c > s,
        (Some(_), None) => false,
        _ => true,
    }
}

pub fn image_links(content: &str) -> Vec<String> {
    img_re()
        .captures_iter(content)
        .map(|c| c[1].to_string())
        .filter(|t| is_relative_target(t))
        .collect()
}

pub fn rewrite_image_links(content: &str, f: impl Fn(&str) -> Option<String>) -> String {
    let mut out = String::with_capacity(content.len());
    let mut last = 0;
    for caps in img_re().captures_iter(content) {
        let m = caps.get(1).expect("groupe 1");
        if !is_relative_target(m.as_str()) {
            continue;
        }
        if let Some(new) = f(m.as_str()) {
            out.push_str(&content[last..m.start()]);
            out.push_str(&new);
            last = m.end();
        }
    }
    out.push_str(&content[last..]);
    out
}

/// Préfixe des noms d'images : le nom de la note, chaque suite d'espaces devenant « - ».
pub fn slug(stem: &str) -> String {
    let mut out = String::with_capacity(stem.len());
    let mut in_ws = false;
    for c in stem.chars() {
        if c.is_whitespace() {
            if !in_ws {
                out.push('-');
            }
            in_ws = true;
        } else {
            out.push(c);
            in_ws = false;
        }
    }
    out
}

pub fn owned_images(note_stem: &str, links: &[String]) -> Vec<String> {
    let prefix = format!("images/{}-", slug(note_stem));
    links
        .iter()
        .filter(|l| l.starts_with(&prefix))
        .cloned()
        .collect()
}

/// Normalise `dir_rel/link` sans accès au disque ; `None` si le résultat sort de la racine.
pub fn norm_join(dir_rel: &str, link: &str) -> Option<Vec<String>> {
    let mut parts: Vec<String> = vec![];
    for seg in dir_rel.split('/').chain(link.split('/')) {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            s => parts.push(s.to_string()),
        }
    }
    Some(parts)
}

/// Lien relatif depuis `from_dir` (relatif à la racine) vers `target` (relatif à la racine).
pub fn rel_between(from_dir: &str, target: &[String]) -> String {
    let from: Vec<&str> = from_dir.split('/').filter(|s| !s.is_empty()).collect();
    let common = from
        .iter()
        .zip(target.iter())
        .take_while(|(a, b)| a == &&b.as_str())
        .count();
    let mut out: Vec<String> = vec!["..".into(); from.len() - common];
    out.extend(target[common..].iter().cloned());
    out.join("/")
}

fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

fn note_parts(note_rel: &str) -> (&str, &str) {
    let (dir, file) = note_rel.rsplit_once('/').unwrap_or(("", note_rel));
    (dir, file.rsplit_once('.').map_or(file, |(s, _)| s))
}

fn store(
    root: &Path,
    note_rel: &str,
    ext: &str,
    date: &str,
    mut write: impl FnMut(&mut fs::File) -> std::io::Result<()>,
) -> Result<String, String> {
    let (dir_rel, stem) = note_parts(note_rel);
    let images = resolve(root, dir_rel)?.join("images");
    fs::create_dir_all(&images)
        .map_err(|e| format!("Impossible de créer le dossier des images : {e}"))?;
    for n in 1u32.. {
        let name = format!("{}-{date}-{n}.{ext}", slug(stem));
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(images.join(&name))
        {
            Ok(mut f) => {
                let res = write(&mut f).and_then(|_| f.sync_all());
                if let Err(e) = res {
                    drop(f);
                    let _ = fs::remove_file(images.join(&name));
                    return Err(format!("Impossible d'enregistrer l'image : {e}"));
                }
                return Ok(format!("images/{name}"));
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("Impossible d'enregistrer l'image : {e}")),
        }
    }
    unreachable!()
}

fn check_ext(ext: &str) -> Result<(), String> {
    if ALLOWED_EXT.iter().any(|e| e.eq_ignore_ascii_case(ext)) {
        Ok(())
    } else {
        Err("Format d'image non pris en charge (png, jpg, jpeg, gif, webp).".into())
    }
}

pub fn save_image(root: &Path, note_rel: &str, bytes: &[u8], ext: &str) -> Result<String, String> {
    check_ext(ext)?;
    store(root, note_rel, &ext.to_ascii_lowercase(), &today(), |f| {
        f.write_all(bytes)
    })
}

pub fn import_image(root: &Path, note_rel: &str, src_abs: &str) -> Result<String, String> {
    let src = Path::new(src_abs);
    let ext = src
        .extension()
        .map(|e| e.to_string_lossy().into_owned())
        .unwrap_or_default();
    check_ext(&ext)?;
    let mut input = fs::File::open(src).map_err(|e| format!("Impossible de lire l'image : {e}"))?;
    store(root, note_rel, &ext, &today(), |f| {
        std::io::copy(&mut input, f).map(|_| ())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn today() -> String {
        chrono::Local::now().format("%Y-%m-%d").to_string()
    }

    #[test]
    fn save_image_names_sequentially() {
        let d = tempdir().unwrap();
        fs::create_dir(d.path().join("Projets")).unwrap();
        fs::write(d.path().join("Projets/MDnote.md"), "").unwrap();
        let a = save_image(d.path(), "Projets/MDnote.md", b"1", "png").unwrap();
        let b = save_image(d.path(), "Projets/MDnote.md", b"2", "png").unwrap();
        assert_eq!(a, format!("images/MDnote-{}-1.png", today()));
        assert_eq!(b, format!("images/MDnote-{}-2.png", today()));
        assert!(d.path().join("Projets").join(&a).is_file());
        assert!(d.path().join("Projets").join(&b).is_file());
    }
    #[test]
    fn save_image_rejects_bad_ext() {
        let d = tempdir().unwrap();
        assert!(save_image(d.path(), "n.md", b"1", "exe").is_err());
    }
    #[test]
    fn import_image_copies_keeping_ext() {
        let d = tempdir().unwrap();
        let src = d.path().join("photo.JPG");
        fs::write(&src, b"abc").unwrap();
        let l = import_image(d.path(), "n.md", src.to_str().unwrap()).unwrap();
        assert_eq!(l, format!("images/n-{}-1.JPG", today()));
        assert_eq!(fs::read(d.path().join(&l)).unwrap(), b"abc");
        assert!(src.exists());
    }
    #[test]
    fn rewrite_only_touches_targets() {
        let out = rewrite_image_links("a ![x](images/n-1.png) b [lien](images/n-1.png)", |_| {
            Some("images/m-1.png".into())
        });
        assert_eq!(out, "a ![x](images/m-1.png) b [lien](images/n-1.png)");
    }
    #[test]
    fn image_links_skips_urls() {
        assert_eq!(
            image_links("![](https://x/y.png) ![](images/a.png) ![](C:/a.png)"),
            ["images/a.png"]
        );
    }
    #[test]
    fn save_image_slugs_spaces() {
        let d = tempdir().unwrap();
        let l = save_image(d.path(), "Ma note.md", b"1", "png").unwrap();
        assert_eq!(l, format!("images/Ma-note-{}-1.png", today()));
    }
    #[test]
    fn owned_images_filters_by_stem() {
        let l = vec![
            "images/n-1.png".to_string(),
            "images/other-1.png".into(),
            "../images/n-2.png".into(),
        ];
        assert_eq!(owned_images("n", &l), ["images/n-1.png"]);
    }
}
