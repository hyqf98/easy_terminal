mod commands;
mod content_search;
mod db;
mod disks;
mod file_index;
mod fs;
mod path_util;
mod performance;
mod pty;
mod settings;
mod shell_setup;
mod ssh;
mod vpn;

use pty::PtyManager;
use serde::Deserialize;
use settings::AppSettings;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use sysinfo::System;
use tauri::ipc::Channel;
use tauri::webview::{Color, PageLoadEvent};
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

struct AppState {
    pty_manager: Mutex<PtyManager>,
    settings: Mutex<AppSettings>,
    command_db: db::Db,
    desktop_draw_shortcut: Mutex<Option<String>>,
    search_cancellations: Mutex<HashMap<String, Arc<AtomicBool>>>,
    performance_system: Mutex<System>,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FileSearchStreamEvent {
    search_id: String,
    kind: String,
    results: Vec<file_index::FileSearchResult>,
    limited: bool,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ContentSearchStreamEvent {
    search_id: String,
    kind: String,
    results: Vec<content_search::ContentSearchResult>,
    limited: bool,
}

fn start_search(state: &AppState, search_id: &str) -> Arc<AtomicBool> {
    let cancellation = Arc::new(AtomicBool::new(false));
    if let Ok(mut searches) = state.search_cancellations.lock() {
        if let Some(previous) = searches.insert(search_id.to_string(), cancellation.clone()) {
            previous.store(true, Ordering::Relaxed);
        }
    }
    cancellation
}

fn finish_search(state: &AppState, search_id: &str, cancellation: &Arc<AtomicBool>) {
    if let Ok(mut searches) = state.search_cancellations.lock() {
        if searches
            .get(search_id)
            .is_some_and(|current| Arc::ptr_eq(current, cancellation))
        {
            searches.remove(search_id);
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DetachedTerminalBounds {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

fn desktop_draw_monitor(app_handle: &tauri::AppHandle) -> Result<tauri::Monitor, String> {
    let cursor = app_handle.cursor_position().map_err(|e| e.to_string())?;
    app_handle
        .monitor_from_point(cursor.x, cursor.y)
        .map_err(|e| e.to_string())?
        .or(app_handle.primary_monitor().map_err(|e| e.to_string())?)
        .ok_or_else(|| "未找到可用显示器".to_string())
}

fn desktop_draw_url() -> WebviewUrl {
    WebviewUrl::App("index.html?mode=desktop-draw".into())
}

fn detached_terminal_url() -> WebviewUrl {
    WebviewUrl::App("index.html?mode=detached-terminal".into())
}

fn minimize_main_window(app_handle: &tauri::AppHandle) {
    if let Some(main) = app_handle.get_webview_window("main") {
        let _ = main.minimize();
    }
}

fn normalize_global_shortcut(shortcut: &str) -> Vec<String> {
    if shortcut.trim().is_empty() {
        return Vec::new();
    }

    let mut uses_cmd_modifier = false;
    let normalized_parts = shortcut
        .split('+')
        .map(|part| part.trim())
        .filter(|part| !part.is_empty())
        .map(|part| {
            let lower = part.to_ascii_lowercase();
            match lower.as_str() {
                "cmd" | "meta" | "command" => {
                    uses_cmd_modifier = true;
                    "CmdOrControl".to_string()
                }
                "ctrl" | "control" => "Ctrl".to_string(),
                "alt" | "option" => "Alt".to_string(),
                "shift" => "Shift".to_string(),
                "space" => "Space".to_string(),
                "left" | "arrowleft" => "Left".to_string(),
                "right" | "arrowright" => "Right".to_string(),
                "up" | "arrowup" => "Up".to_string(),
                "down" | "arrowdown" => "Down".to_string(),
                "enter" | "return" => "Enter".to_string(),
                _ if part.len() == 1 => part.to_ascii_uppercase(),
                _ => part.to_string(),
            }
        })
        .collect::<Vec<_>>();

    let mut candidates = vec![normalized_parts.clone()];
    if uses_cmd_modifier {
        candidates.push(
            normalized_parts
                .iter()
                .map(|part| {
                    if part == "CmdOrControl" {
                        "CommandOrControl".to_string()
                    } else {
                        part.clone()
                    }
                })
                .collect(),
        );
    }

    let mut unique = Vec::new();
    for candidate in candidates {
        let joined = candidate.join("+");
        if !joined.is_empty() && !unique.iter().any(|item| item == &joined) {
            unique.push(joined);
        }
    }
    unique
}

fn current_platform_shortcut(binding: &settings::ShortcutBinding) -> String {
    if cfg!(windows) {
        binding.windows.clone()
    } else if cfg!(target_os = "macos") {
        binding.darwin.clone()
    } else {
        binding.linux.clone()
    }
}

fn load_desktop_draw_shortcut() -> String {
    settings::load_shortcuts()
        .unwrap_or_else(|_| settings::default_shortcuts_public())
        .into_iter()
        .find(|binding| binding.id == "desktop.drawTerminal")
        .map(|binding| current_platform_shortcut(&binding))
        .unwrap_or_default()
}

fn sync_desktop_draw_shortcut_inner(
    app_handle: &tauri::AppHandle,
    requested_shortcuts: Vec<String>,
) -> Result<Option<String>, String> {
    let previous = {
        let state = app_handle.state::<AppState>();
        let mut active = state
            .desktop_draw_shortcut
            .lock()
            .map_err(|e| e.to_string())?;
        active.take()
    };

    if let Some(shortcut) = previous {
        if let Err(error) = app_handle.global_shortcut().unregister(shortcut.as_str()) {
            eprintln!("desktop draw shortcut unregister failed for {shortcut}: {error}");
        }
    }

    if requested_shortcuts.is_empty() {
        return Ok(None);
    }

    for candidate in requested_shortcuts {
        match app_handle.global_shortcut().on_shortcut(
            candidate.as_str(),
            |app, _shortcut, event| {
                if event.state != ShortcutState::Pressed {
                    return;
                }

                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = open_desktop_draw_window(app_handle).await {
                        eprintln!("open desktop draw window failed: {error}");
                    }
                });
            },
        ) {
            Ok(()) => {
                let state = app_handle.state::<AppState>();
                let mut active = state
                    .desktop_draw_shortcut
                    .lock()
                    .map_err(|e| e.to_string())?;
                *active = Some(candidate.clone());
                return Ok(Some(candidate));
            }
            Err(error) => {
                eprintln!("desktop draw shortcut register failed for {candidate}: {error}");
            }
        }
    }

    Ok(None)
}

#[tauri::command]
async fn open_desktop_draw_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    let monitor = desktop_draw_monitor(&app_handle)?;
    let scale = monitor.scale_factor();
    let logical_position = monitor.position().to_logical::<f64>(scale);
    let logical_size = monitor.size().to_logical::<f64>(scale);

    if let Some(window) = app_handle.get_webview_window("desktop-draw") {
        window
            .set_position(tauri::Position::Logical(logical_position))
            .map_err(|e| e.to_string())?;
        window
            .set_size(tauri::Size::Logical(logical_size))
            .map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        minimize_main_window(&app_handle);
        return Ok(());
    }

    WebviewWindowBuilder::new(&app_handle, "desktop-draw", desktop_draw_url())
        .title("Easy Terminal Draw")
        .position(logical_position.x, logical_position.y)
        .inner_size(logical_size.width, logical_size.height)
        .background_color(Color(0, 0, 0, 0))
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .resizable(false)
        .visible(false)
        .focused(false)
        .on_page_load(|window, payload| {
            if payload.event() != PageLoadEvent::Finished {
                return;
            }

            let _ = window.show();
            let _ = window.set_focus();
            minimize_main_window(&window.app_handle());
        })
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn show_desktop_draw_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app_handle.get_webview_window("desktop-draw") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn sync_desktop_draw_shortcut(
    app_handle: tauri::AppHandle,
    shortcut: String,
) -> Result<Option<String>, String> {
    sync_desktop_draw_shortcut_inner(&app_handle, normalize_global_shortcut(&shortcut))
}

#[tauri::command]
async fn create_detached_terminal_window(
    window: tauri::WebviewWindow,
    bounds: DetachedTerminalBounds,
) -> Result<String, String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let origin = window
        .outer_position()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(scale);

    let x = origin.x + bounds.x.max(0.0);
    let y = origin.y + bounds.y.max(0.0);
    let w = bounds.w.max(320.0);
    let h = bounds.h.max(220.0);
    let label = format!("free-terminal-{}", uuid::Uuid::new_v4().simple());

    WebviewWindowBuilder::new(window.app_handle(), &label, detached_terminal_url())
        .title("Easy Terminal")
        .position(x, y)
        .inner_size(w, h)
        .decorations(false)
        .transparent(false)
        .shadow(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .resizable(true)
        .focused(true)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(label)
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
    // 在 Unix 上自动确保语法高亮和自动建议插件已安装（幂等，已安装则仅做文件存在检查）。
    // 在锁定 PTY 互斥锁之前执行，避免阻塞其他终端的读写操作。
    // 安装失败不阻塞终端创建 —— .zshrc 会在运行时检测插件是否存在，缺失则跳过 source。
    if !cfg!(target_os = "windows") {
        let _ = shell_setup::ensure_zsh_syntax_highlighting();
        let _ = shell_setup::ensure_zsh_autosuggestions();
    }

    let mut manager = state.pty_manager.lock().map_err(|e| e.to_string())?;
    manager.create(app_handle, cols, rows, cwd)
}

#[tauri::command]
fn write_pty(state: State<'_, AppState>, session_id: String, data: String) -> Result<(), String> {
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
fn kill_pty(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    let mut manager = state.pty_manager.lock().map_err(|e| e.to_string())?;
    manager.kill(&session_id)
}

// === Shell Setup Commands ===

#[tauri::command]
fn check_shell_setup() -> shell_setup::ShellSetupStatus {
    shell_setup::check_setup_status()
}

#[tauri::command]
fn run_shell_setup() -> shell_setup::SetupResult {
    shell_setup::run_setup()
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
fn write_text_file(path: String, content: String) -> Result<(), String> {
    fs::write_text_file(&path, &content)
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
fn get_quick_access_locations() -> Result<Vec<fs::QuickAccessLocation>, String> {
    fs::get_quick_access_locations()
}

#[tauri::command]
fn open_system_trash() -> Result<(), String> {
    fs::open_system_trash()
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

// === File Manager Commands ===

#[tauri::command]
fn copy_entries(sources: Vec<String>, dest_dir: String) -> Result<(), String> {
    fs::copy_entries(sources, dest_dir)
}

#[tauri::command]
fn trash_entries(paths: Vec<String>) -> Result<(), String> {
    fs::trash_entries(paths)
}

#[tauri::command]
fn open_with_default_app(path: String) -> Result<(), String> {
    fs::open_with_default_app(&path)
}

#[tauri::command]
fn reveal_in_file_manager(path: String) -> Result<(), String> {
    fs::reveal_in_file_manager(&path)
}

#[tauri::command]
async fn search_files(
    query: String,
    limit: Option<i64>,
) -> Result<Vec<file_index::FileSearchResult>, String> {
    tauri::async_runtime::spawn_blocking(move || file_index::search(&query, limit.unwrap_or(200)))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
fn get_index_status() -> file_index::IndexStatus {
    file_index::get_status()
}

#[tauri::command]
fn rebuild_index() {
    file_index::rebuild()
}

#[tauri::command]
fn get_index_config() -> Result<file_index::IndexConfig, String> {
    file_index::load_index_config()
}

#[tauri::command]
fn save_index_config(config: file_index::IndexConfig) -> Result<(), String> {
    file_index::save_index_config(&config)?;
    // 保存后触发重建索引，使用指定配置而非默认读取
    file_index::start_background_scan(move |_, _, _| {}, Some(config));
    Ok(())
}

#[tauri::command]
async fn search_content(
    query: String,
    root: String,
    limit: Option<usize>,
    max_matches_per_file: Option<usize>,
) -> Result<Vec<content_search::ContentSearchResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        content_search::search_content(
            &query,
            &root,
            limit.unwrap_or(200),
            max_matches_per_file.unwrap_or(5),
        )
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
fn cancel_file_search(search_id: String, state: State<'_, AppState>) {
    if let Ok(searches) = state.search_cancellations.lock() {
        if let Some(cancellation) = searches.get(&search_id) {
            cancellation.store(true, Ordering::Relaxed);
        }
    }
}

#[tauri::command]
async fn search_files_stream(
    query: String,
    search_id: String,
    limit: Option<i64>,
    on_event: Channel<FileSearchStreamEvent>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let cancellation = start_search(&state, &search_id);
    let batch_size = 1;
    let capped_limit = limit.unwrap_or(200).clamp(1, 200);
    let fetch_limit = capped_limit.saturating_add(1);
    let stream_search_id = search_id.clone();
    let cancellation_for_task = cancellation.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let cancellation_for_query = cancellation_for_task.clone();
        let channel_for_result = on_event.clone();
        let stream_id_for_result = stream_search_id.clone();
        let mut batch = Vec::with_capacity(batch_size);
        let mut emitted_results = 0usize;
        let mut limited = false;
        let mut send_error = None;
        file_index::search_with_callback(
            &query,
            fetch_limit,
            || cancellation_for_query.load(Ordering::Relaxed),
            |result| {
                if emitted_results >= capped_limit as usize {
                    limited = true;
                    return;
                }
                batch.push(result);
                emitted_results += 1;
                if batch.len() < batch_size {
                    return;
                }
                if let Err(error) = channel_for_result.send(FileSearchStreamEvent {
                    search_id: stream_id_for_result.clone(),
                    kind: "batch".to_string(),
                    results: std::mem::take(&mut batch),
                    limited: false,
                }) {
                    send_error = Some(error.to_string());
                }
            },
        )?;
        if let Some(error) = send_error {
            return Err(error);
        }
        if cancellation_for_task.load(Ordering::Relaxed) {
            let _ = on_event.send(FileSearchStreamEvent {
                search_id: stream_search_id,
                kind: "cancelled".to_string(),
                results: Vec::new(),
                limited: false,
            });
            return Ok(());
        }
        if !batch.is_empty() {
            on_event
                .send(FileSearchStreamEvent {
                    search_id: stream_search_id.clone(),
                    kind: "batch".to_string(),
                    results: batch,
                    limited: false,
                })
                .map_err(|error| error.to_string())?;
        }
        on_event
            .send(FileSearchStreamEvent {
                search_id: stream_search_id,
                kind: "completed".to_string(),
                results: Vec::new(),
                limited,
            })
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("Task join error: {error}"))?;
    finish_search(&state, &search_id, &cancellation);
    result
}

#[tauri::command]
async fn search_content_stream(
    query: String,
    root: String,
    search_id: String,
    limit: Option<usize>,
    max_matches_per_file: Option<usize>,
    on_event: Channel<ContentSearchStreamEvent>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let cancellation = start_search(&state, &search_id);
    let capped_limit = limit.unwrap_or(200).clamp(1, 200);
    let fetch_limit = capped_limit.saturating_add(1);
    let max_matches = max_matches_per_file.unwrap_or(5).clamp(1, 20);
    let stream_search_id = search_id.clone();
    let cancellation_for_task = cancellation.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let cancellation_for_walk = cancellation_for_task.clone();
        let stream_id_for_result = stream_search_id.clone();
        let channel_for_result = on_event.clone();
        let mut send_error = None;
        let mut emitted_results = 0usize;
        let mut limited = false;
        content_search::search_content_with_callback(
            &query,
            &root,
            fetch_limit,
            max_matches,
            &mut || cancellation_for_walk.load(Ordering::Relaxed),
            |result| {
                if emitted_results >= capped_limit {
                    limited = true;
                    return;
                }
                emitted_results += 1;
                if let Err(error) = channel_for_result.send(ContentSearchStreamEvent {
                    search_id: stream_id_for_result.clone(),
                    kind: "batch".to_string(),
                    results: vec![result],
                    limited: false,
                }) {
                    send_error = Some(error.to_string());
                }
            },
        )?;
        if let Some(error) = send_error {
            return Err(error);
        }
        if cancellation_for_task.load(Ordering::Relaxed) {
            let _ = on_event.send(ContentSearchStreamEvent {
                search_id: stream_search_id,
                kind: "cancelled".to_string(),
                results: Vec::new(),
                limited: false,
            });
            return Ok(());
        }

        on_event
            .send(ContentSearchStreamEvent {
                search_id: stream_search_id,
                kind: "completed".to_string(),
                results: Vec::new(),
                limited,
            })
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("Task join error: {error}"))?;
    finish_search(&state, &search_id, &cancellation);
    result
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FolderSizeStreamEvent {
    request_id: String,
    kind: String, // "size" | "completed" | "cancelled"
    path: String,
    size: u64,
}

/// 流式计算多个文件夹的递归总大小。
///
/// 对 `paths` 中的每个目录调用 `fs::dir_size_parallel`（jwalk 并行遍历），
/// 每算完一个立即通过 `on_event` 推送 `{ kind: "size", path, size }`，
/// 前端可渐进式填充列表。切换目录时前端取消上一个请求即可中止未完成的计算。
#[tauri::command]
async fn compute_folder_sizes_stream(
    paths: Vec<String>,
    request_id: String,
    on_event: Channel<FolderSizeStreamEvent>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let cancellation = start_search(&state, &request_id);
    let stream_request_id = request_id.clone();
    let cancellation_for_task = cancellation.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        for path_str in &paths {
            if cancellation_for_task.load(Ordering::Relaxed) {
                break;
            }
            let path = std::path::Path::new(path_str);
            let size = fs::dir_size_parallel(path, &|| {
                cancellation_for_task.load(Ordering::Relaxed)
            });
            if cancellation_for_task.load(Ordering::Relaxed) {
                break;
            }
            on_event
                .send(FolderSizeStreamEvent {
                    request_id: stream_request_id.clone(),
                    kind: "size".to_string(),
                    path: path_str.clone(),
                    size,
                })
                .map_err(|error| error.to_string())?;
        }
        if cancellation_for_task.load(Ordering::Relaxed) {
            let _ = on_event.send(FolderSizeStreamEvent {
                request_id: stream_request_id,
                kind: "cancelled".to_string(),
                path: String::new(),
                size: 0,
            });
            return Ok(());
        }
        on_event
            .send(FolderSizeStreamEvent {
                request_id: stream_request_id,
                kind: "completed".to_string(),
                path: String::new(),
                size: 0,
            })
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("Task join error: {error}"))?;
    finish_search(&state, &request_id, &cancellation);
    result
}

#[derive(serde::Serialize)]
struct BundledLibraryInfo {
    name: String,
    directory: String,
}

#[tauri::command]
fn list_bundled_command_libraries() -> Vec<BundledLibraryInfo> {
    db::bundled_seeds()
        .into_iter()
        .map(|(name, directory, _, _)| BundledLibraryInfo {
            name: name.to_string(),
            directory: directory.to_string(),
        })
        .collect()
}

#[tauri::command]
fn read_bundled_command_file(name: String) -> Result<String, String> {
    db::bundled_seeds()
        .into_iter()
        .find(|(n, _, _, _)| *n == name)
        .map(|(_, _, _, json)| json.to_string())
        .ok_or_else(|| format!("bundled library not found: {}", name))
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
fn save_workspace_state(state: settings::WorkspaceState) -> Result<(), String> {
    settings::save_workspace_state(state)
}

#[tauri::command]
fn load_workspace_state() -> Result<settings::WorkspaceState, String> {
    settings::load_workspace_state()
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
fn record_command_history(
    entry: settings::CommandHistoryEntry,
) -> Result<Vec<settings::CommandHistoryEntry>, String> {
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

/// 加载持久化的 VPN 配置列表。
#[tauri::command]
fn load_vpn_profiles() -> Result<Vec<settings::VpnProfile>, String> {
    settings::load_vpn_profiles()
}

/// 持久化 VPN 配置列表到本地存储。
#[tauri::command]
fn save_vpn_profiles(entries: Vec<settings::VpnProfile>) -> Result<(), String> {
    settings::save_vpn_profiles(entries)
}

#[tauri::command]
async fn test_ssh_connection(
    host: String,
    port: u16,
    user: String,
    auth_type: String,
    password: String,
    private_key_path: String,
    jump_profile_id: String,
    profiles: Vec<settings::SSHProfile>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ssh::test_connection(
            host,
            port,
            user,
            auth_type,
            password,
            private_key_path,
            jump_profile_id,
            profiles,
        )
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
fn get_local_performance_snapshot(
    state: State<'_, AppState>,
) -> Result<performance::PerformanceSnapshot, String> {
    let mut system = state.performance_system.lock().map_err(|e| e.to_string())?;
    Ok(performance::local_snapshot(&mut system))
}

#[tauri::command]
fn stop_local_port_process(pid: u32) -> Result<(), String> {
    performance::stop_local_port_process(pid)
}

#[tauri::command]
async fn get_remote_performance_snapshot(
    profile: settings::SSHProfile,
    profiles: Vec<settings::SSHProfile>,
) -> Result<performance::PerformanceSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || ssh::get_performance_snapshot(profile, profiles))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
async fn stop_remote_port_process(
    profile: settings::SSHProfile,
    profiles: Vec<settings::SSHProfile>,
    pid: u32,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || ssh::stop_port_process(profile, profiles, pid))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
async fn get_remote_home(
    profile: settings::SSHProfile,
    profiles: Vec<settings::SSHProfile>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || ssh::get_remote_home(profile, profiles))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
async fn read_remote_dir(
    profile: settings::SSHProfile,
    path: String,
    profiles: Vec<settings::SSHProfile>,
) -> Result<Vec<fs::FileEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || ssh::read_remote_dir(profile, path, profiles))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
async fn read_remote_dir_page(
    profile: settings::SSHProfile,
    path: String,
    cursor: Option<ssh::RemoteDirectoryCursor>,
    limit: Option<usize>,
    name_filter: Option<String>,
    profiles: Vec<settings::SSHProfile>,
) -> Result<ssh::RemoteDirectoryPage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ssh::read_remote_dir_page(profile, path, cursor, limit, name_filter, profiles)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
async fn download_remote_entries(
    app_handle: tauri::AppHandle,
    profile: settings::SSHProfile,
    remote_paths: Vec<String>,
    local_dir: String,
    conflict_policy: Option<String>,
    profiles: Vec<settings::SSHProfile>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        ssh::download_remote_entries(app_handle, profile, remote_paths, local_dir, conflict_policy, profiles)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
async fn upload_local_entries(
    app_handle: tauri::AppHandle,
    profile: settings::SSHProfile,
    local_paths: Vec<String>,
    remote_dir: String,
    conflict_policy: Option<String>,
    profiles: Vec<settings::SSHProfile>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        ssh::upload_local_entries(app_handle, profile, local_paths, remote_dir, conflict_policy, profiles)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
async fn rename_remote_entry(
    profile: settings::SSHProfile,
    old_path: String,
    new_path: String,
    profiles: Vec<settings::SSHProfile>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        ssh::rename_remote_entry(profile, old_path, new_path, profiles)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
async fn move_remote_entries(
    profile: settings::SSHProfile,
    sources: Vec<String>,
    dest_dir: String,
    profiles: Vec<settings::SSHProfile>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        ssh::move_remote_entries(profile, sources, dest_dir, profiles)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
async fn delete_remote_entries(
    profile: settings::SSHProfile,
    paths: Vec<String>,
    profiles: Vec<settings::SSHProfile>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        ssh::delete_remote_entries(profile, paths, profiles)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
async fn read_remote_file(
    profile: settings::SSHProfile,
    path: String,
    profiles: Vec<settings::SSHProfile>,
) -> Result<fs::FilePreviewData, String> {
    tauri::async_runtime::spawn_blocking(move || ssh::read_remote_file(profile, path, profiles))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
async fn read_remote_file_preview(
    profile: settings::SSHProfile,
    path: String,
    profiles: Vec<settings::SSHProfile>,
) -> Result<fs::FilePreviewData, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ssh::read_remote_file_preview(profile, path, profiles)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
async fn write_remote_file(
    profile: settings::SSHProfile,
    path: String,
    content: String,
    profiles: Vec<settings::SSHProfile>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        ssh::write_remote_file(profile, path, content, profiles)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
fn load_shortcuts() -> Result<Vec<settings::ShortcutBinding>, String> {
    settings::load_shortcuts()
}

#[tauri::command]
fn save_shortcuts(entries: Vec<settings::ShortcutBinding>) -> Result<(), String> {
    settings::save_shortcuts(entries)
}

#[tauri::command]
fn load_default_shortcuts() -> Vec<settings::ShortcutBinding> {
    settings::default_shortcuts_public()
}

#[tauri::command]
async fn prepare_ssh_key(private_key_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || ssh::prepare_ssh_key(private_key_path))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
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
fn list_command_libraries(
    state: State<'_, AppState>,
) -> Result<Vec<db::CommandLibrarySummary>, String> {
    state.command_db.list_command_libraries()
}

#[tauri::command]
fn create_command_library(
    state: State<'_, AppState>,
    payload: db::CommandLibraryPayload,
) -> Result<db::CommandLibrarySummary, String> {
    state.command_db.create_command_library(payload)
}

#[tauri::command]
fn update_command_library(
    state: State<'_, AppState>,
    payload: db::CommandLibraryPayload,
) -> Result<db::CommandLibrarySummary, String> {
    state.command_db.update_command_library(payload)
}

#[tauri::command]
fn delete_command_library(state: State<'_, AppState>, library_id: String) -> Result<(), String> {
    state.command_db.delete_command_library(&library_id)
}

#[tauri::command]
fn query_command_summaries(
    state: State<'_, AppState>,
    params: db::CommandQueryParams,
) -> Result<db::CommandSummaryPage, String> {
    state.command_db.query_command_summaries(params)
}

#[tauri::command]
fn search_command_summaries(
    state: State<'_, AppState>,
    params: db::CommandSearchParams,
) -> Result<Vec<db::CommandSummary>, String> {
    state.command_db.search_command_summaries(params)
}

#[tauri::command]
fn get_command_detail(
    state: State<'_, AppState>,
    id: i64,
) -> Result<Option<db::CommandDetail>, String> {
    state.command_db.get_command_detail(id)
}

#[tauri::command]
fn create_command(
    state: State<'_, AppState>,
    payload: db::CommandPayload,
) -> Result<db::CommandDetail, String> {
    state.command_db.create_command(payload)
}

#[tauri::command]
fn update_command(
    state: State<'_, AppState>,
    payload: db::CommandPayload,
) -> Result<db::CommandDetail, String> {
    state.command_db.update_command(payload)
}

#[tauri::command]
fn delete_command_entry(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    state.command_db.delete_command(id)
}

#[tauri::command]
fn import_command_library(
    state: State<'_, AppState>,
    json: String,
) -> Result<db::CommandLibrarySummary, String> {
    state.command_db.import_command_library(&json)
}

#[tauri::command]
fn export_command_library(
    state: State<'_, AppState>,
    library_id: String,
) -> Result<String, String> {
    state.command_db.export_command_library(&library_id)
}

#[tauri::command]
fn reset_builtin_library(
    state: State<'_, AppState>,
    library_id: String,
) -> Result<db::CommandLibrarySummary, String> {
    state.command_db.reset_builtin_library(&library_id)
}

#[tauri::command]
fn list_terminal_favorites(
    state: State<'_, AppState>,
    ssh_profile_id: String,
) -> Result<Vec<db::TerminalFavoriteRecord>, String> {
    state.command_db.list_favorites(&ssh_profile_id)
}

#[tauri::command]
fn add_terminal_favorite(
    state: State<'_, AppState>,
    ssh_profile_id: String,
    path: String,
    name: String,
    icon: String,
    color: String,
) -> Result<i64, String> {
    state
        .command_db
        .add_favorite(&ssh_profile_id, &path, &name, &icon, &color)
}

#[tauri::command]
fn remove_terminal_favorite(
    state: State<'_, AppState>,
    ssh_profile_id: String,
    path: String,
) -> Result<(), String> {
    state.command_db.remove_favorite(&ssh_profile_id, &path)
}

#[tauri::command]
fn update_terminal_favorite(
    state: State<'_, AppState>,
    id: i64,
    name: String,
    icon: String,
    color: String,
) -> Result<(), String> {
    state.command_db.update_favorite(id, &name, &icon, &color)
}

#[tauri::command]
fn reorder_terminal_favorites(
    state: State<'_, AppState>,
    ssh_profile_id: String,
    ordered_ids: Vec<i64>,
) -> Result<(), String> {
    state
        .command_db
        .reorder_favorites(&ssh_profile_id, &ordered_ids)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let loaded_settings = settings::load_settings().unwrap_or_default();
    let command_db = db::Db::new().expect("failed to initialize command database");

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build());

    #[cfg(debug_assertions)]
    let builder = builder.plugin(tauri_plugin_mcp_bridge::init());

    builder
        .manage(AppState {
            pty_manager: Mutex::new(PtyManager::new()),
            settings: Mutex::new(loaded_settings),
            command_db,
            desktop_draw_shortcut: Mutex::new(None),
            search_cancellations: Mutex::new(HashMap::new()),
            performance_system: Mutex::new(System::new_all()),
        })
        .setup(|app| {
            let shortcut = load_desktop_draw_shortcut();
            let registered = sync_desktop_draw_shortcut_inner(
                app.handle(),
                normalize_global_shortcut(&shortcut),
            )?;
            if !shortcut.trim().is_empty() && registered.is_none() {
                eprintln!("failed to register desktop draw shortcut on startup: {shortcut}");
            }

            // 启动文件索引后台扫描
            let app_handle = app.handle().clone();
            file_index::start_background_scan(
                move |count, estimated, current_path| {
                    use tauri::Emitter;
                    let progress = if estimated > 0 {
                        ((count as f64 / estimated as f64) * 100.0).min(99.0) as u8
                    } else {
                        0
                    };
                    let _ = app_handle.emit(
                        "index-progress",
                        serde_json::json!({
                            "totalFiles": count,
                            "estimatedTotal": estimated,
                            "currentPath": current_path,
                            "progress": progress,
                        }),
                    );
                },
                None,
            );

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_pty,
            write_pty,
            resize_pty,
            kill_pty,
            check_shell_setup,
            run_shell_setup,
            read_dir,
            create_file,
            create_dir,
            write_text_file,
            rename_entry,
            move_entries,
            delete_entries,
            get_home_dir,
            get_quick_access_locations,
            open_system_trash,
            list_drives,
            disks::list_disks,
            get_os_platform,
            read_file_preview,
            // File Manager
            copy_entries,
            trash_entries,
            open_with_default_app,
            reveal_in_file_manager,
            search_files,
            get_index_status,
            rebuild_index,
            get_index_config,
            save_index_config,
            search_content,
            search_files_stream,
            search_content_stream,
            compute_folder_sizes_stream,
            cancel_file_search,
            get_settings,
            save_settings,
            save_terminal_state,
            load_terminal_state,
            save_workspace_state,
            load_workspace_state,
            load_command_history,
            save_command_history,
            record_command_history,
            load_command_mappings,
            save_command_mappings,
            load_ssh_profiles,
            save_ssh_profiles,
            load_vpn_profiles,
            save_vpn_profiles,
            vpn::vpn_connect,
            vpn::vpn_disconnect,
            vpn::vpn_get_status,
            vpn::vpn_test_connection,
            test_ssh_connection,
            get_local_performance_snapshot,
            stop_local_port_process,
            get_remote_performance_snapshot,
            stop_remote_port_process,
            prepare_ssh_key,
            get_remote_home,
            read_remote_dir,
            read_remote_dir_page,
            download_remote_entries,
            upload_local_entries,
            rename_remote_entry,
            move_remote_entries,
            delete_remote_entries,
            read_remote_file,
            read_remote_file_preview,
            write_remote_file,
            load_shortcuts,
            save_shortcuts,
            load_default_shortcuts,
            get_platform,
            get_platforms,
            list_command_libraries,
            create_command_library,
            update_command_library,
            delete_command_library,
            query_command_summaries,
            search_command_summaries,
            get_command_detail,
            create_command,
            update_command,
            delete_command_entry,
            import_command_library,
            export_command_library,
            reset_builtin_library,
            list_bundled_command_libraries,
            read_bundled_command_file,
            list_terminal_favorites,
            add_terminal_favorite,
            remove_terminal_favorite,
            update_terminal_favorite,
            reorder_terminal_favorites,
            open_desktop_draw_window,
            sync_desktop_draw_shortcut,
            show_desktop_draw_window,
            create_detached_terminal_window,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            // 应用退出时：杀掉所有 openvpn 子进程，清理路由表，不留残余
            if let tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit = event {
                vpn::shutdown_all_vpn();
            }
        });
}
