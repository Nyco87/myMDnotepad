//! Commandes Tauri exposées au front pour l'arborescence et les opérations sur les fichiers.
use crate::notes_fs::{NoteFile, TreeNode};
use crate::settings::AppState;
use crate::{file_ops, images, notes_fs};
use tauri::State;

#[tauri::command]
pub fn list_tree(state: State<AppState>) -> Result<TreeNode, String> {
    notes_fs::list_tree(&state.root()?)
}

#[tauri::command]
pub fn read_note(state: State<AppState>, rel: String) -> Result<NoteFile, String> {
    notes_fs::read_note(&state.root()?, &rel)
}

#[tauri::command]
pub fn write_note(state: State<AppState>, rel: String, content: String) -> Result<u64, String> {
    notes_fs::write_note(&state.root()?, &rel, &content)
}

#[tauri::command]
pub fn create_note(state: State<AppState>, dir_rel: String, base_name: String) -> Result<String, String> {
    file_ops::create_note(&state.root()?, &dir_rel, &base_name)
}

#[tauri::command]
pub fn create_folder(state: State<AppState>, dir_rel: String, name: String) -> Result<String, String> {
    file_ops::create_folder(&state.root()?, &dir_rel, &name)
}

#[tauri::command]
pub fn rename_entry(state: State<AppState>, rel: String, new_name: String) -> Result<String, String> {
    file_ops::rename_entry(&state.root()?, &rel, &new_name)
}

#[tauri::command]
pub fn move_entry(state: State<AppState>, rel: String, dest_dir_rel: String) -> Result<String, String> {
    file_ops::move_entry(&state.root()?, &rel, &dest_dir_rel)
}

#[tauri::command]
pub fn trash_entry(state: State<AppState>, rel: String) -> Result<(), String> {
    file_ops::trash_entry(&state.root()?, &rel)
}

#[tauri::command]
pub fn save_image(state: State<AppState>, note_rel: String, bytes: Vec<u8>, ext: String) -> Result<String, String> {
    images::save_image(&state.root()?, &note_rel, &bytes, &ext)
}

#[tauri::command]
pub fn import_image(state: State<AppState>, note_rel: String, src_abs: String) -> Result<String, String> {
    images::import_image(&state.root()?, &note_rel, &src_abs)
}
