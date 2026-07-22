use rusqlite::{params, params_from_iter, Connection, OptionalExtension, ToSql};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::path_util;

const DB_VERSION: &str = "2";
const DEFAULT_PAGE_SIZE: i64 = 100;
const DEFAULT_SEARCH_LIMIT: i64 = 12;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandLibrarySummary {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub source_type: String,
    pub platforms: Vec<String>,
    pub language: String,
    pub enabled: bool,
    pub command_count: i64,
    pub current: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandSummary {
    pub id: i64,
    pub library_id: String,
    pub command_key: String,
    pub name: String,
    pub alias: Vec<String>,
    pub name_cn: String,
    pub description: String,
    pub usage: String,
    pub category: String,
    pub command: String,
    pub tags: Vec<String>,
    pub hint: String,
    pub language: String,
    pub triggers: Vec<String>,
    pub keywords: Vec<String>,
    pub weight: i32,
    pub enabled: bool,
    pub example_count: usize,
    pub first_example: Option<String>,
    pub library_kind: String,
    pub source_type: String,
    pub library_label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandDetail {
    pub id: i64,
    pub library_id: String,
    pub command_key: String,
    pub name: String,
    pub alias: Vec<String>,
    pub name_cn: String,
    pub description: String,
    pub usage: String,
    pub category: String,
    pub command: String,
    pub tags: Vec<String>,
    pub examples: Vec<String>,
    pub hint: String,
    pub language: String,
    pub triggers: Vec<String>,
    pub keywords: Vec<String>,
    pub weight: i32,
    pub enabled: bool,
    pub library_kind: String,
    pub source_type: String,
    pub library_label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandSummaryPage {
    pub items: Vec<CommandSummary>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandLibraryPayload {
    pub id: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub source_type: String,
    #[serde(default)]
    pub platforms: Vec<String>,
    #[serde(default)]
    pub language: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandPayload {
    pub id: Option<i64>,
    pub library_id: String,
    #[serde(default)]
    pub command_key: String,
    pub name: String,
    #[serde(default)]
    pub alias: Vec<String>,
    #[serde(default)]
    pub name_cn: String,
    #[serde(default)]
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
    #[serde(default)]
    pub language: String,
    #[serde(default)]
    pub triggers: Vec<String>,
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default)]
    pub weight: i32,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CommandQueryParams {
    pub library_id: Option<String>,
    pub keyword: Option<String>,
    pub kind: Option<String>,
    pub category: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
    pub enabled_only: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CommandSearchParams {
    pub keyword: String,
    pub library_ids: Option<Vec<String>>,
    pub limit: Option<i64>,
    pub enabled_only: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PortableCommandLibrary {
    #[serde(default)]
    schema_version: Option<i32>,
    #[serde(default)]
    id: String,
    #[serde(default)]
    label: String,
    #[serde(default)]
    kind: String,
    #[serde(default)]
    source_type: String,
    #[serde(default)]
    platforms: Vec<String>,
    #[serde(default)]
    platform: String,
    #[serde(default)]
    language: String,
    #[serde(default = "default_true")]
    enabled: bool,
    #[serde(default)]
    commands: Vec<PortableCommandEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PortableCommandEntry {
    #[serde(default)]
    command_key: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    alias: Vec<String>,
    #[serde(default)]
    name_cn: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    usage: String,
    #[serde(default)]
    category: String,
    #[serde(default)]
    command: String,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    examples: Vec<String>,
    #[serde(default)]
    hint: String,
    #[serde(default)]
    language: String,
    #[serde(default)]
    triggers: Vec<String>,
    #[serde(default)]
    keywords: Vec<String>,
    #[serde(default)]
    weight: i32,
    #[serde(default = "default_true")]
    enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalFavoriteRecord {
    pub id: i64,
    pub ssh_profile_id: String,
    pub path: String,
    pub name: String,
    pub icon: String,
    pub color: String,
    pub sort_order: i64,
}

pub struct Db {
    conn: Mutex<Connection>,
}

fn default_true() -> bool {
    true
}

fn db_path() -> Result<PathBuf, String> {
    Ok(path_util::app_data_dir()?.join("commands.db"))
}

fn archive_dir() -> Result<PathBuf, String> {
    Ok(path_util::app_data_dir()?.join("commands-archive"))
}

pub fn bundled_seeds() -> Vec<(&'static str, &'static str, &'static str, &'static str)> {
    vec![
        (
            "windows",
            "system",
            "builtin",
            include_str!("../commands/system/windows.json"),
        ),
        (
            "darwin",
            "system",
            "builtin",
            include_str!("../commands/system/darwin.json"),
        ),
        (
            "linux",
            "system",
            "builtin",
            include_str!("../commands/system/linux.json"),
        ),
        (
            "ubuntu",
            "system",
            "builtin",
            include_str!("../commands/system/ubuntu.json"),
        ),
    ]
}

impl Db {
    pub fn new() -> Result<Self, String> {
        let conn =
            Connection::open(db_path()?).map_err(|e| format!("Failed to open database: {e}"))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .map_err(|e| e.to_string())?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.init_schema()?;
        db.seed_if_needed()?;
        Ok(db)
    }

    fn init_schema(&self) -> Result<(), String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS db_meta (
                 key TEXT PRIMARY KEY,
                 value TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS command_libraries (
                 id TEXT PRIMARY KEY,
                 label TEXT NOT NULL DEFAULT '',
                 kind TEXT NOT NULL DEFAULT 'custom',
                 source_type TEXT NOT NULL DEFAULT 'user',
                 platforms TEXT NOT NULL DEFAULT '[]',
                 language TEXT NOT NULL DEFAULT '',
                 enabled INTEGER NOT NULL DEFAULT 1,
                 schema_version INTEGER NOT NULL DEFAULT 2,
                 seed_version TEXT NOT NULL DEFAULT '',
                 created_at TEXT NOT NULL DEFAULT (datetime('now')),
                 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
             );
             CREATE TABLE IF NOT EXISTS commands (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 library_id TEXT NOT NULL REFERENCES command_libraries(id) ON DELETE CASCADE,
                 command_key TEXT NOT NULL,
                 name TEXT NOT NULL,
                 alias TEXT NOT NULL DEFAULT '[]',
                 name_cn TEXT NOT NULL DEFAULT '',
                 description TEXT NOT NULL DEFAULT '',
                 usage TEXT NOT NULL DEFAULT '',
                 category TEXT NOT NULL DEFAULT '',
                 command TEXT NOT NULL DEFAULT '',
                 tags TEXT NOT NULL DEFAULT '[]',
                 examples TEXT NOT NULL DEFAULT '[]',
                 hint TEXT NOT NULL DEFAULT '',
                 language TEXT NOT NULL DEFAULT '',
                 triggers TEXT NOT NULL DEFAULT '[]',
                 keywords TEXT NOT NULL DEFAULT '[]',
                 weight INTEGER NOT NULL DEFAULT 0,
                 enabled INTEGER NOT NULL DEFAULT 1,
                 created_at TEXT NOT NULL DEFAULT (datetime('now')),
                 updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                 UNIQUE(library_id, command_key)
             );
             CREATE INDEX IF NOT EXISTS idx_commands_library ON commands(library_id);
             CREATE INDEX IF NOT EXISTS idx_commands_category ON commands(category);
             CREATE INDEX IF NOT EXISTS idx_commands_name ON commands(name);
             CREATE INDEX IF NOT EXISTS idx_commands_enabled ON commands(enabled);
             CREATE INDEX IF NOT EXISTS idx_libraries_kind ON command_libraries(kind);
             CREATE INDEX IF NOT EXISTS idx_libraries_enabled ON command_libraries(enabled);",
        )
        .map_err(|e| format!("schema init failed: {e}"))?;

        tx.execute_batch(
            "DROP TRIGGER IF EXISTS commands_ai;
             DROP TRIGGER IF EXISTS commands_au;
             DROP TRIGGER IF EXISTS commands_ad;
             DROP TABLE IF EXISTS commands_fts;",
        )
        .map_err(|e| format!("legacy search cleanup failed: {e}"))?;

        tx.execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS commands_fts USING fts5(
                name, command, command_key, name_cn, description, category,
                usage, alias, tags, triggers, keywords, examples,
                content='commands', content_rowid='id'
            );
            CREATE TRIGGER IF NOT EXISTS commands_ai AFTER INSERT ON commands BEGIN
                INSERT INTO commands_fts(rowid, name, command, command_key, name_cn, description, category, usage, alias, tags, triggers, keywords, examples)
                VALUES (new.id, new.name, new.command, new.command_key, new.name_cn, new.description, new.category, new.usage, new.alias, new.tags, new.triggers, new.keywords, new.examples);
            END;
            CREATE TRIGGER IF NOT EXISTS commands_ad AFTER DELETE ON commands BEGIN
                INSERT INTO commands_fts(commands_fts, rowid, name, command, command_key, name_cn, description, category, usage, alias, tags, triggers, keywords, examples)
                VALUES('delete', old.id, old.name, old.command, old.command_key, old.name_cn, old.description, old.category, old.usage, old.alias, old.tags, old.triggers, old.keywords, old.examples);
            END;
            CREATE TRIGGER IF NOT EXISTS commands_au AFTER UPDATE ON commands BEGIN
                INSERT INTO commands_fts(commands_fts, rowid, name, command, command_key, name_cn, description, category, usage, alias, tags, triggers, keywords, examples)
                VALUES('delete', old.id, old.name, old.command, old.command_key, old.name_cn, old.description, old.category, old.usage, old.alias, old.tags, old.triggers, old.keywords, old.examples);
                INSERT INTO commands_fts(rowid, name, command, command_key, name_cn, description, category, usage, alias, tags, triggers, keywords, examples)
                VALUES (new.id, new.name, new.command, new.command_key, new.name_cn, new.description, new.category, new.usage, new.alias, new.tags, new.triggers, new.keywords, new.examples);
            END;",
        )
        .map_err(|e| format!("FTS5 setup failed: {e}"))?;

        tx.execute_batch("INSERT INTO commands_fts(commands_fts) VALUES('rebuild');")
            .map_err(|e| format!("FTS5 rebuild failed: {e}"))?;

        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS terminal_favorites (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 ssh_profile_id TEXT NOT NULL DEFAULT '',
                 path TEXT NOT NULL,
                 name TEXT NOT NULL DEFAULT '',
                 icon TEXT NOT NULL DEFAULT 'folder',
                 color TEXT NOT NULL DEFAULT '#e0a030',
                 sort_order INTEGER NOT NULL DEFAULT 0,
                 created_at TEXT NOT NULL DEFAULT (datetime('now')),
                 UNIQUE(ssh_profile_id, path)
             );
             CREATE INDEX IF NOT EXISTS idx_terminal_favorites_ssh_profile_id ON terminal_favorites(ssh_profile_id);",
        )
        .map_err(|e| format!("terminal favorites schema init failed: {e}"))?;

        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    fn seed_if_needed(&self) -> Result<(), String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let version = conn
            .query_row(
                "SELECT value FROM db_meta WHERE key = 'version'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if version.as_deref() == Some(DB_VERSION) {
            self.ensure_builtin_seeds(&mut conn)?;
            self.backfill_generated_examples(&mut conn)?;
            return Ok(());
        }

        self.migrate_legacy_json(&mut conn)?;
        self.ensure_builtin_seeds(&mut conn)?;
        self.backfill_generated_examples(&mut conn)?;
        conn.execute(
            "INSERT OR REPLACE INTO db_meta (key, value) VALUES ('version', ?1)",
            params![DB_VERSION],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn ensure_builtin_seeds(&self, conn: &mut Connection) -> Result<(), String> {
        // Clean up deprecated builtin libraries (arch + all custom builtins)
        // that were removed from bundled_seeds in newer versions.
        conn.execute(
            "DELETE FROM commands WHERE library_id IN (
                SELECT id FROM command_libraries
                WHERE source_type = 'builtin' AND (kind = 'custom' OR id = 'arch')
            )",
            [],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM command_libraries WHERE source_type = 'builtin' AND (kind = 'custom' OR id = 'arch')",
            [],
        )
        .map_err(|e| e.to_string())?;

        for (id, kind, source_type, content) in bundled_seeds() {
            let exists = conn
                .query_row(
                    "SELECT 1 FROM command_libraries WHERE id = ?1 LIMIT 1",
                    params![id],
                    |_| Ok(()),
                )
                .optional()
                .map_err(|e| e.to_string())?
                .is_some();
            if exists {
                continue;
            }
            let library = self.parse_portable_library(content, kind, source_type)?;
            self.insert_library_with_commands(conn, &library)?;
        }
        Ok(())
    }

    fn backfill_generated_examples(&self, conn: &mut Connection) -> Result<(), String> {
        let mut stmt = conn
            .prepare(
                "SELECT c.id, c.command_key, c.name, c.alias, c.name_cn, c.description, c.usage, c.category, c.command, c.tags, c.examples, c.hint, c.language, c.triggers, c.keywords, c.weight, c.enabled
                 FROM commands c
                 WHERE c.examples = '[]' OR c.examples = ''",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    PortableCommandEntry {
                        command_key: row.get(1)?,
                        name: row.get(2)?,
                        alias: parse_json_vec(&row.get::<_, String>(3)?),
                        name_cn: row.get(4)?,
                        description: row.get(5)?,
                        usage: row.get(6)?,
                        category: row.get(7)?,
                        command: row.get(8)?,
                        tags: parse_json_vec(&row.get::<_, String>(9)?),
                        examples: parse_json_vec(&row.get::<_, String>(10)?),
                        hint: row.get(11)?,
                        language: row.get(12)?,
                        triggers: parse_json_vec(&row.get::<_, String>(13)?),
                        keywords: parse_json_vec(&row.get::<_, String>(14)?),
                        weight: row.get(15)?,
                        enabled: row.get::<_, i64>(16)? != 0,
                    },
                ))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|item| item.ok())
            .collect::<Vec<_>>();
        drop(stmt);

        for (id, mut entry) in rows {
            if entry.examples.is_empty() {
                entry.examples = generate_examples_for_entry(&entry);
            }
            if entry.examples.is_empty() {
                continue;
            }
            conn.execute(
                "UPDATE commands SET examples = ?1, updated_at = datetime('now') WHERE id = ?2",
                params![json_string(&entry.examples), id],
            )
            .map_err(|e| e.to_string())?;
        }

        Ok(())
    }

    fn migrate_legacy_json(&self, conn: &mut Connection) -> Result<(), String> {
        let root = path_util::app_data_dir()?.join("commands");
        if !root.exists() {
            return Ok(());
        }

        for (id, kind, source_type, bundled_content) in bundled_seeds() {
            let legacy_path = match kind {
                "system" => root.join("system").join(format!("{id}.json")),
                _ => root.join("custom").join(format!("{id}.json")),
            };
            let content = if legacy_path.exists() {
                fs::read_to_string(&legacy_path).unwrap_or_else(|_| bundled_content.to_string())
            } else {
                bundled_content.to_string()
            };
            let library = self.parse_portable_library(&content, kind, source_type)?;
            self.insert_library_with_commands(conn, &library)?;
        }

        let custom_dir = root.join("custom");
        if custom_dir.exists() {
            for entry in fs::read_dir(&custom_dir).map_err(|e| e.to_string())? {
                let path = entry.map_err(|e| e.to_string())?.path();
                if !path.extension().map_or(false, |ext| ext == "json") {
                    continue;
                }
                let stem = path
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                if bundled_seeds().iter().any(|(id, _, _, _)| *id == stem) {
                    continue;
                }
                let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
                let library = self.parse_portable_library(&content, "custom", "user")?;
                self.insert_library_with_commands(conn, &library)?;
            }
        }

        let quick_path = root.join("quick.json");
        if quick_path.exists() {
            let content = fs::read_to_string(&quick_path).map_err(|e| e.to_string())?;
            let mut library = self.parse_portable_library(&content, "custom", "user")?;
            if library.id.trim().is_empty() || library.id == "quick" {
                library.id = "quick-commands".to_string();
                library.label = "Quick Commands".to_string();
            }
            self.insert_library_with_commands(conn, &library)?;
        }

        self.archive_legacy_commands_dir(&root)?;
        Ok(())
    }

    fn archive_legacy_commands_dir(&self, root: &Path) -> Result<(), String> {
        let archive_root = archive_dir()?;
        fs::create_dir_all(&archive_root).map_err(|e| e.to_string())?;
        if !root.exists() {
            return Ok(());
        }

        for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let source = entry.path();
            let target = archive_root.join(entry.file_name());
            if target.exists() {
                continue;
            }
            let _ = fs::rename(source, target);
        }
        Ok(())
    }

    fn parse_portable_library(
        &self,
        content: &str,
        default_kind: &str,
        default_source_type: &str,
    ) -> Result<PortableCommandLibrary, String> {
        let mut library: PortableCommandLibrary = serde_json::from_str(content)
            .map_err(|e| format!("invalid command library json: {e}"))?;
        if library.id.trim().is_empty() {
            return Err("command library id is required".to_string());
        }
        if library.label.trim().is_empty() {
            library.label = library.id.clone();
        }
        if library.kind.trim().is_empty() {
            library.kind = default_kind.to_string();
        }
        if library.source_type.trim().is_empty() {
            library.source_type = default_source_type.to_string();
        }
        if library.platforms.is_empty() && !library.platform.trim().is_empty() {
            library.platforms.push(library.platform.trim().to_string());
        }
        library.platforms = unique_trimmed(library.platforms);
        library.commands = library
            .commands
            .into_iter()
            .filter_map(|entry| normalize_portable_entry(entry))
            .collect();
        Ok(library)
    }

    fn insert_library_with_commands(
        &self,
        conn: &mut Connection,
        library: &PortableCommandLibrary,
    ) -> Result<(), String> {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT OR IGNORE INTO command_libraries
             (id, label, kind, source_type, platforms, language, enabled, schema_version, seed_version)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                library.id,
                library.label,
                library.kind,
                library.source_type,
                json_string(&library.platforms),
                library.language,
                bool_to_int(library.enabled),
                library.schema_version.unwrap_or(2),
                DB_VERSION,
            ],
        )
        .map_err(|e| e.to_string())?;

        let mut stmt = tx
            .prepare(
                "INSERT OR IGNORE INTO commands
                 (library_id, command_key, name, alias, name_cn, description, usage, category, command, tags, examples, hint, language, triggers, keywords, weight, enabled)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
            )
            .map_err(|e| e.to_string())?;

        for entry in &library.commands {
            stmt.execute(params![
                library.id,
                entry.command_key,
                entry.name,
                json_string(&entry.alias),
                entry.name_cn,
                entry.description,
                entry.usage,
                entry.category,
                entry.command,
                json_string(&entry.tags),
                json_string(&entry.examples),
                entry.hint,
                entry.language,
                json_string(&entry.triggers),
                json_string(&entry.keywords),
                entry.weight,
                bool_to_int(entry.enabled),
            ])
            .map_err(|e| e.to_string())?;
        }

        drop(stmt);
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    fn replace_library_from_portable(
        &self,
        conn: &mut Connection,
        library: &PortableCommandLibrary,
    ) -> Result<(), String> {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO command_libraries
             (id, label, kind, source_type, platforms, language, enabled, schema_version, seed_version, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, datetime('now'), datetime('now'))
             ON CONFLICT(id) DO UPDATE SET
                label = excluded.label,
                kind = excluded.kind,
                source_type = excluded.source_type,
                platforms = excluded.platforms,
                language = excluded.language,
                enabled = excluded.enabled,
                schema_version = excluded.schema_version,
                seed_version = excluded.seed_version,
                updated_at = datetime('now')",
            params![
                library.id,
                library.label,
                library.kind,
                library.source_type,
                json_string(&library.platforms),
                library.language,
                bool_to_int(library.enabled),
                library.schema_version.unwrap_or(2),
                DB_VERSION,
            ],
        )
        .map_err(|e| e.to_string())?;

        tx.execute(
            "DELETE FROM commands WHERE library_id = ?1",
            params![library.id],
        )
        .map_err(|e| e.to_string())?;

        let mut stmt = tx
            .prepare(
                "INSERT INTO commands
                 (library_id, command_key, name, alias, name_cn, description, usage, category, command, tags, examples, hint, language, triggers, keywords, weight, enabled)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
            )
            .map_err(|e| e.to_string())?;

        for entry in &library.commands {
            stmt.execute(params![
                library.id,
                entry.command_key,
                entry.name,
                json_string(&entry.alias),
                entry.name_cn,
                entry.description,
                entry.usage,
                entry.category,
                entry.command,
                json_string(&entry.tags),
                json_string(&entry.examples),
                entry.hint,
                entry.language,
                json_string(&entry.triggers),
                json_string(&entry.keywords),
                entry.weight,
                bool_to_int(entry.enabled),
            ])
            .map_err(|e| e.to_string())?;
        }

        drop(stmt);
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_command_libraries(&self) -> Result<Vec<CommandLibrarySummary>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let current_platforms = crate::commands::get_platforms();
        let mut stmt = conn
            .prepare(
                "SELECT l.id, l.label, l.kind, l.source_type, l.platforms, l.language, l.enabled, COUNT(c.id) AS command_count
                 FROM command_libraries l
                 LEFT JOIN commands c ON c.library_id = l.id
                 GROUP BY l.id
                 ORDER BY CASE WHEN l.kind = 'system' THEN 0 ELSE 1 END, l.label, l.id",
            )
            .map_err(|e| e.to_string())?;

        let libraries = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let platforms_json: String = row.get(4)?;
                let platforms = parse_json_vec(&platforms_json);
                Ok(CommandLibrarySummary {
                    current: current_platforms.contains(&id),
                    id,
                    label: row.get(1)?,
                    kind: row.get(2)?,
                    source_type: row.get(3)?,
                    platforms,
                    language: row.get(5)?,
                    enabled: row.get::<_, i64>(6)? != 0,
                    command_count: row.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|item| item.ok())
            .collect();

        Ok(libraries)
    }

    pub fn create_command_library(
        &self,
        payload: CommandLibraryPayload,
    ) -> Result<CommandLibrarySummary, String> {
        if payload.id.trim().is_empty() {
            return Err("library id is required".to_string());
        }
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO command_libraries (id, label, kind, source_type, platforms, language, enabled, schema_version, seed_version)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                payload.id.trim(),
                if payload.label.trim().is_empty() {
                    payload.id.trim()
                } else {
                    payload.label.trim()
                },
                fallback_str(&payload.kind, "custom"),
                fallback_str(&payload.source_type, "user"),
                json_string(&unique_trimmed(payload.platforms)),
                payload.language.trim(),
                bool_to_int(payload.enabled),
                2,
                DB_VERSION,
            ],
        )
        .map_err(|e| format!("create library failed: {e}"))?;
        drop(conn);
        self.get_library_summary(payload.id.trim())
    }

    pub fn update_command_library(
        &self,
        payload: CommandLibraryPayload,
    ) -> Result<CommandLibrarySummary, String> {
        if payload.id.trim().is_empty() {
            return Err("library id is required".to_string());
        }
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let changed = conn
            .execute(
                "UPDATE command_libraries
                 SET label = ?2,
                     kind = ?3,
                     source_type = ?4,
                     platforms = ?5,
                     language = ?6,
                     enabled = ?7,
                     updated_at = datetime('now')
                 WHERE id = ?1",
                params![
                    payload.id.trim(),
                    if payload.label.trim().is_empty() {
                        payload.id.trim()
                    } else {
                        payload.label.trim()
                    },
                    fallback_str(&payload.kind, "custom"),
                    fallback_str(&payload.source_type, "user"),
                    json_string(&unique_trimmed(payload.platforms)),
                    payload.language.trim(),
                    bool_to_int(payload.enabled),
                ],
            )
            .map_err(|e| format!("update library failed: {e}"))?;
        if changed == 0 {
            return Err(format!("library '{}' not found", payload.id.trim()));
        }
        drop(conn);
        self.get_library_summary(payload.id.trim())
    }

    pub fn delete_command_library(&self, library_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let changed = conn
            .execute(
                "DELETE FROM command_libraries WHERE id = ?1",
                params![library_id],
            )
            .map_err(|e| format!("delete library failed: {e}"))?;
        if changed == 0 {
            return Err(format!("library '{library_id}' not found"));
        }
        Ok(())
    }

    pub fn query_command_summaries(
        &self,
        params: CommandQueryParams,
    ) -> Result<CommandSummaryPage, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let page = params.page.unwrap_or(1).max(1);
        let page_size = params.page_size.unwrap_or(DEFAULT_PAGE_SIZE).clamp(1, 500);
        let offset = (page - 1) * page_size;

        let mut where_sql = Vec::new();
        let mut values: Vec<Box<dyn ToSql>> = Vec::new();

        if let Some(library_id) = params.library_id.filter(|v| !v.trim().is_empty()) {
            push_where(
                &mut where_sql,
                &mut values,
                "c.library_id = ?",
                library_id.trim().to_string(),
            );
        }
        if let Some(kind) = params.kind.filter(|v| !v.trim().is_empty()) {
            push_where(
                &mut where_sql,
                &mut values,
                "l.kind = ?",
                kind.trim().to_string(),
            );
        }
        if let Some(category) = params.category.filter(|v| !v.trim().is_empty()) {
            push_where(
                &mut where_sql,
                &mut values,
                "c.category = ?",
                category.trim().to_string(),
            );
        }
        if params.enabled_only.unwrap_or(false) {
            where_sql.push("c.enabled = 1".to_string());
            where_sql.push("l.enabled = 1".to_string());
        }
        if let Some(keyword) = params.keyword.filter(|v| !v.trim().is_empty()) {
            let escaped = format!("%{}%", escape_like(&keyword));
            let start = values.len() + 1;
            where_sql.push(format!(
                "(c.name LIKE ?{start} ESCAPE '\\' OR c.name_cn LIKE ?{} ESCAPE '\\' OR c.description LIKE ?{} ESCAPE '\\' OR c.command LIKE ?{} ESCAPE '\\' OR c.category LIKE ?{} ESCAPE '\\')",
                start + 1,
                start + 2,
                start + 3,
                start + 4,
            ));
            for _ in 0..5 {
                values.push(Box::new(escaped.clone()));
            }
        }

        let where_clause = join_where(&where_sql);
        let count_sql = format!(
            "SELECT COUNT(*) FROM commands c JOIN command_libraries l ON l.id = c.library_id{where_clause}"
        );
        let data_sql = format!(
            "SELECT c.id, c.library_id, c.command_key, c.name, c.alias, c.name_cn, c.description, c.usage, c.category, c.command, c.tags, c.examples, c.hint, c.language, c.triggers, c.keywords, c.weight, c.enabled, l.kind, l.source_type, l.label
             FROM commands c
             JOIN command_libraries l ON l.id = c.library_id
             {where_clause}
             ORDER BY c.category, c.name
             LIMIT ?{} OFFSET ?{}",
            values.len() + 1,
            values.len() + 2
        );

        let count_refs = boxed_params(&values);
        let total = conn
            .query_row(&count_sql, params_from_iter(count_refs), |row| {
                row.get::<_, i64>(0)
            })
            .map_err(|e| e.to_string())?;

        values.push(Box::new(page_size));
        values.push(Box::new(offset));
        let data_refs = boxed_params(&values);
        let mut stmt = conn.prepare(&data_sql).map_err(|e| e.to_string())?;
        let items = stmt
            .query_map(params_from_iter(data_refs), row_to_command_summary)
            .map_err(|e| e.to_string())?
            .filter_map(|item| item.ok())
            .collect();

        Ok(CommandSummaryPage {
            items,
            total,
            page,
            page_size,
        })
    }

    pub fn search_command_summaries(
        &self,
        params: CommandSearchParams,
    ) -> Result<Vec<CommandSummary>, String> {
        let keyword = params.keyword.trim();
        if keyword.is_empty() {
            return Ok(Vec::new());
        }

        let limit = params.limit.unwrap_or(DEFAULT_SEARCH_LIMIT).clamp(1, 100);
        let enabled_only = params.enabled_only.unwrap_or(true);
        let current_platforms = crate::commands::get_platforms();
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut where_sql = Vec::new();
        let exact = keyword.to_string();
        let prefix = format!("{}%", escape_like(keyword));
        let contains = format!("%{}%", escape_like(keyword));
        let mut values: Vec<Box<dyn ToSql>> =
            vec![Box::new(exact), Box::new(prefix), Box::new(contains)];

        if enabled_only {
            where_sql.push("c.enabled = 1".to_string());
            where_sql.push("l.enabled = 1".to_string());
        }

        let mut active_clause_parts = vec!["l.kind != 'system'".to_string()];
        if !current_platforms.is_empty() {
            let placeholders = (0..current_platforms.len())
                .map(|index| format!("?{}", values.len() + index + 1))
                .collect::<Vec<_>>()
                .join(", ");
            active_clause_parts.push(format!("l.id IN ({placeholders})"));
            for platform in current_platforms {
                values.push(Box::new(platform));
            }
        }
        where_sql.push(format!("({})", active_clause_parts.join(" OR ")));

        if let Some(library_ids) = params.library_ids {
            let library_ids = library_ids
                .into_iter()
                .map(|item| item.trim().to_string())
                .filter(|item| !item.is_empty())
                .collect::<Vec<_>>();
            if !library_ids.is_empty() {
                let placeholders = library_ids
                    .iter()
                    .enumerate()
                    .map(|(index, _)| format!("?{}", values.len() + index + 1))
                    .collect::<Vec<_>>()
                    .join(", ");
                where_sql.push(format!("c.library_id IN ({placeholders})"));
                for id in library_ids {
                    values.push(Box::new(id));
                }
            }
        }

        let filter_clause = if where_sql.is_empty() {
            String::new()
        } else {
            format!(" AND {}", where_sql.join(" AND "))
        };

        let fts_query = split_search_terms(keyword)
            .into_iter()
            .map(|token| format!("\"{}\"*", token.replace('"', "")))
            .collect::<Vec<_>>()
            .join(" ");
        let fts_placeholder = format!("?{}", values.len() + 1);
        values.push(Box::new(fts_query));

        let sql = format!(
            "SELECT c.id, c.library_id, c.command_key, c.name, c.alias, c.name_cn, c.description, c.usage, c.category, c.command, c.tags, c.examples, c.hint, c.language, c.triggers, c.keywords, c.weight, c.enabled, l.kind, l.source_type, l.label
             FROM commands c
             JOIN command_libraries l ON l.id = c.library_id
             JOIN commands_fts fts ON fts.rowid = c.id
             WHERE commands_fts MATCH {fts_placeholder}{filter_clause}
             ORDER BY (
                 CASE
                     WHEN lower(c.name) = lower(?1) THEN 500
                     WHEN lower(c.command) = lower(?1) THEN 480
                     WHEN lower(c.command_key) = lower(?1) THEN 460
                     ELSE 0
                 END
                 + CASE WHEN lower(c.name) LIKE lower(?2) ESCAPE '\\' THEN 220 ELSE 0 END
                 + CASE WHEN lower(c.command) LIKE lower(?2) ESCAPE '\\' THEN 210 ELSE 0 END
                 + CASE WHEN lower(c.command_key) LIKE lower(?2) ESCAPE '\\' THEN 200 ELSE 0 END
                 + CASE WHEN lower(c.alias) LIKE lower(?3) ESCAPE '\\' THEN 170 ELSE 0 END
                 + CASE WHEN lower(c.triggers) LIKE lower(?3) ESCAPE '\\' THEN 160 ELSE 0 END
                 + CASE WHEN lower(c.keywords) LIKE lower(?3) ESCAPE '\\' THEN 150 ELSE 0 END
                 + CASE WHEN lower(c.name_cn) LIKE lower(?3) ESCAPE '\\' THEN 140 ELSE 0 END
                 + CASE WHEN lower(c.description) LIKE lower(?3) ESCAPE '\\' THEN 110 ELSE 0 END
                 + CASE WHEN lower(c.category) LIKE lower(?3) ESCAPE '\\' THEN 90 ELSE 0 END
                 + CASE WHEN lower(c.usage) LIKE lower(?3) ESCAPE '\\' THEN 80 ELSE 0 END
                 + CASE WHEN lower(c.examples) LIKE lower(?3) ESCAPE '\\' THEN 70 ELSE 0 END
                 + c.weight
             ) DESC, c.name ASC
             LIMIT ?{}",
            values.len() + 1
        );

        values.push(Box::new(limit));
        let param_refs = boxed_params(&values);
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let items = stmt
            .query_map(params_from_iter(param_refs), row_to_command_summary)
            .map_err(|e| e.to_string())?
            .filter_map(|item| item.ok())
            .collect();
        Ok(items)
    }

    pub fn get_command_detail(&self, id: i64) -> Result<Option<CommandDetail>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let result = conn
            .query_row(
                "SELECT c.id, c.library_id, c.command_key, c.name, c.alias, c.name_cn, c.description, c.usage, c.category, c.command, c.tags, c.examples, c.hint, c.language, c.triggers, c.keywords, c.weight, c.enabled, l.kind, l.source_type, l.label
                 FROM commands c
                 JOIN command_libraries l ON l.id = c.library_id
                 WHERE c.id = ?1",
                params![id],
                row_to_command_detail,
            )
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(result)
    }

    pub fn create_command(&self, payload: CommandPayload) -> Result<CommandDetail, String> {
        self.ensure_library_exists(&payload.library_id)?;
        let normalized = normalize_command_payload(payload, None);
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO commands
             (library_id, command_key, name, alias, name_cn, description, usage, category, command, tags, examples, hint, language, triggers, keywords, weight, enabled)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
            params![
                normalized.library_id,
                normalized.command_key,
                normalized.name,
                json_string(&normalized.alias),
                normalized.name_cn,
                normalized.description,
                normalized.usage,
                normalized.category,
                normalized.command,
                json_string(&normalized.tags),
                json_string(&normalized.examples),
                normalized.hint,
                normalized.language,
                json_string(&normalized.triggers),
                json_string(&normalized.keywords),
                normalized.weight,
                bool_to_int(normalized.enabled),
            ],
        )
        .map_err(|e| format!("create command failed: {e}"))?;
        let id = conn.last_insert_rowid();
        drop(conn);
        self.get_command_detail(id)?
            .ok_or_else(|| "created command could not be loaded".to_string())
    }

    pub fn update_command(&self, payload: CommandPayload) -> Result<CommandDetail, String> {
        let id = payload
            .id
            .ok_or_else(|| "command id is required".to_string())?;
        self.ensure_library_exists(&payload.library_id)?;
        let existing = self
            .get_command_detail(id)?
            .ok_or_else(|| format!("command '{id}' not found"))?;
        let normalized = normalize_command_payload(payload, Some(&existing));
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let changed = conn
            .execute(
                "UPDATE commands
                 SET library_id = ?1,
                     command_key = ?2,
                     name = ?3,
                     alias = ?4,
                     name_cn = ?5,
                     description = ?6,
                     usage = ?7,
                     category = ?8,
                     command = ?9,
                     tags = ?10,
                     examples = ?11,
                     hint = ?12,
                     language = ?13,
                     triggers = ?14,
                     keywords = ?15,
                     weight = ?16,
                     enabled = ?17,
                     updated_at = datetime('now')
                 WHERE id = ?18",
                params![
                    normalized.library_id,
                    normalized.command_key,
                    normalized.name,
                    json_string(&normalized.alias),
                    normalized.name_cn,
                    normalized.description,
                    normalized.usage,
                    normalized.category,
                    normalized.command,
                    json_string(&normalized.tags),
                    json_string(&normalized.examples),
                    normalized.hint,
                    normalized.language,
                    json_string(&normalized.triggers),
                    json_string(&normalized.keywords),
                    normalized.weight,
                    bool_to_int(normalized.enabled),
                    id,
                ],
            )
            .map_err(|e| format!("update command failed: {e}"))?;
        if changed == 0 {
            return Err(format!("command '{id}' not found"));
        }
        drop(conn);
        self.get_command_detail(id)?
            .ok_or_else(|| "updated command could not be loaded".to_string())
    }

    pub fn delete_command(&self, id: i64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let changed = conn
            .execute("DELETE FROM commands WHERE id = ?1", params![id])
            .map_err(|e| format!("delete command failed: {e}"))?;
        if changed == 0 {
            return Err(format!("command '{id}' not found"));
        }
        Ok(())
    }

    pub fn import_command_library(&self, json: &str) -> Result<CommandLibrarySummary, String> {
        let mut library = self.parse_portable_library(json, "custom", "imported")?;
        if library.source_type == "builtin" {
            library.source_type = "imported".to_string();
        }
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        self.replace_library_from_portable(&mut conn, &library)?;
        drop(conn);
        self.get_library_summary(&library.id)
    }

    pub fn export_command_library(&self, library_id: &str) -> Result<String, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let library = conn
            .query_row(
                "SELECT id, label, kind, source_type, platforms, language, enabled
                 FROM command_libraries
                 WHERE id = ?1",
                params![library_id],
                |row| {
                    Ok(PortableCommandLibrary {
                        schema_version: Some(2),
                        id: row.get(0)?,
                        label: row.get(1)?,
                        kind: row.get(2)?,
                        source_type: row.get(3)?,
                        platforms: parse_json_vec(&row.get::<_, String>(4)?),
                        platform: String::new(),
                        language: row.get(5)?,
                        enabled: row.get::<_, i64>(6)? != 0,
                        commands: Vec::new(),
                    })
                },
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("library '{library_id}' not found"))?;

        let mut stmt = conn
            .prepare(
                "SELECT command_key, name, alias, name_cn, description, usage, category, command, tags, examples, hint, language, triggers, keywords, weight, enabled
                 FROM commands
                 WHERE library_id = ?1
                 ORDER BY category, name",
            )
            .map_err(|e| e.to_string())?;
        let commands = stmt
            .query_map(params![library_id], |row| {
                Ok(PortableCommandEntry {
                    command_key: row.get(0)?,
                    name: row.get(1)?,
                    alias: parse_json_vec(&row.get::<_, String>(2)?),
                    name_cn: row.get(3)?,
                    description: row.get(4)?,
                    usage: row.get(5)?,
                    category: row.get(6)?,
                    command: row.get(7)?,
                    tags: parse_json_vec(&row.get::<_, String>(8)?),
                    examples: parse_json_vec(&row.get::<_, String>(9)?),
                    hint: row.get(10)?,
                    language: row.get(11)?,
                    triggers: parse_json_vec(&row.get::<_, String>(12)?),
                    keywords: parse_json_vec(&row.get::<_, String>(13)?),
                    weight: row.get(14)?,
                    enabled: row.get::<_, i64>(15)? != 0,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|item| item.ok())
            .collect::<Vec<_>>();

        let portable = PortableCommandLibrary {
            commands,
            ..library
        };
        serde_json::to_string_pretty(&portable).map_err(|e| e.to_string())
    }

    pub fn reset_builtin_library(&self, library_id: &str) -> Result<CommandLibrarySummary, String> {
        let (_, kind, source_type, content) = bundled_seeds()
            .into_iter()
            .find(|(id, _, _, _)| *id == library_id)
            .ok_or_else(|| format!("builtin library '{library_id}' not found"))?;
        let library = self.parse_portable_library(content, kind, source_type)?;
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        self.replace_library_from_portable(&mut conn, &library)?;
        drop(conn);
        self.get_library_summary(library_id)
    }

    fn get_library_summary(&self, library_id: &str) -> Result<CommandLibrarySummary, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let current_platforms = crate::commands::get_platforms();
        conn.query_row(
            "SELECT l.id, l.label, l.kind, l.source_type, l.platforms, l.language, l.enabled, COUNT(c.id) AS command_count
             FROM command_libraries l
             LEFT JOIN commands c ON c.library_id = l.id
             WHERE l.id = ?1
             GROUP BY l.id",
            params![library_id],
            |row| {
                let id: String = row.get(0)?;
                Ok(CommandLibrarySummary {
                    current: current_platforms.contains(&id),
                    id,
                    label: row.get(1)?,
                    kind: row.get(2)?,
                    source_type: row.get(3)?,
                    platforms: parse_json_vec(&row.get::<_, String>(4)?),
                    language: row.get(5)?,
                    enabled: row.get::<_, i64>(6)? != 0,
                    command_count: row.get(7)?,
                })
            },
        )
        .map_err(|e| e.to_string())
    }

    fn ensure_library_exists(&self, library_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let exists = conn
            .query_row(
                "SELECT 1 FROM command_libraries WHERE id = ?1 LIMIT 1",
                params![library_id],
                |_| Ok(()),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .is_some();
        if exists {
            Ok(())
        } else {
            Err(format!("library '{library_id}' not found"))
        }
    }

    pub fn list_favorites(&self, ssh_profile_id: &str) -> Result<Vec<TerminalFavoriteRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, ssh_profile_id, path, name, icon, color, sort_order
                 FROM terminal_favorites
                 WHERE ssh_profile_id = ?1
                 ORDER BY sort_order, id",
            )
            .map_err(|e| e.to_string())?;
        let items = stmt
            .query_map(params![ssh_profile_id], |row| {
                Ok(TerminalFavoriteRecord {
                    id: row.get(0)?,
                    ssh_profile_id: row.get(1)?,
                    path: row.get(2)?,
                    name: row.get(3)?,
                    icon: row.get(4)?,
                    color: row.get(5)?,
                    sort_order: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|item| item.ok())
            .collect();
        Ok(items)
    }

    pub fn add_favorite(
        &self,
        ssh_profile_id: &str,
        path: &str,
        name: &str,
        icon: &str,
        color: &str,
    ) -> Result<i64, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        // 计算下一个 sort_order：当前 ssh_profile_id 下最大 sort_order + 1
        let max_order: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(sort_order), -1) FROM terminal_favorites WHERE ssh_profile_id = ?1",
                params![ssh_profile_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO terminal_favorites (ssh_profile_id, path, name, icon, color, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![ssh_profile_id, path, name, icon, color, max_order + 1],
        )
        .map_err(|e| format!("add favorite failed: {e}"))?;
        Ok(conn.last_insert_rowid())
    }

    pub fn remove_favorite(&self, ssh_profile_id: &str, path: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM terminal_favorites WHERE ssh_profile_id = ?1 AND path = ?2",
            params![ssh_profile_id, path],
        )
        .map_err(|e| format!("remove favorite failed: {e}"))?;
        Ok(())
    }

    pub fn update_favorite(&self, id: i64, name: &str, icon: &str, color: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let changed = conn
            .execute(
                "UPDATE terminal_favorites
                 SET name = ?2, icon = ?3, color = ?4
                 WHERE id = ?1",
                params![id, name, icon, color],
            )
            .map_err(|e| format!("update favorite failed: {e}"))?;
        if changed == 0 {
            return Err(format!("favorite '{id}' not found"));
        }
        Ok(())
    }

    pub fn reorder_favorites(
        &self,
        ssh_profile_id: &str,
        ordered_ids: &[i64],
    ) -> Result<(), String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        for (index, id) in ordered_ids.iter().enumerate() {
            tx.execute(
                "UPDATE terminal_favorites SET sort_order = ?1 WHERE id = ?2 AND ssh_profile_id = ?3",
                params![index as i64, id, ssh_profile_id],
            )
            .map_err(|e| format!("reorder favorite failed: {e}"))?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }
}

fn normalize_portable_entry(mut entry: PortableCommandEntry) -> Option<PortableCommandEntry> {
    let command = if entry.command.trim().is_empty() {
        entry.name.trim().to_string()
    } else {
        entry.command.trim().to_string()
    };
    let name = if entry.name.trim().is_empty() {
        command.clone()
    } else {
        entry.name.trim().to_string()
    };
    if name.is_empty() {
        return None;
    }

    entry.command = command.clone();
    entry.name = name.clone();
    entry.alias = unique_trimmed(entry.alias);
    entry.tags = unique_trimmed(entry.tags);
    entry.examples = unique_trimmed(entry.examples);
    entry.triggers = unique_trimmed(entry.triggers);
    entry.keywords = unique_trimmed(entry.keywords);
    if entry.usage.trim().is_empty() {
        entry.usage = command;
    } else {
        entry.usage = entry.usage.trim().to_string();
    }
    entry.category = entry.category.trim().to_string();
    entry.name_cn = entry.name_cn.trim().to_string();
    entry.description = entry.description.trim().to_string();
    entry.hint = entry.hint.trim().to_string();
    entry.language = entry.language.trim().to_string();
    if entry.examples.is_empty() {
        entry.examples = generate_examples_for_entry(&entry);
    }
    if entry.command_key.trim().is_empty() {
        entry.command_key = slugify(&format!("{name} {}", entry.command));
    } else {
        entry.command_key = slugify(&entry.command_key);
    }
    if entry.command_key.is_empty() {
        entry.command_key = slugify(&name);
    }
    Some(entry)
}

fn generate_examples_for_entry(entry: &PortableCommandEntry) -> Vec<String> {
    let usage = entry.usage.trim();
    let command = entry.command.trim();
    let primary = if !usage.is_empty() { usage } else { command };
    if primary.is_empty() {
        return Vec::new();
    }

    let sample = fill_placeholders(primary);
    let prefix = command_prefix(command, primary);
    let help = if prefix.is_empty() {
        String::new()
    } else {
        format!("{prefix} --help")
    };

    let mut examples = Vec::new();
    examples.push(format!("{sample} # 基础用法"));
    if !help.is_empty() && help != sample {
        examples.push(format!("{help} # 查看帮助"));
    }
    if !command.is_empty() && command != sample && command != prefix {
        examples.push(format!("{command} # 命令模板"));
    } else if !prefix.is_empty() && prefix != sample {
        examples.push(format!("{prefix} # 常用入口"));
    }

    unique_trimmed(examples)
}

fn command_prefix(command: &str, usage: &str) -> String {
    let source = if !command.trim().is_empty() {
        command.trim()
    } else {
        usage.trim()
    };
    let prefix = source
        .split_whitespace()
        .take_while(|token| !token.starts_with('<') && !token.starts_with('['))
        .collect::<Vec<_>>()
        .join(" ");
    if prefix.is_empty() {
        source
            .split_whitespace()
            .next()
            .unwrap_or_default()
            .to_string()
    } else {
        prefix
    }
}

fn fill_placeholders(value: &str) -> String {
    let mut result = value.to_string();
    let replacements = [
        ("package", "example-package"),
        ("pkg", "example-package"),
        ("service", "nginx"),
        ("container", "app"),
        ("image", "nginx:latest"),
        ("port", "3000"),
        ("pid", "12345"),
        ("path", "./"),
        ("dir", "./"),
        ("directory", "./"),
        ("file", "./app.log"),
        ("branch", "main"),
        ("env", "dev"),
        ("environment", "dev"),
        ("url", "https://example.com"),
        ("profile", "default"),
        ("name", "demo"),
        ("namespace", "default"),
        ("pod", "app-0"),
        ("tag", "latest"),
        ("version", "1.0.0"),
        ("archive", "archive.tar.gz"),
        ("host", "127.0.0.1"),
        ("user", "root"),
    ];

    for (pattern, replacement) in replacements {
        result = result.replace(&format!("<{pattern}>"), replacement);
        result = result.replace(&format!("[{pattern}]"), replacement);
    }

    result
}

fn normalize_command_payload(
    payload: CommandPayload,
    existing: Option<&CommandDetail>,
) -> CommandPayload {
    let mut normalized = payload;
    let command = if normalized.command.trim().is_empty() {
        normalized.name.trim().to_string()
    } else {
        normalized.command.trim().to_string()
    };
    let name = if normalized.name.trim().is_empty() {
        command.clone()
    } else {
        normalized.name.trim().to_string()
    };
    normalized.name = name.clone();
    normalized.command = command.clone();
    normalized.alias = unique_trimmed(normalized.alias);
    normalized.tags = unique_trimmed(normalized.tags);
    normalized.examples = unique_trimmed(normalized.examples);
    normalized.triggers = unique_trimmed(normalized.triggers);
    normalized.keywords = unique_trimmed(normalized.keywords);
    normalized.name_cn = normalized.name_cn.trim().to_string();
    normalized.description = normalized.description.trim().to_string();
    normalized.category = normalized.category.trim().to_string();
    normalized.hint = normalized.hint.trim().to_string();
    normalized.language = normalized.language.trim().to_string();
    normalized.usage = if normalized.usage.trim().is_empty() {
        command
    } else {
        normalized.usage.trim().to_string()
    };
    normalized.command_key = if normalized.command_key.trim().is_empty() {
        existing
            .map(|value| value.command_key.clone())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| slugify(&format!("{} {}", normalized.name, normalized.command)))
    } else {
        slugify(&normalized.command_key)
    };
    normalized
}

fn row_to_command_summary(row: &rusqlite::Row<'_>) -> Result<CommandSummary, rusqlite::Error> {
    let examples = parse_json_vec(&row.get::<_, String>(11)?);
    Ok(CommandSummary {
        id: row.get(0)?,
        library_id: row.get(1)?,
        command_key: row.get(2)?,
        name: row.get(3)?,
        alias: parse_json_vec(&row.get::<_, String>(4)?),
        name_cn: row.get(5)?,
        description: row.get(6)?,
        usage: row.get(7)?,
        category: row.get(8)?,
        command: row.get(9)?,
        tags: parse_json_vec(&row.get::<_, String>(10)?),
        hint: row.get(12)?,
        language: row.get(13)?,
        triggers: parse_json_vec(&row.get::<_, String>(14)?),
        keywords: parse_json_vec(&row.get::<_, String>(15)?),
        weight: row.get(16)?,
        enabled: row.get::<_, i64>(17)? != 0,
        example_count: examples.len(),
        first_example: examples.first().cloned(),
        library_kind: row.get(18)?,
        source_type: row.get(19)?,
        library_label: row.get(20)?,
    })
}

fn row_to_command_detail(row: &rusqlite::Row<'_>) -> Result<CommandDetail, rusqlite::Error> {
    Ok(CommandDetail {
        id: row.get(0)?,
        library_id: row.get(1)?,
        command_key: row.get(2)?,
        name: row.get(3)?,
        alias: parse_json_vec(&row.get::<_, String>(4)?),
        name_cn: row.get(5)?,
        description: row.get(6)?,
        usage: row.get(7)?,
        category: row.get(8)?,
        command: row.get(9)?,
        tags: parse_json_vec(&row.get::<_, String>(10)?),
        examples: parse_json_vec(&row.get::<_, String>(11)?),
        hint: row.get(12)?,
        language: row.get(13)?,
        triggers: parse_json_vec(&row.get::<_, String>(14)?),
        keywords: parse_json_vec(&row.get::<_, String>(15)?),
        weight: row.get(16)?,
        enabled: row.get::<_, i64>(17)? != 0,
        library_kind: row.get(18)?,
        source_type: row.get(19)?,
        library_label: row.get(20)?,
    })
}

fn boxed_params(values: &[Box<dyn ToSql>]) -> Vec<&dyn ToSql> {
    values.iter().map(|value| value.as_ref()).collect()
}

fn parse_json_vec(value: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(value)
        .unwrap_or_default()
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect()
}

fn json_string(values: &[String]) -> String {
    serde_json::to_string(values).unwrap_or_else(|_| "[]".to_string())
}

fn unique_trimmed(values: Vec<String>) -> Vec<String> {
    let mut deduped = Vec::new();
    for value in values {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !deduped.iter().any(|existing: &String| existing == trimmed) {
            deduped.push(trimmed.to_string());
        }
    }
    deduped
}

fn bool_to_int(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

fn fallback_str<'a>(value: &'a str, fallback: &'a str) -> &'a str {
    if value.trim().is_empty() {
        fallback
    } else {
        value.trim()
    }
}

fn push_where(
    where_sql: &mut Vec<String>,
    values: &mut Vec<Box<dyn ToSql>>,
    template: &str,
    value: String,
) {
    let placeholder = format!("?{}", values.len() + 1);
    where_sql.push(template.replacen('?', &placeholder, 1));
    values.push(Box::new(value));
}

fn join_where(clauses: &[String]) -> String {
    if clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", clauses.join(" AND "))
    }
}

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn split_search_terms(keyword: &str) -> Vec<String> {
    keyword
        .split(|ch: char| {
            ch.is_whitespace()
                || matches!(
                    ch,
                    '-' | '_'
                        | '/'
                        | '\\'
                        | '.'
                        | ':'
                        | ','
                        | ';'
                        | '('
                        | ')'
                        | '['
                        | ']'
                        | '{'
                        | '}'
                )
        })
        .map(|part| part.trim_matches(|ch: char| ch == '"' || ch == '\''))
        .filter(|part| !part.is_empty())
        .map(|part| part.to_string())
        .collect::<Vec<_>>()
}

fn slugify(value: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash {
            slug.push('-');
            last_dash = true;
        }
    }
    slug.trim_matches('-').to_string()
}
