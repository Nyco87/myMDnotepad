mod window_fx;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![window_fx::set_window_effect])
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .ok_or("fenêtre principale introuvable")?;
            window_fx::apply(&window, "acrylic")?;
            window.show()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
