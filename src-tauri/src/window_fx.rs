use tauri::{AppHandle, Manager, WebviewWindow};
use window_vibrancy::apply_acrylic;

/// Alpha du voile acrylique pour une transparence 0 (opaque) … 100 (transparent) ; 50 = rendu historique (160).
pub fn alpha_for(transparency: u8) -> u8 {
    let t = transparency.min(100) as f32;
    let a = if t <= 50.0 { 255.0 - t * 1.9 } else { 160.0 - (t - 50.0) * 2.4 };
    a.round() as u8
}

/// Applique l'effet acrylique à la fenêtre (le seul effet : Mica a été retiré).
pub fn apply_acrylic_effect(window: &WebviewWindow, transparency: u8) -> Result<(), String> {
    apply_acrylic(window, Some((18, 18, 18, alpha_for(transparency)))).map_err(|e| e.to_string())
}

/// Réapplique le voile (aperçu en direct) ; sans effet si la fenêtre est absente.
pub fn apply_transparency(app: &AppHandle, transparency: u8) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = apply_acrylic_effect(&w, transparency);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn alpha_mapping_is_monotonic_and_anchored() {
        assert_eq!(alpha_for(0), 255);
        assert_eq!(alpha_for(50), 160);
        assert_eq!(alpha_for(100), 40);
        assert!((0..100u8).all(|t| alpha_for(t) >= alpha_for(t + 1)));
        assert_eq!(alpha_for(200), 40);
    }
}
