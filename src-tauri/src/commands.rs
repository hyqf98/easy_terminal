use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandEntry {
    pub name: String,
    #[serde(default)]
    pub alias: Vec<String>,
    #[serde(default)]
    pub name_cn: String,
    pub description: String,
    #[serde(default)]
    pub usage: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub examples: Vec<String>,
    #[serde(default)]
    pub hint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandConfig {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub platforms: Vec<String>,
    pub commands: Vec<CommandEntry>,
    #[serde(default)]
    pub platform: String,
}

fn base_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    Ok(home.join(".easy-terminal"))
}

fn commands_dir() -> Result<PathBuf, String> {
    Ok(base_dir()?.join("commands"))
}

fn system_dir() -> Result<PathBuf, String> {
    Ok(commands_dir()?.join("system"))
}

fn custom_dir() -> Result<PathBuf, String> {
    Ok(commands_dir()?.join("custom"))
}

fn quick_path() -> Result<PathBuf, String> {
    Ok(commands_dir()?.join("quick.json"))
}

pub fn get_platform() -> String {
    if cfg!(windows) {
        "windows".to_string()
    } else if cfg!(target_os = "macos") {
        "darwin".to_string()
    } else {
        "linux".to_string()
    }
}

pub fn get_platforms() -> Vec<String> {
    let mut platforms = Vec::new();
    if cfg!(windows) {
        platforms.push("windows".to_string());
    } else if cfg!(target_os = "macos") {
        platforms.push("darwin".to_string());
    } else {
        platforms.push("linux".to_string());
        if let Ok(content) = fs::read_to_string("/etc/os-release") {
            if content.contains("Ubuntu") || content.contains("ubuntu") {
                platforms.push("ubuntu".to_string());
            }
            if content.contains("Arch") || content.contains("arch") {
                platforms.push("arch".to_string());
            }
        }
    }
    platforms
}

fn load_config_file(path: &PathBuf) -> Result<CommandConfig, String> {
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut config: CommandConfig = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse {}: {}", path.display(), e))?;

    // Backward compatibility: infer kind/platforms from old format
    if config.kind.is_empty() && !config.platform.is_empty() {
        config.id = config.platform.clone();
        config.kind = "system".to_string();
        config.platforms = vec![config.platform.clone()];
    }

    Ok(config)
}

pub fn load_command_configs() -> Result<Vec<CommandConfig>, String> {
    let cmd_dir = commands_dir()?;
    let mut configs = Vec::new();
    let current_platforms = get_platforms();

    // 1. Load system commands matching current platforms
    let sys_dir = cmd_dir.join("system");
    if sys_dir.exists() {
        for plat in &current_platforms {
            let path = sys_dir.join(format!("{}.json", plat));
            if path.exists() {
                if let Ok(config) = load_config_file(&path) {
                    configs.push(config);
                }
            }
        }
    }

    // 2. Load ALL custom commands
    let cus_dir = cmd_dir.join("custom");
    if cus_dir.exists() {
        if let Ok(entries) = fs::read_dir(&cus_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().map_or(false, |ext| ext == "json") {
                    if let Ok(config) = load_config_file(&path) {
                        configs.push(config);
                    }
                }
            }
        }
    }

    Ok(configs)
}

pub fn load_quick_commands() -> Result<Vec<CommandEntry>, String> {
    let path = quick_path()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let config = load_config_file(&path)?;
    Ok(config.commands)
}

pub fn save_quick_commands(commands: Vec<CommandEntry>) -> Result<(), String> {
    let dir = commands_dir()?;
    let config = CommandConfig {
        id: "quick".to_string(),
        kind: "quick".to_string(),
        platforms: vec![],
        commands,
        platform: String::new(),
    };
    let path = dir.join("quick.json");
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}

pub fn save_command_config(config: CommandConfig) -> Result<(), String> {
    let dir = commands_dir()?;
    let kind = if config.kind.is_empty() {
        if config.platform.is_empty() { "custom" } else { "system" }
    } else {
        &config.kind
    };

    let sub_dir = match kind {
        "system" => dir.join("system"),
        "quick" => dir.clone(),
        _ => dir.join("custom"),
    };
    fs::create_dir_all(&sub_dir).map_err(|e| e.to_string())?;

    let id = if config.id.is_empty() { &config.platform } else { &config.id };
    let filename = format!("{}.json", id);
    let path = sub_dir.join(filename);
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}

pub fn init_default_commands() -> Result<(), String> {
    let cmd_dir = commands_dir()?;
    let sys_dir = system_dir()?;
    let cus_dir = custom_dir()?;

    fs::create_dir_all(&sys_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&cus_dir).map_err(|e| e.to_string())?;

    // System defaults (seed only when missing so user tag/example edits persist)
    let system_defaults: Vec<(&str, &str)> = vec![
        ("windows", include_str!("../commands/system/windows.json")),
        ("darwin", include_str!("../commands/system/darwin.json")),
        ("linux", include_str!("../commands/system/linux.json")),
        ("ubuntu", include_str!("../commands/system/ubuntu.json")),
        ("arch", include_str!("../commands/system/arch.json")),
    ];

    for (plat, content) in &system_defaults {
        let path = sys_dir.join(format!("{}.json", plat));
        if !path.exists() {
            let config: CommandConfig = serde_json::from_str(content).map_err(|e| e.to_string())?;
            save_command_config(config)?;
        }
    }

    // Built-in custom command libraries are seeded once and then left editable.
    let custom_defaults: Vec<(&str, &str)> = vec![
        ("java", include_str!("../commands/custom/java.json")),
        ("python", include_str!("../commands/custom/python.json")),
        ("conda", include_str!("../commands/custom/conda.json")),
        ("npm", include_str!("../commands/custom/npm.json")),
        ("docker", include_str!("../commands/custom/docker.json")),
        ("rust", include_str!("../commands/custom/rust.json")),
    ];

    for (id, content) in &custom_defaults {
        let path = cus_dir.join(format!("{}.json", id));
        if !path.exists() {
            let config: CommandConfig = serde_json::from_str(content).map_err(|e| e.to_string())?;
            save_command_config(config)?;
        }
    }

    // Quick commands - create empty if not exists
    let quick_path = cmd_dir.join("quick.json");
    if !quick_path.exists() {
        save_quick_commands(Vec::new())?;
    }

    // Migrate from old directory
    migrate_old_dir()?;
    migrate_legacy_quick_commands()?;

    Ok(())
}

/// List available custom command templates that can be installed
pub fn list_available_custom_templates() -> Result<Vec<CommandConfig>, String> {
    let cus_dir = custom_dir()?;

    // Bundled templates (from src-tauri/commands/custom/)
    let bundled: Vec<(&str, &str)> = vec![
        ("java", include_str!("../commands/custom/java.json")),
        ("python", include_str!("../commands/custom/python.json")),
        ("conda", include_str!("../commands/custom/conda.json")),
        ("npm", include_str!("../commands/custom/npm.json")),
        ("docker", include_str!("../commands/custom/docker.json")),
        ("rust", include_str!("../commands/custom/rust.json")),
    ];

    // Get already-installed custom command IDs
    let _installed_ids: std::collections::HashSet<String> = if cus_dir.exists() {
        fs::read_dir(&cus_dir)
            .map(|entries| {
                entries
                    .flatten()
                    .filter(|e| e.path().extension().map_or(false, |ext| ext == "json"))
                    .filter_map(|e| {
                        e.path()
                            .file_stem()
                            .map(|s| s.to_string_lossy().to_string())
                    })
                    .collect()
            })
            .unwrap_or_default()
    } else {
        std::collections::HashSet::new()
    };

    let mut templates = Vec::new();

    for (_, content) in &bundled {
        if let Ok(config) = serde_json::from_str::<CommandConfig>(content) {
            templates.push(config);
        }
    }

    // Also scan custom dir for any user-created files not in bundled
    if cus_dir.exists() {
        if let Ok(entries) = fs::read_dir(&cus_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().map_or(false, |ext| ext == "json") {
                    if let Ok(config) = load_config_file(&path) {
                        // Skip if already in templates (bundled)
                        let id = config.id.clone();
                        if !templates.iter().any(|t| t.id == id) {
                            templates.push(config);
                        }
                    }
                }
            }
        }
    }

    Ok(templates)
}

/// Check which template IDs are already installed
pub fn get_installed_custom_ids() -> Result<Vec<String>, String> {
    let cus_dir = custom_dir()?;
    if !cus_dir.exists() {
        return Ok(Vec::new());
    }
    let mut ids = Vec::new();
    if let Ok(entries) = fs::read_dir(&cus_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "json") {
                if let Ok(config) = load_config_file(&path) {
                    ids.push(config.id);
                }
            }
        }
    }
    Ok(ids)
}

fn migrate_old_dir() -> Result<(), String> {
    let old_dir = dirs::data_dir()
        .map(|d| d.join("easy-terminal").join("commands"));

    if let Some(old) = old_dir {
        if old.exists() {
            let new_dir = commands_dir()?;
            if let Ok(entries) = fs::read_dir(&old) {
                for entry in entries.flatten() {
                    let old_path = entry.path();
                    if old_path.extension().map_or(false, |ext| ext == "json") {
                        if let Ok(config) = load_config_file(&old_path) {
                            let new_path = new_dir.join(entry.file_name());
                            if !new_path.exists() {
                                let content = serde_json::to_string_pretty(&config)
                                    .map_err(|e| e.to_string())?;
                                fs::write(&new_path, content).map_err(|e| e.to_string())?;
                            }
                        }
                    }
                }
            }
            // Remove old directory after migration
            let _ = fs::remove_dir_all(&old);
        }
    }

    Ok(())
}

fn merge_unique_commands(
    existing: &[CommandEntry],
    incoming: &[CommandEntry],
) -> Vec<CommandEntry> {
    let mut merged = existing.to_vec();
    let mut seen: std::collections::HashSet<(String, String)> = existing
        .iter()
        .map(|cmd| (cmd.name.clone(), cmd.command.clone()))
        .collect();

    for cmd in incoming {
        let key = (cmd.name.clone(), cmd.command.clone());
        if seen.insert(key) {
            merged.push(cmd.clone());
        }
    }

    merged
}

fn migrate_legacy_quick_commands() -> Result<(), String> {
    let path = quick_path()?;
    if !path.exists() {
        return Ok(());
    }

    let legacy = load_config_file(&path)?;
    if legacy.commands.is_empty() {
        return Ok(());
    }

    let custom_path = custom_dir()?.join("quick-commands.json");
    let existing = if custom_path.exists() {
        load_config_file(&custom_path)?
    } else {
        CommandConfig {
            id: "quick-commands".to_string(),
            kind: "custom".to_string(),
            platforms: vec![],
            commands: Vec::new(),
            platform: String::new(),
        }
    };

    let merged = CommandConfig {
        commands: merge_unique_commands(&existing.commands, &legacy.commands),
        ..existing
    };
    save_command_config(merged)?;
    save_quick_commands(Vec::new())?;

    Ok(())
}
