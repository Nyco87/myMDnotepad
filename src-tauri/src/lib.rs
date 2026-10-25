mod accent;
mod commands;
mod file_ops;
mod images;
mod notes_fs;
mod paths;
mod settings;
mod watcher;
mod window_fx;

use settings::AppState;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
use tauri::Manager;

static START: OnceLock<Instant> = OnceLock::new();

/// Appelée par le frontend quand l'onglet actif (ou l'écran de premier lancement) est affiché :
/// écrit `startup_ms=<n>` sur stdout et dans `%TEMP%\mymdnotepad-startup.log`.
#[tauri::command]
fn mark_ready() {
    use std::io::Write;
    let ms = START.get().map(|s| s.elapsed().as_millis()).unwrap_or(0);
    println!("startup_ms={ms}");
    let _ = std::io::stdout().flush();
    let log = std::env::temp_dir().join("mymdnotepad-startup.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(log) {
        let _ = writeln!(f, "startup_ms={ms}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = START.set(Instant::now());
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            mark_ready,
            accent::get_accent_color,
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
            settings::migrate_legacy(&settings_path, &exe_dir, &appdata);
            let loaded = settings::load(&settings_path);
            if let Some(r) = loaded.root_dir.as_deref().filter(|r| std::path::Path::new(r).is_dir()) {
                let _ = app.asset_protocol_scope().allow_directory(r, true);
            }
            let root_for_watch = loaded.root_dir.clone();
            app.manage(AppState {
                settings_path,
                settings: Mutex::new(loaded),
                watcher: Mutex::new(None),
            });
            if let Some(r) = root_for_watch {
                let handle = app.handle().clone();
                app.state::<AppState>().restart_watcher(&handle, std::path::Path::new(&r));
            }

            accent::install(app.handle());

            let window = app
                .get_webview_window("main")
                .ok_or("fenêtre principale introuvable")?;
            // Ne jamais interrompre le démarrage à cause de l'effet de fenêtre.
            let _ = window_fx::apply_acrylic_effect(&window);
            window.show()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
