use serde::{Deserialize, Serialize};
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
    #[serde(default)]
    pub last_update_check: String,
}

fn default_language() -> String {
    "zh-CN".to_string()
}

fn default_auto_check_update() -> bool {
    true
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
            language: default_language(),
            auto_check_update: default_auto_check_update(),
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
pub struct TerminalSession {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub cwd: String,
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

pub fn save_terminal_state(sessions: Vec<TerminalSession>) -> Result<(), String> {
    let path = terminal_state_path()?;
    let data = serde_json::to_string_pretty(&sessions).map_err(|e| e.to_string())?;
    fs::write(&path, data).map_err(|e| e.to_string())
}

pub fn load_terminal_state() -> Result<Vec<TerminalSession>, String> {
    let path = terminal_state_path()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| e.to_string())
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CommandHistoryEntry {
    pub id: String,
    pub command: String,
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
}

fn default_mapping_enabled() -> bool {
    true
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
    pub startup_path: String,
    #[serde(default)]
    pub jump_profile_id: String,
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

pub fn load_command_history() -> Result<Vec<CommandHistoryEntry>, String> {
    let path = history_path()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| e.to_string())
}

pub fn save_command_history(entries: Vec<CommandHistoryEntry>) -> Result<(), String> {
    let path = history_path()?;
    let data = serde_json::to_string_pretty(&entries).map_err(|e| e.to_string())?;
    fs::write(&path, data).map_err(|e| e.to_string())
}

pub fn record_command_history(entry: CommandHistoryEntry) -> Result<Vec<CommandHistoryEntry>, String> {
    let mut entries = load_command_history()?;

    if let Some(existing) = entries.iter_mut().find(|item| item.command == entry.command && item.cwd == entry.cwd) {
        existing.timestamp = entry.timestamp;
        existing.count += 1;
        existing.id = entry.id;
    } else {
        entries.push(entry);
    }

    entries.sort_by(|left, right| right.timestamp.cmp(&left.timestamp));
    if entries.len() > 200 {
        entries.truncate(200);
    }

    save_command_history(entries.clone())?;
    Ok(entries)
}

pub fn load_command_mappings() -> Result<Vec<CommandMapping>, String> {
    let path = mappings_path()?;
    if !path.exists() {
        return Ok(default_command_mappings());
    }
    let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| e.to_string())
}

pub fn save_command_mappings(entries: Vec<CommandMapping>) -> Result<(), String> {
    let path = mappings_path()?;
    let data = serde_json::to_string_pretty(&entries).map_err(|e| e.to_string())?;
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

fn default_command_mappings() -> Vec<CommandMapping> {
    vec![
        CommandMapping {
            id: "go-home".to_string(),
            trigger: "去用户路径下".to_string(),
            command: "cd ~".to_string(),
            description: "快速回到当前用户主目录".to_string(),
            tags: vec!["home".to_string(), "用户目录".to_string(), "回家".to_string()],
            examples: vec!["去用户路径下".to_string(), "home".to_string()],
            hint: "回车后立即切换到当前账号主目录".to_string(),
            enabled: true,
        },
        CommandMapping {
            id: "open-desktop".to_string(),
            trigger: "去桌面路径下".to_string(),
            command: desktop_command(),
            description: "开发时快速切到桌面目录".to_string(),
            tags: vec!["desktop".to_string(), "桌面".to_string()],
            examples: vec!["去桌面路径下".to_string()],
            hint: "常用于临时调试或文件落地".to_string(),
            enabled: true,
        },
        CommandMapping {
            id: "launch-claude".to_string(),
            trigger: "启动claude".to_string(),
            command: "claude --dangerously-skip-permissions".to_string(),
            description: "以跳过权限确认的方式启动 Claude Code".to_string(),
            tags: vec!["claude".to_string(), "anthropic".to_string(), "ai".to_string()],
            examples: vec!["启动claude".to_string()],
            hint: "--dangerously-skip-permissions".to_string(),
            enabled: true,
        },
        CommandMapping {
            id: "launch-claude-tmux".to_string(),
            trigger: "启动claude团队模式".to_string(),
            command: "claude --dangerously-skip-permissions --tmux".to_string(),
            description: "为 Claude Code TUI 预留 tmux 会话，兼容更稳定".to_string(),
            tags: vec!["claude team".to_string(), "tmux".to_string(), "agent".to_string(), "团队".to_string()],
            examples: vec!["启动claude团队模式".to_string()],
            hint: "--tmux".to_string(),
            enabled: true,
        },
        CommandMapping {
            id: "launch-codex".to_string(),
            trigger: "启动codex".to_string(),
            command: "codex --sandbox danger-full-access --full-auto".to_string(),
            description: "以全自动模式启动 Codex CLI".to_string(),
            tags: vec!["codex".to_string(), "openai".to_string(), "ai".to_string()],
            examples: vec!["启动codex".to_string()],
            hint: "--sandbox danger-full-access --full-auto".to_string(),
            enabled: true,
        },
        CommandMapping {
            id: "launch-codex-friendly".to_string(),
            trigger: "启动codex友好模式".to_string(),
            command: "codex --sandbox danger-full-access --full-auto --no-alt-screen".to_string(),
            description: "关闭 alt screen，适合当前终端画布中的长会话显示".to_string(),
            tags: vec!["codex tui".to_string(), "no-alt-screen".to_string(), "友好显示".to_string()],
            examples: vec!["启动codex友好模式".to_string()],
            hint: "--no-alt-screen".to_string(),
            enabled: true,
        },
    ]
}

fn desktop_command() -> String {
    if cfg!(windows) {
        "cd ~/Desktop".to_string()
    } else {
        "cd ~/Desktop".to_string()
    }
}
