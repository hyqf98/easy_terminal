use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandEntry {
    pub name: String,
    #[serde(default)]
    pub alias: Vec<String>,
    pub description: String,
    #[serde(default)]
    pub usage: String,
    #[serde(default)]
    pub category: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandConfig {
    pub platform: String,
    pub commands: Vec<CommandEntry>,
}

fn commands_dir() -> Result<PathBuf, String> {
    let app_dir = dirs::data_dir()
        .ok_or("Cannot determine app data directory")?
        .join("easy-terminal")
        .join("commands");
    if !app_dir.exists() {
        fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    }
    Ok(app_dir)
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

pub fn load_command_configs() -> Result<Vec<CommandConfig>, String> {
    let dir = commands_dir()?;
    let mut configs = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().map_or(false, |ext| ext == "json") {
            let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            match serde_json::from_str::<CommandConfig>(&content) {
                Ok(config) => configs.push(config),
                Err(e) => eprintln!("Failed to parse {}: {}", path.display(), e),
            }
        }
    }
    Ok(configs)
}

pub fn save_command_config(config: CommandConfig) -> Result<(), String> {
    let dir = commands_dir()?;
    let filename = format!("{}.json", config.platform);
    let path = dir.join(filename);
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}

pub fn init_default_commands() -> Result<(), String> {
    let dir = commands_dir()?;
    let platform = get_platform();

    let defaults: Vec<(&str, &str)> = vec![
        ("windows", include_str!("../commands/windows.json")),
        ("linux", include_str!("../commands/linux.json")),
        ("darwin", include_str!("../commands/darwin.json")),
    ];

    for (plat, content) in defaults {
        let path = dir.join(format!("{}.json", plat));
        if !path.exists() || plat == platform {
            // Always update the current platform's defaults, create others if missing
            if !path.exists() {
                let config: CommandConfig = serde_json::from_str(content).map_err(|e| e.to_string())?;
                save_command_config(config)?;
            }
        }
    }

    Ok(())
}
