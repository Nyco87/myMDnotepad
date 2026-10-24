use std::path::{Component, Path, PathBuf};

/// Résout un chemin relatif (séparateur `/`) à l'intérieur de `root`.
/// Refuse les chemins absolus, les `\` et tout `..` qui sortirait de la racine.
#[allow(dead_code)] // utilisé par les tâches suivantes
pub fn resolve(root: &Path, rel: &str) -> Result<PathBuf, String> {
    if rel.contains('\\') {
        return Err(format!("Chemin invalide (caractère « \\ » interdit) : {rel}"));
    }
    if rel.starts_with('/') || rel.contains(':') || Path::new(rel).is_absolute() {
        return Err(format!("Chemin absolu interdit : {rel}"));
    }
    let mut out = root.to_path_buf();
    let mut depth = 0usize;
    for comp in Path::new(rel).components() {
        match comp {
            Component::Normal(c) => {
                out.push(c);
                depth += 1;
            }
            Component::CurDir => {}
            Component::ParentDir => {
                if depth == 0 {
                    return Err(format!("Chemin hors du dossier de notes : {rel}"));
                }
                out.pop();
                depth -= 1;
            }
            _ => return Err(format!("Chemin invalide : {rel}")),
        }
    }
    Ok(out)
}

/// Chemin relatif à `root`, avec `/` comme séparateur. Hors racine : chemin complet normalisé.
#[allow(dead_code)] // utilisé par les tâches suivantes
pub fn to_rel(root: &Path, abs: &Path) -> String {
    let rel = abs.strip_prefix(root).unwrap_or(abs);
    rel.components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test] fn resolve_accepts_nested() { let r = tempdir().unwrap(); assert_eq!(resolve(r.path(), "a/b.md").unwrap(), r.path().join("a").join("b.md")); }
    #[test] fn resolve_empty_is_root() { let r = tempdir().unwrap(); assert_eq!(resolve(r.path(), "").unwrap(), r.path().to_path_buf()); }
    #[test] fn resolve_rejects_escape() {
        let r = tempdir().unwrap();
        assert!(resolve(r.path(), "../x.md").is_err());
        assert!(resolve(r.path(), "a/../../x.md").is_err());
        assert!(resolve(r.path(), "C:/x.md").is_err());
        assert!(resolve(r.path(), "/x.md").is_err());
        assert!(resolve(r.path(), "a\\b.md").is_err());
    }
    #[test] fn resolve_allows_inner_dotdot() { let r = tempdir().unwrap(); assert_eq!(resolve(r.path(), "a/../b.md").unwrap(), r.path().join("b.md")); }
    #[test] fn to_rel_uses_forward_slashes() { let r = tempdir().unwrap(); assert_eq!(to_rel(r.path(), &r.path().join("a").join("b.md")), "a/b.md"); }
}
