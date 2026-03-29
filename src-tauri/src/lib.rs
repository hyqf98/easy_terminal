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
fn get_platform() -> String {
    commands::get_platform()
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
fn import_commands(json_str: String, platform: String) -> Result<(), String> {
    let config: commands::CommandConfig = serde_json::from_str(&json_str)
        .map_err(|e| format!("JSON 格式错误: {}", e))?;
    if config.platform != platform {
        return Err("平台不匹配".to_string());
    }
    commands::save_command_config(config)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let loaded_settings = settings::load_settings().unwrap_or_default();

    // Initialize default command configs
    if let Err(e) = commands::init_default_commands() {
        eprintln!("Warning: Failed to init command configs: {}", e);
    }

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init());

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
            get_settings,
            save_settings,
            get_platform,
            load_commands,
            save_commands,
            import_commands,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
