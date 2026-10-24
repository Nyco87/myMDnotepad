use tauri::WebviewWindow;
use window_vibrancy::apply_acrylic;

/// Applique l'effet acrylique à la fenêtre (le seul effet : Mica a été retiré).
pub fn apply_acrylic_effect(window: &WebviewWindow) -> Result<(), String> {
    apply_acrylic(window, Some((18, 18, 18, 160))).map_err(|e| e.to_string())
}
