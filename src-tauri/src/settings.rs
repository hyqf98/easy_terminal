use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone)]
pub struct AppSettings {
    pub theme: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
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
