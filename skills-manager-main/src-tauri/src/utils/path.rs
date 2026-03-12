use std::fs;
use std::path::{Component, Path, PathBuf};

#[cfg(windows)]
fn strip_windows_verbatim_prefix(path: &Path) -> PathBuf {
    let raw = path.to_string_lossy();
    if let Some(rest) = raw.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{}", rest));
    }
    if let Some(rest) = raw.strip_prefix(r"\\?\") {
        return PathBuf::from(rest.to_string());
    }
    path.to_path_buf()
}

#[cfg(not(windows))]
fn strip_windows_verbatim_prefix(path: &Path) -> PathBuf {
    path.to_path_buf()
}

pub fn normalize_path(path: &Path) -> PathBuf {
    let path = strip_windows_verbatim_prefix(path);
    let mut normalized = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            _ => normalized.push(comp),
        }
    }
    normalized
}

pub fn sanitize_dir_name(name: &str) -> String {
    let mut out = String::new();
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            out.push(ch.to_ascii_lowercase());
        } else if ch.is_whitespace() || ch == '.' {
            out.push('-');
        }
    }
    if out.is_empty() {
        "skill".to_string()
    } else {
        out.trim_matches('-').to_string()
    }
}

pub fn resolve_canonical(path: &Path) -> Option<PathBuf> {
    fs::canonicalize(path)
        .ok()
        .map(|canon| normalize_path(&canon))
}
