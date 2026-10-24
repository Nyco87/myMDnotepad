mod commands;
mod file_ops;
mod images;
mod notes_fs;
mod paths;
mod settings;
mod window_fx;

use settings::AppState;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            window_fx::set_window_effect,
            settings::get_settings,
            settings::save_settings,
            settings::set_root,
            settings::root_status,
            commands::list_tree,
            commands::read_note,
            commands::write_note,
            commands::create_note,
            commands::create_folder,
            commands::rename_entry,
            commands::move_entry,
            commands::trash_entry,
            commands::save_image,
            commands::import_image
        ])
        .setup(|app| {
            let exe_dir = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.to_path_buf()))
                .unwrap_or_else(|| PathBuf::from("."));
            let appdata = std::env::var_os("APPDATA")
                .map(PathBuf::from)
                .unwrap_or_else(|| exe_dir.clone());
            let settings_path = settings::settings_path(&exe_dir, &appdata);
            let loaded = settings::load(&settings_path);
            let effect = loaded.window_effect.clone();
            if let Some(r) = loaded.root_dir.as_deref().filter(|r| std::path::Path::new(r).is_dir()) {
                let _ = app.asset_protocol_scope().allow_directory(r, true);
            }
            app.manage(AppState {
                settings_path,
                settings: Mutex::new(loaded),
            });

            let window = app
                .get_webview_window("main")
                .ok_or("fenêtre principale introuvable")?;
            // Ne jamais interrompre le démarrage à cause de l'effet de fenêtre.
            if window_fx::apply(&window, &effect).is_err() {
                let _ = window_fx::apply(&window, "mica");
            }
            window.show()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
