use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub theme: String,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "default_auto_check_update")]
    pub auto_check_update: bool,
    #[serde(default = "default_restore_session")]
    pub restore_session: bool,
    #[serde(default)]
    pub last_update_check: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutBinding {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_shortcut_category")]
    pub category: String,
    #[serde(default = "default_shortcut_editable")]
    pub editable: bool,
    #[serde(default = "default_shortcut_deletable")]
    pub deletable: bool,
    #[serde(default)]
    pub windows: String,
    #[serde(default)]
    pub darwin: String,
    #[serde(default)]
    pub linux: String,
}

fn default_language() -> String {
    "zh-CN".to_string()
}

fn default_shortcut_category() -> String {
    "workspace".to_string()
}

fn default_shortcut_editable() -> bool {
    true
}

fn default_shortcut_deletable() -> bool {
    false
}

fn default_auto_check_update() -> bool {
    true
}

fn default_restore_session() -> bool {
    true
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "light".to_string(),
            language: default_language(),
            auto_check_update: default_auto_check_update(),
            restore_session: default_restore_session(),
            last_update_check: String::new(),
        }
    }
}

fn settings_path() -> Result<PathBuf, String> {
    let base = dirs::config_dir().ok_or("Cannot determine config directory")?;
    let dir = base.join("easy-terminal");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

pub fn load_settings() -> Result<AppSettings, String> {
    let path = settings_path()?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| e.to_string())
}

pub fn save_settings(settings: AppSettings) -> Result<(), String> {
    let path = settings_path()?;
    let data = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&path, data).map_err(|e| e.to_string())
}

// ===== Terminal State Persistence =====

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSession {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub cwd: String,
    #[serde(default)]
    pub minimized: bool,
    #[serde(default)]
    pub maximized: bool,
    #[serde(default)]
    pub launch_options: TerminalLaunchOptions,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct TerminalLaunchOptions {
    #[serde(default)]
    pub cwd: String,
    #[serde(default)]
    pub startup_command: String,
    #[serde(default = "default_terminal_mode", alias = "kind")]
    pub mode: String,
    #[serde(default)]
    pub profile_name: String,
    #[serde(default)]
    pub profile_id: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct CanvasStateSnapshot {
    #[serde(default)]
    pub pan_x: f64,
    #[serde(default)]
    pub pan_y: f64,
    #[serde(default = "default_canvas_zoom")]
    pub zoom: f64,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceState {
    #[serde(default)]
    pub terminals: Vec<TerminalSession>,
    #[serde(default)]
    pub canvas: CanvasStateSnapshot,
    #[serde(default, alias = "selectedSshProfileId")]
    pub pending_ssh_profile_id: String,
    #[serde(default)]
    pub active_terminal_id: String,
}

fn terminal_state_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let dir = home.join(".easy-terminal");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("terminals.json"))
}

fn app_state_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let dir = home.join(".easy-terminal");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn workspace_state_path() -> Result<PathBuf, String> {
    Ok(app_state_dir()?.join("workspace-state.json"))
}

fn default_terminal_mode() -> String {
    "local".to_string()
}

fn default_canvas_zoom() -> f64 {
    1.0
}

pub fn save_terminal_state(sessions: Vec<TerminalSession>) -> Result<(), String> {
    let path = terminal_state_path()?;
    let data = serde_json::to_string_pretty(&sessions).map_err(|e| e.to_string())?;
    fs::write(&path, data).map_err(|e| e.to_string())
}

pub fn load_terminal_state() -> Result<Vec<TerminalSession>, String> {
    Ok(load_workspace_state()?.terminals)
}

pub fn save_workspace_state(state: WorkspaceState) -> Result<(), String> {
    let path = workspace_state_path()?;
    let normalized = normalize_workspace_state(state);
    let data = serde_json::to_string_pretty(&normalized).map_err(|e| e.to_string())?;
    fs::write(&path, data).map_err(|e| e.to_string())
}

pub fn load_workspace_state() -> Result<WorkspaceState, String> {
    let path = workspace_state_path()?;
    if path.exists() {
        let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let state: WorkspaceState = serde_json::from_str(&data).map_err(|e| e.to_string())?;
        return Ok(normalize_workspace_state(state));
    }

    let legacy_path = terminal_state_path()?;
    if !legacy_path.exists() {
        return Ok(WorkspaceState::default());
    }

    let data = fs::read_to_string(&legacy_path).map_err(|e| e.to_string())?;
    let terminals: Vec<TerminalSession> = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    Ok(WorkspaceState {
        terminals: terminals
            .into_iter()
            .map(normalize_terminal_session)
            .collect(),
        ..WorkspaceState::default()
    })
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommandHistoryEntry {
    pub id: String,
    pub command: String,
    #[serde(default)]
    pub cwd: String,
    pub timestamp: i64,
    #[serde(default = "default_history_count")]
    pub count: u32,
    #[serde(default)]
    pub variants: Vec<CommandHistoryVariant>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommandHistoryVariant {
    #[serde(default)]
    pub cwd: String,
    pub timestamp: i64,
    #[serde(default = "default_history_count")]
    pub count: u32,
}

fn default_history_count() -> u32 {
    1
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommandMapping {
    pub id: String,
    pub trigger: String,
    pub command: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub examples: Vec<String>,
    #[serde(default)]
    pub hint: String,
    #[serde(default = "default_mapping_enabled")]
    pub enabled: bool,
    #[serde(default = "default_mapping_source_type")]
    pub source_type: String,
    #[serde(default)]
    pub platforms: Vec<String>,
}

fn default_mapping_enabled() -> bool {
    true
}

fn default_mapping_source_type() -> String {
    "user".to_string()
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SSHProfile {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub group: String,
    #[serde(default)]
    pub host: String,
    #[serde(default = "default_ssh_port")]
    pub port: u16,
    #[serde(default)]
    pub user: String,
    #[serde(default)]
    pub jump_profile_id: String,
    #[serde(default = "default_auth_type")]
    pub auth_type: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub private_key_path: String,
}

fn default_auth_type() -> String {
    "password".to_string()
}

fn default_ssh_port() -> u16 {
    22
}

fn history_path() -> Result<PathBuf, String> {
    Ok(app_state_dir()?.join("command-history.json"))
}

fn mappings_path() -> Result<PathBuf, String> {
    Ok(app_state_dir()?.join("command-mappings.json"))
}

fn ssh_profiles_path() -> Result<PathBuf, String> {
    Ok(app_state_dir()?.join("ssh-profiles.json"))
}

fn shortcuts_path() -> Result<PathBuf, String> {
    Ok(app_state_dir()?.join("shortcuts.json"))
}

pub fn load_command_history() -> Result<Vec<CommandHistoryEntry>, String> {
    let path = history_path()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let entries = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    Ok(normalize_history_entries(entries))
}

pub fn save_command_history(entries: Vec<CommandHistoryEntry>) -> Result<(), String> {
    let path = history_path()?;
    let normalized = normalize_history_entries(entries);
    let data = serde_json::to_string_pretty(&normalized).map_err(|e| e.to_string())?;
    fs::write(&path, data).map_err(|e| e.to_string())
}

pub fn record_command_history(
    entry: CommandHistoryEntry,
) -> Result<Vec<CommandHistoryEntry>, String> {
    let mut entries = normalize_history_entries(load_command_history()?);
    let normalized_command = normalize_history_value(&entry.command);
    let normalized_cwd = normalize_history_value(&entry.cwd);

    if let Some(existing) = entries
        .iter_mut()
        .find(|item| normalize_history_value(&item.command) == normalized_command)
    {
        existing.command = normalized_command.clone();
        existing.timestamp = entry.timestamp;
        existing.count += 1;
        existing.id = entry.id;
        merge_history_variant(existing, &normalized_cwd, entry.timestamp, 1);
        existing.cwd = pick_preferred_history_cwd(&existing.variants);
    } else {
        entries.push(CommandHistoryEntry {
            command: normalized_command,
            cwd: normalized_cwd,
            variants: vec![CommandHistoryVariant {
                cwd: normalize_history_value(&entry.cwd),
                timestamp: entry.timestamp,
                count: 1,
            }],
            ..entry
        });
    }

    entries.sort_by(|left, right| right.timestamp.cmp(&left.timestamp));
    if entries.len() > 200 {
        entries.truncate(200);
    }

    save_command_history(entries.clone())?;
    Ok(entries)
}

fn normalize_history_entries(entries: Vec<CommandHistoryEntry>) -> Vec<CommandHistoryEntry> {
    let mut merged: Vec<CommandHistoryEntry> = Vec::new();

    for mut entry in entries {
        entry.command = normalize_history_value(&entry.command);
        entry.cwd = normalize_history_value(&entry.cwd);
        entry.variants =
            normalize_history_variants(entry.variants, &entry.cwd, entry.timestamp, entry.count);

        if entry.command.is_empty() {
            continue;
        }

        if let Some(existing) = merged
            .iter_mut()
            .find(|item| normalize_history_value(&item.command) == entry.command)
        {
            existing.count += entry.count.max(1);
            if entry.timestamp >= existing.timestamp {
                existing.timestamp = entry.timestamp;
                existing.id = entry.id.clone();
            }
            for variant in &entry.variants {
                merge_history_variant(existing, &variant.cwd, variant.timestamp, variant.count);
            }
            existing.cwd = pick_preferred_history_cwd(&existing.variants);
        } else {
            entry.cwd = pick_preferred_history_cwd(&entry.variants);
            merged.push(entry);
        }
    }

    merged.sort_by(|left, right| right.timestamp.cmp(&left.timestamp));
    if merged.len() > 200 {
        merged.truncate(200);
    }
    merged
}

fn normalize_history_value(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

pub fn load_command_mappings() -> Result<Vec<CommandMapping>, String> {
    let defaults = default_command_mappings();
    let path = mappings_path()?;
    if !path.exists() {
        return Ok(filter_mappings_for_current_platform(defaults));
    }
    let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let stored: Vec<CommandMapping> = serde_json::from_str(&data).map_err(|e| e.to_string())?;

    let mut merged: HashMap<String, CommandMapping> = defaults
        .into_iter()
        .map(|mapping| (mapping.id.clone(), mapping))
        .collect();

    for mapping in stored {
        merged.insert(mapping.id.clone(), normalize_mapping(mapping));
    }

    let mut values: Vec<CommandMapping> = merged.into_values().collect();
    values.sort_by(|left, right| left.trigger.cmp(&right.trigger));
    Ok(filter_mappings_for_current_platform(values))
}

pub fn save_command_mappings(entries: Vec<CommandMapping>) -> Result<(), String> {
    let path = mappings_path()?;
    let normalized = entries
        .into_iter()
        .map(normalize_mapping)
        .collect::<Vec<_>>();
    let data = serde_json::to_string_pretty(&normalized).map_err(|e| e.to_string())?;
    fs::write(&path, data).map_err(|e| e.to_string())
}

pub fn load_ssh_profiles() -> Result<Vec<SSHProfile>, String> {
    let path = ssh_profiles_path()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| e.to_string())
}

pub fn save_ssh_profiles(entries: Vec<SSHProfile>) -> Result<(), String> {
    let path = ssh_profiles_path()?;
    let data = serde_json::to_string_pretty(&entries).map_err(|e| e.to_string())?;
    fs::write(&path, data).map_err(|e| e.to_string())
}

pub fn load_shortcuts() -> Result<Vec<ShortcutBinding>, String> {
    let path = shortcuts_path()?;
    if !path.exists() {
        return Ok(default_shortcuts());
    }
    let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let stored: Vec<ShortcutBinding> = serde_json::from_str(&data).map_err(|e| e.to_string())?;

    let defaults = default_shortcuts();
    let mut merged: HashMap<String, ShortcutBinding> = defaults
        .into_iter()
        .map(|binding| (binding.id.clone(), binding))
        .collect();

    for binding in stored {
        merged.insert(binding.id.clone(), binding);
    }

    let mut values: Vec<ShortcutBinding> = merged.into_values().collect();
    values.sort_by(|left, right| left.label.cmp(&right.label));
    Ok(values)
}

pub fn save_shortcuts(entries: Vec<ShortcutBinding>) -> Result<(), String> {
    let path = shortcuts_path()?;
    let data = serde_json::to_string_pretty(&entries).map_err(|e| e.to_string())?;
    fs::write(&path, data).map_err(|e| e.to_string())
}

pub fn default_shortcuts_public() -> Vec<ShortcutBinding> {
    default_shortcuts()
}

fn default_command_mappings() -> Vec<CommandMapping> {
    vec![
        CommandMapping {
            id: "go-home".to_string(),
            trigger: "去用户路径下".to_string(),
            command: "cd ~".to_string(),
            description: "快速回到当前用户主目录".to_string(),
            tags: vec![
                "home".to_string(),
                "用户目录".to_string(),
                "回家".to_string(),
            ],
            examples: vec!["去用户路径下".to_string(), "home".to_string()],
            hint: "回车后立即切换到当前账号主目录".to_string(),
            enabled: true,
            source_type: "builtin".to_string(),
            platforms: vec![],
        },
        CommandMapping {
            id: "open-desktop".to_string(),
            trigger: "去桌面路径下".to_string(),
            command: "cd ~/Desktop".to_string(),
            description: "开发时快速切到桌面目录".to_string(),
            tags: vec!["desktop".to_string(), "桌面".to_string()],
            examples: vec!["去桌面路径下".to_string()],
            hint: "常用于临时调试或文件落地".to_string(),
            enabled: true,
            source_type: "builtin".to_string(),
            platforms: vec![],
        },
        CommandMapping {
            id: "open-downloads".to_string(),
            trigger: "去下载目录".to_string(),
            command: "cd ~/Downloads".to_string(),
            description: "快速切到下载目录处理安装包和临时文件".to_string(),
            tags: vec![
                "download".to_string(),
                "downloads".to_string(),
                "下载".to_string(),
            ],
            examples: vec!["去下载目录".to_string(), "open downloads".to_string()],
            hint: "cd ~/Downloads".to_string(),
            enabled: true,
            source_type: "builtin".to_string(),
            platforms: vec![],
        },
    ]
}

fn normalize_workspace_state(mut state: WorkspaceState) -> WorkspaceState {
    state.canvas.zoom = state.canvas.zoom.clamp(0.2, 3.0);
    state.terminals = state
        .terminals
        .into_iter()
        .map(normalize_terminal_session)
        .collect();
    state
}

fn normalize_terminal_session(mut session: TerminalSession) -> TerminalSession {
    session.w = session.w.max(200.0);
    session.h = session.h.max(100.0);
    session.launch_options = normalize_terminal_launch_options(session.launch_options);
    if session.cwd.is_empty() {
        session.cwd = session.launch_options.cwd.clone();
    }
    session
}

fn normalize_terminal_launch_options(mut options: TerminalLaunchOptions) -> TerminalLaunchOptions {
    if options.mode.trim().is_empty() {
        options.mode = default_terminal_mode();
    }
    options.cwd = normalize_history_value(&options.cwd);
    options.startup_command = options.startup_command.trim().to_string();
    options.profile_name = options.profile_name.trim().to_string();
    options.profile_id = options.profile_id.trim().to_string();
    options
}

fn normalize_history_variants(
    variants: Vec<CommandHistoryVariant>,
    fallback_cwd: &str,
    fallback_timestamp: i64,
    fallback_count: u32,
) -> Vec<CommandHistoryVariant> {
    let mut merged: Vec<CommandHistoryVariant> = Vec::new();
    let fallback_cwd = normalize_history_value(fallback_cwd);

    if variants.is_empty() && (!fallback_cwd.is_empty() || fallback_count > 0) {
        return vec![CommandHistoryVariant {
            cwd: fallback_cwd,
            timestamp: fallback_timestamp,
            count: fallback_count.max(1),
        }];
    }

    for mut variant in variants {
        variant.cwd = normalize_history_value(&variant.cwd);
        variant.count = variant.count.max(1);
        if let Some(existing) = merged.iter_mut().find(|item| item.cwd == variant.cwd) {
            existing.count += variant.count;
            existing.timestamp = existing.timestamp.max(variant.timestamp);
        } else {
            merged.push(variant);
        }
    }

    merged.sort_by(|left, right| {
        right
            .count
            .cmp(&left.count)
            .then_with(|| right.timestamp.cmp(&left.timestamp))
    });
    merged
}

fn merge_history_variant(entry: &mut CommandHistoryEntry, cwd: &str, timestamp: i64, count: u32) {
    let normalized_cwd = normalize_history_value(cwd);
    let amount = count.max(1);
    if let Some(existing) = entry
        .variants
        .iter_mut()
        .find(|item| normalize_history_value(&item.cwd) == normalized_cwd)
    {
        existing.count += amount;
        existing.timestamp = existing.timestamp.max(timestamp);
    } else {
        entry.variants.push(CommandHistoryVariant {
            cwd: normalized_cwd,
            timestamp,
            count: amount,
        });
    }
    entry.variants.sort_by(|left, right| {
        right
            .count
            .cmp(&left.count)
            .then_with(|| right.timestamp.cmp(&left.timestamp))
    });
}

fn pick_preferred_history_cwd(variants: &[CommandHistoryVariant]) -> String {
    variants
        .first()
        .map(|item| item.cwd.clone())
        .unwrap_or_default()
}

fn normalize_mapping(mut mapping: CommandMapping) -> CommandMapping {
    mapping.trigger = mapping.trigger.trim().to_string();
    mapping.command = mapping.command.trim().to_string();
    mapping.description = mapping.description.trim().to_string();
    mapping.tags = mapping
        .tags
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect();
    mapping.examples = mapping
        .examples
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect();
    mapping.hint = mapping.hint.trim().to_string();
    mapping.platforms = mapping
        .platforms
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect();
    if mapping.source_type.trim().is_empty() {
        mapping.source_type = default_mapping_source_type();
    }
    mapping
}

fn filter_mappings_for_current_platform(entries: Vec<CommandMapping>) -> Vec<CommandMapping> {
    let platform = current_platform_id();
    entries
        .into_iter()
        .map(normalize_mapping)
        .filter(|mapping| {
            mapping.platforms.is_empty() || mapping.platforms.iter().any(|item| item == platform)
        })
        .collect()
}

fn current_platform_id() -> &'static str {
    if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    }
}

fn default_shortcuts() -> Vec<ShortcutBinding> {
    vec![
        ShortcutBinding {
            id: "desktop.drawTerminal".to_string(),
            label: "唤起自由终端".to_string(),
            description: "在桌面任意位置拖拽创建独立终端窗口".to_string(),
            category: "workspace".to_string(),
            editable: true,
            deletable: false,
            windows: "Ctrl+Alt+Enter".to_string(),
            darwin: "Cmd+Alt+Enter".to_string(),
            linux: "Ctrl+Alt+Enter".to_string(),
        },
        ShortcutBinding {
            id: "terminal.duplicate".to_string(),
            label: "复制终端实例".to_string(),
            description: "复制当前激活终端到新的画布位置".to_string(),
            category: "terminal".to_string(),
            editable: true,
            deletable: false,
            windows: "Ctrl+D".to_string(),
            darwin: "Cmd+D".to_string(),
            linux: "Ctrl+D".to_string(),
        },
        ShortcutBinding {
            id: "terminal.paste".to_string(),
            label: "粘贴终端实例".to_string(),
            description: "在画布上创建复制终端".to_string(),
            category: "terminal".to_string(),
            editable: true,
            deletable: false,
            windows: "Ctrl+Shift+D".to_string(),
            darwin: "Cmd+Shift+D".to_string(),
            linux: "Ctrl+Shift+D".to_string(),
        },
        ShortcutBinding {
            id: "terminal.copyText".to_string(),
            label: "复制终端文本".to_string(),
            description: "复制终端选中文本，若没有选中则复制当前输入行".to_string(),
            category: "terminal".to_string(),
            editable: true,
            deletable: false,
            windows: "Ctrl+Shift+C".to_string(),
            darwin: "Cmd+Shift+C".to_string(),
            linux: "Ctrl+Shift+C".to_string(),
        },
        ShortcutBinding {
            id: "terminal.pasteText".to_string(),
            label: "粘贴终端文本".to_string(),
            description: "将系统剪贴板文本粘贴到当前终端".to_string(),
            category: "terminal".to_string(),
            editable: true,
            deletable: false,
            windows: "Ctrl+Shift+V".to_string(),
            darwin: "Cmd+Shift+V".to_string(),
            linux: "Ctrl+Shift+V".to_string(),
        },
        ShortcutBinding {
            id: "terminal.selectLine".to_string(),
            label: "选中当前输入行".to_string(),
            description: "在终端中选中当前正在输入的命令".to_string(),
            category: "terminal".to_string(),
            editable: true,
            deletable: false,
            windows: "Ctrl+A".to_string(),
            darwin: "Cmd+A".to_string(),
            linux: "Ctrl+A".to_string(),
        },
        ShortcutBinding {
            id: "sidebar.files".to_string(),
            label: "打开文件管理".to_string(),
            description: "切换到左侧文件管理面板".to_string(),
            category: "navigation".to_string(),
            editable: true,
            deletable: false,
            windows: "Alt+1".to_string(),
            darwin: "Alt+1".to_string(),
            linux: "Alt+1".to_string(),
        },
        ShortcutBinding {
            id: "sidebar.commands".to_string(),
            label: "打开命令管理".to_string(),
            description: "切换到左侧命令管理面板".to_string(),
            category: "navigation".to_string(),
            editable: true,
            deletable: false,
            windows: "Alt+2".to_string(),
            darwin: "Alt+2".to_string(),
            linux: "Alt+2".to_string(),
        },
        ShortcutBinding {
            id: "sidebar.history".to_string(),
            label: "打开历史命令".to_string(),
            description: "切换到左侧历史命令面板".to_string(),
            category: "navigation".to_string(),
            editable: true,
            deletable: false,
            windows: "Alt+3".to_string(),
            darwin: "Alt+3".to_string(),
            linux: "Alt+3".to_string(),
        },
        ShortcutBinding {
            id: "sidebar.mappings".to_string(),
            label: "打开命令映射".to_string(),
            description: "切换到左侧命令映射面板".to_string(),
            category: "navigation".to_string(),
            editable: true,
            deletable: false,
            windows: "Alt+4".to_string(),
            darwin: "Alt+4".to_string(),
            linux: "Alt+4".to_string(),
        },
        ShortcutBinding {
            id: "sidebar.ssh".to_string(),
            label: "打开 SSH 面板".to_string(),
            description: "切换到左侧 SSH 远程服务面板".to_string(),
            category: "navigation".to_string(),
            editable: true,
            deletable: false,
            windows: "Alt+5".to_string(),
            darwin: "Alt+5".to_string(),
            linux: "Alt+5".to_string(),
        },
        ShortcutBinding {
            id: "sidebar.shortcuts".to_string(),
            label: "打开快捷键设置".to_string(),
            description: "切换到快捷键设置面板".to_string(),
            category: "navigation".to_string(),
            editable: true,
            deletable: false,
            windows: "Alt+6".to_string(),
            darwin: "Alt+6".to_string(),
            linux: "Alt+6".to_string(),
        },
        ShortcutBinding {
            id: "sidebar.settings".to_string(),
            label: "打开设置".to_string(),
            description: "切换到设置面板".to_string(),
            category: "navigation".to_string(),
            editable: true,
            deletable: false,
            windows: "Alt+0".to_string(),
            darwin: "Alt+0".to_string(),
            linux: "Alt+0".to_string(),
        },
    ]
}
