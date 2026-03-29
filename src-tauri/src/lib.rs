mod pty;
mod fs;
mod settings;
mod commands;

use pty::PtyManager;
use settings::AppSettings;
use std::sync::Mutex;
use tauri::State;

struct AppState {
    pty_manager: Mutex<PtyManager>,
    settings: Mutex<AppSettings>,
}

// === PTY Commands ===

#[tauri::command]
fn create_pty(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<String, String> {
    let mut manager = state.pty_manager.lock().map_err(|e| e.to_string())?;
    manager.create(app_handle, cols, rows, cwd)
}

#[tauri::command]
fn write_pty(
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let mut manager = state.pty_manager.lock().map_err(|e| e.to_string())?;
    manager.write(&session_id, &data)
}

#[tauri::command]
fn resize_pty(
    state: State<'_, AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let mut manager = state.pty_manager.lock().map_err(|e| e.to_string())?;
    manager.resize(&session_id, cols, rows)
}

#[tauri::command]
fn kill_pty(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let mut manager = state.pty_manager.lock().map_err(|e| e.to_string())?;
    manager.kill(&session_id)
}

// === File System Commands ===

#[tauri::command]
fn read_dir(path: String) -> Result<Vec<fs::FileEntry>, String> {
    fs::read_dir_entries(&path)
}

#[tauri::command]
fn create_file(path: String) -> Result<(), String> {
    fs::create_file_entry(&path)
}

#[tauri::command]
fn create_dir(path: String) -> Result<(), String> {
    fs::create_dir_entry(&path)
}

#[tauri::command]
fn rename_entry(old_path: String, new_path: String) -> Result<(), String> {
    fs::rename_entry(&old_path, &new_path)
}

#[tauri::command]
fn move_entries(sources: Vec<String>, dest_dir: String) -> Result<(), String> {
    fs::move_entries(sources, dest_dir)
}

#[tauri::command]
fn delete_entries(paths: Vec<String>) -> Result<(), String> {
    fs::delete_entries(paths)
}

#[tauri::command]
fn get_home_dir() -> Result<String, String> {
    fs::get_home_directory()
}

#[tauri::command]
fn list_drives() -> Result<Vec<fs::FileEntry>, String> {
    fs::list_drives()
}

#[tauri::command]
fn get_os_platform() -> String {
    fs::get_os_platform()
}

#[tauri::command]
fn read_file_preview(path: String) -> Result<fs::FilePreviewData, String> {
    fs::read_file_preview(&path)
}

// === Settings Commands ===

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let s = state.settings.lock().map_err(|e| e.to_string())?;
    Ok(s.clone())
}

#[tauri::command]
fn save_settings(state: State<'_, AppState>, settings: AppSettings) -> Result<(), String> {
    settings::save_settings(settings.clone())?;
    let mut s = state.settings.lock().map_err(|e| e.to_string())?;
    *s = settings;
    Ok(())
}

// === Command Config Commands ===

#[tauri::command]
fn save_terminal_state(sessions: Vec<settings::TerminalSession>) -> Result<(), String> {
    settings::save_terminal_state(sessions)
}

#[tauri::command]
fn load_terminal_state() -> Result<Vec<settings::TerminalSession>, String> {
    settings::load_terminal_state()
}

#[tauri::command]
fn load_command_history() -> Result<Vec<settings::CommandHistoryEntry>, String> {
    settings::load_command_history()
}

#[tauri::command]
fn save_command_history(entries: Vec<settings::CommandHistoryEntry>) -> Result<(), String> {
    settings::save_command_history(entries)
}

#[tauri::command]
fn record_command_history(entry: settings::CommandHistoryEntry) -> Result<Vec<settings::CommandHistoryEntry>, String> {
    settings::record_command_history(entry)
}

#[tauri::command]
fn load_command_mappings() -> Result<Vec<settings::CommandMapping>, String> {
    settings::load_command_mappings()
}

#[tauri::command]
fn save_command_mappings(entries: Vec<settings::CommandMapping>) -> Result<(), String> {
    settings::save_command_mappings(entries)
}

#[tauri::command]
fn load_ssh_profiles() -> Result<Vec<settings::SSHProfile>, String> {
    settings::load_ssh_profiles()
}

#[tauri::command]
fn save_ssh_profiles(entries: Vec<settings::SSHProfile>) -> Result<(), String> {
    settings::save_ssh_profiles(entries)
}

#[tauri::command]
fn get_platform() -> String {
    commands::get_platform()
}

#[tauri::command]
fn get_platforms() -> Vec<String> {
    commands::get_platforms()
}

#[tauri::command]
fn load_commands() -> Result<Vec<commands::CommandConfig>, String> {
    commands::load_command_configs()
}

#[tauri::command]
fn save_commands(config: commands::CommandConfig) -> Result<(), String> {
    commands::save_command_config(config)
}

#[tauri::command]
fn load_quick_commands() -> Result<Vec<commands::CommandEntry>, String> {
    commands::load_quick_commands()
}

#[tauri::command]
fn save_quick_commands(commands: Vec<commands::CommandEntry>) -> Result<(), String> {
    commands::save_quick_commands(commands)
}

#[tauri::command]
fn list_available_custom_templates() -> Result<Vec<commands::CommandConfig>, String> {
    commands::list_available_custom_templates()
}

#[tauri::command]
fn get_installed_custom_ids() -> Result<Vec<String>, String> {
    commands::get_installed_custom_ids()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let loaded_settings = settings::load_settings().unwrap_or_default();

    // Initialize default command configs (new directory structure)
    if let Err(e) = commands::init_default_commands() {
        eprintln!("Warning: Failed to init command configs: {}", e);
    }

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    #[cfg(debug_assertions)]
    let builder = builder.plugin(tauri_plugin_mcp_bridge::init());

    builder
        .manage(AppState {
            pty_manager: Mutex::new(PtyManager::new()),
            settings: Mutex::new(loaded_settings),
        })
        .invoke_handler(tauri::generate_handler![
            create_pty,
            write_pty,
            resize_pty,
            kill_pty,
            read_dir,
            create_file,
            create_dir,
            rename_entry,
            move_entries,
            delete_entries,
            get_home_dir,
            list_drives,
            get_os_platform,
            read_file_preview,
            get_settings,
            save_settings,
            save_terminal_state,
            load_terminal_state,
            load_command_history,
            save_command_history,
            record_command_history,
            load_command_mappings,
            save_command_mappings,
            load_ssh_profiles,
            save_ssh_profiles,
            get_platform,
            get_platforms,
            load_commands,
            save_commands,
            load_quick_commands,
            save_quick_commands,
            list_available_custom_templates,
            get_installed_custom_ids,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
