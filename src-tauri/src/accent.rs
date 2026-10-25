//! Couleur d'accentuation de Windows (WinRT `UISettings`), lue à la demande et suivie à chaud.
use tauri::{AppHandle, Emitter, Manager, State};
use windows::Foundation::TypedEventHandler;
use windows::UI::ViewManagement::{UIColorType, UISettings};

/// `#rrggbb` en minuscules.
pub fn to_hex(r: u8, g: u8, b: u8) -> String {
    format!("#{r:02x}{g:02x}{b:02x}")
}

/// Objet `UISettings` gardé vivant (état géré par Tauri) : sa suppression arrêterait les notifications.
pub struct AccentState {
    settings: Option<UISettings>,
}

/// AccentLight2 : teinte utilisée par Windows 11 en thème sombre (meilleur contraste que Accent).
fn read(settings: &UISettings) -> Result<String, String> {
    let c = settings
        .GetColorValue(UIColorType::AccentLight2)
        .map_err(|e| e.to_string())?;
    Ok(to_hex(c.R, c.G, c.B))
}

#[tauri::command]
pub fn get_accent_color(state: State<AccentState>) -> Result<String, String> {
    match &state.settings {
        Some(s) => read(s),
        None => Err("accent indisponible".into()),
    }
}

/// Crée l'objet `UISettings`, s'abonne à `ColorValuesChanged` (événement `accent-changed`) et le range dans l'état.
/// Ne fait jamais échouer le démarrage : sans WinRT, `get_accent_color` renvoie une erreur et le front garde le repli.
pub fn install(app: &AppHandle) {
    let settings = UISettings::new().ok();
    if let Some(s) = &settings {
        let handle = app.clone();
        let source = s.clone();
        let _ = s.ColorValuesChanged(&TypedEventHandler::new(move |_, _| {
            if let Ok(hex) = read(&source) {
                let _ = handle.emit("accent-changed", hex);
            }
            Ok(())
        }));
    }
    app.manage(AccentState { settings });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_formats_color() {
        assert_eq!(to_hex(0, 99, 177), "#0063b1");
        assert_eq!(to_hex(255, 255, 255), "#ffffff");
        assert_eq!(to_hex(1, 2, 3), "#010203");
    }
}
