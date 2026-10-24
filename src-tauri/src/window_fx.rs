use tauri::WebviewWindow;
use window_vibrancy::{apply_acrylic, apply_mica};

/// Applique l'effet de fond (`"acrylic"` ou `"mica"`) à la fenêtre.
pub fn apply(window: &WebviewWindow, effect: &str) -> Result<(), String> {
    match effect {
        "acrylic" => apply_acrylic(window, Some((18, 18, 18, 160))).map_err(|e| e.to_string()),
        "mica" => apply_mica(window, Some(true)).map_err(|e| e.to_string()),
        other => Err(format!("effet de fenêtre inconnu : {other}")),
    }
}

#[tauri::command]
pub fn set_window_effect(window: WebviewWindow, effect: String) -> Result<(), String> {
    apply(&window, &effect)
}
