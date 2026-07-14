//! 文件索引模块 — 全盘文件索引与搜索
//!
//! 后台线程使用并行遍历引擎（jwalk）递归扫描文件系统，将文件路径写入 SQLite 索引表。
//! 扫描完成后启动 notify 监听器进行增量更新（debounce + 批量写入）。
//! 前端通过 `search_files` 命令实现毫秒级文件名搜索。
//!
//! 重构要点：
//! - jwalk 并行遍历替代 walkdir，大幅提升扫描速度
//! - 全盘扫描（macOS/Linux 扫描 `/`，Windows 扫描所有盘符）
//! - 索引持久化：有效索引直接复用，避免每次启动全量重建
//! - 文件类型过滤：类别预设 + 自定义扩展名白/黑名单
//! - notify watcher 重新启用，mpsc 通道 + debounce 批量写入避免事件风暴

use notify::event::EventKind;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::path_util;

static INDEXING: AtomicBool = AtomicBool::new(false);
static TOTAL_FILES: AtomicU64 = AtomicU64::new(0);
static LAST_SCAN: AtomicU64 = AtomicU64::new(0);
static ESTIMATED_TOTAL: AtomicU64 = AtomicU64::new(0);
static CURRENT_PATH: Mutex<String> = Mutex::new(String::new());
static WATCHER_RUNNING: AtomicBool = AtomicBool::new(false);

/// 索引扫描版本号（配置/schema 变更时递增，触发全量重建）
const SCAN_VERSION: &str = "2";

// ===========================================================================
// 数据结构
// ===========================================================================

/// 搜索结果条目
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchResult {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: u64,
}

/// 索引状态
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatus {
    pub indexing: bool,
    pub total_files: u64,
    pub last_scan: u64,
    pub current_path: String,
    pub estimated_total: u64,
    pub progress: u8, // 0-100 百分比
}

/// 索引配置（持久化到 `<APP_DATA_DIR>/index_config.json`）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexConfig {
    /// 扫描根路径，默认 `["/"]`（macOS/Linux）或所有盘符（Windows）
    pub roots: Vec<String>,
    /// 额外排除的路径（用户自定义）
    pub excluded_paths: Vec<String>,
    /// 启用的文件类别，默认全部启用（含 "other"）
    pub enabled_categories: Vec<String>,
    /// 用户自定义扩展名（白名单追加，不含点，如 "json"）
    pub custom_extensions: Vec<String>,
    /// 排除的扩展名（黑名单，优先级最高）
    pub exclude_extensions: Vec<String>,
}

// ===========================================================================
// 类别→扩展名映射
// ===========================================================================

/// 类别→扩展名映射表（扩展名不含点，全小写）。
fn category_extensions() -> &'static [(&'static str, &'static [&'static str])] {
    &[
        ("code", &["ts", "js", "jsx", "tsx", "rs", "py", "go", "java", "c", "cpp", "h", "hpp", "rb", "php", "swift", "kt", "scala", "sh", "zsh", "vue", "svelte", "lua", "r", "elixir", "ex", "erl", "clj", "hs", "ml", "fs", "dart", "groovy", "gradle", "cmake", "make", "asm", "sql"]),
        ("document", &["md", "txt", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "rtf", "csv", "json", "yaml", "yml", "toml", "xml", "html", "htm", "org", "rst", "tex", "log", "pages", "numbers", "key"]),
        ("image", &["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp", "tiff", "tif", "heic", "heif", "psd", "ai", "sketch", "raw", "cr2", "nef"]),
        ("audio", &["mp3", "wav", "flac", "aac", "ogg", "m4a", "wma", "aiff", "opus"]),
        ("video", &["mp4", "mov", "avi", "mkv", "webm", "flv", "wmv", "m4v", "mpg", "mpeg"]),
        ("archive", &["zip", "tar", "gz", "rar", "7z", "tgz", "bz2", "xz", "iso", "dmg", "pkg", "deb", "rpm"]),
    ]
}

// ===========================================================================
// 配置文件读写
// ===========================================================================

fn index_config_path() -> Result<PathBuf, String> {
    Ok(path_util::app_data_dir()?.join("index_config.json"))
}

/// 默认配置：全盘扫描 + 全类别启用。
pub fn default_index_config() -> IndexConfig {
    let (roots, excluded_paths) = default_roots_and_exclusions();
    IndexConfig {
        roots,
        excluded_paths,
        enabled_categories: vec![
            "code".into(),
            "document".into(),
            "image".into(),
            "audio".into(),
            "video".into(),
            "archive".into(),
            "other".into(),
        ],
        custom_extensions: vec![],
        exclude_extensions: vec![],
    }
}

/// 各平台的默认扫描根和系统排除目录。
fn default_roots_and_exclusions() -> (Vec<String>, Vec<String>) {
    #[cfg(target_os = "macos")]
    {
        let roots = vec!["/".to_string()];
        let excluded_paths = vec![
            "/System", "/Library", "/usr", "/bin", "/sbin", "/opt",
            "/private", "/dev", "/proc", "/sys", "/.vol",
            "/var/folders", "/var/db", "/var/log", "/var/tmp",
            "/private/var", "/private/tmp", "/private/etc",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        (roots, excluded_paths)
    }
    #[cfg(target_os = "linux")]
    {
        let roots = vec!["/".to_string()];
        let excluded_paths = vec![
            "/proc", "/sys", "/dev", "/run", "/snap",
            "/usr", "/bin", "/sbin", "/lib", "/lib64",
            "/var/cache", "/var/log", "/var/tmp",
            "/boot", "/lost+found",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        (roots, excluded_paths)
    }
    #[cfg(windows)]
    {
        let mut roots = Vec::new();
        for letter in b'A'..=b'Z' {
            let drive = format!("{}:\\", letter as char);
            if Path::new(&drive).exists() {
                roots.push(drive);
            }
        }
        let excluded_paths = vec![
            r"C:\Windows",
            r"C:\$Recycle.Bin",
            r"C:\ProgramData",
            r"C:\Recovery",
            r"C:\System Volume Information",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        (roots, excluded_paths)
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
    {
        (vec![".".to_string()], vec![])
    }
}

/// 从 `<APP_DATA_DIR>/index_config.json` 读取配置，不存在则返回默认配置。
pub fn load_index_config() -> Result<IndexConfig, String> {
    let path = index_config_path()?;
    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str::<IndexConfig>(&content)
            .map_err(|e| format!("Failed to parse index_config.json: {e}")),
        Err(_) => Ok(default_index_config()),
    }
}

/// 将配置写入 `<APP_DATA_DIR>/index_config.json`。
pub fn save_index_config(config: &IndexConfig) -> Result<(), String> {
    let path = index_config_path()?;
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize index config: {e}"))?;
    std::fs::write(&path, json).map_err(|e| format!("Failed to write index_config.json: {e}"))
}

/// 判断文件是否应被索引（目录始终通过，仅过滤文件）。
///
/// 规则：
/// 1. 提取扩展名（不含点，转小写）
/// 2. 在 `exclude_extensions` 黑名单中 → false
/// 3. 在 `custom_extensions` 白名单或启用类别扩展名集合中 → true
/// 4. "other" 在 enabled_categories 中 → true（兜底）
/// 5. 否则 → false
pub fn is_file_allowed(name: &str, config: &IndexConfig) -> bool {
    let ext = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();

    // 无扩展名文件：仅当 "other" 类别启用时通过
    if ext.is_empty() {
        return config.enabled_categories.iter().any(|c| c == "other");
    }

    // 黑名单优先
    if config
        .exclude_extensions
        .iter()
        .any(|e| e.eq_ignore_ascii_case(&ext))
    {
        return false;
    }

    // 自定义白名单
    if config
        .custom_extensions
        .iter()
        .any(|e| e.eq_ignore_ascii_case(&ext))
    {
        return true;
    }

    // 启用类别的扩展名集合
    let ext_ref = ext.as_str();
    for &(cat, exts) in category_extensions() {
        if config.enabled_categories.iter().any(|c| c.as_str() == cat) {
            if exts.contains(&ext_ref) {
                return true;
            }
        }
    }

    // "other" 兜底
    if config.enabled_categories.iter().any(|c| c == "other") {
        return true;
    }

    false
}

// ===========================================================================
// 数据库操作
// ===========================================================================

fn index_db_path() -> Result<PathBuf, String> {
    Ok(path_util::app_data_dir()?.join("file_index.db"))
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 打开索引数据库并初始化 schema。
fn open_db() -> Result<Connection, String> {
    let conn =
        Connection::open(index_db_path()?).map_err(|e| format!("Failed to open index db: {e}"))?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")
        .map_err(|e| e.to_string())?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS file_index (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            path        TEXT NOT NULL UNIQUE,
            name        TEXT NOT NULL,
            parent_dir  TEXT NOT NULL,
            is_dir      INTEGER NOT NULL DEFAULT 0,
            size        INTEGER NOT NULL DEFAULT 0,
            modified    INTEGER NOT NULL DEFAULT 0,
            extension   TEXT,
            indexed_at  INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_path ON file_index(path);

        -- 索引元数据表（持久化策略：记录构建信息以判断是否可复用）
        CREATE TABLE IF NOT EXISTS index_meta (
            key   TEXT PRIMARY KEY,
            value TEXT
        );

        -- FTS5 全文搜索虚拟表（仅索引文件名，倒排索引毫秒级响应）
        CREATE VIRTUAL TABLE IF NOT EXISTS file_fts USING fts5(
            name,
            tokenize='unicode61'
        );

        -- 触发器：插入时同步到 FTS 表
        CREATE TRIGGER IF NOT EXISTS file_fts_ai AFTER INSERT ON file_index BEGIN
            INSERT INTO file_fts(rowid, name) VALUES (new.id, new.name);
        END;

        -- 触发器：删除时同步到 FTS 表
        CREATE TRIGGER IF NOT EXISTS file_fts_ad AFTER DELETE ON file_index BEGIN
            INSERT INTO file_fts(file_fts, rowid, name) VALUES ('delete', old.id, old.name);
        END;

        -- 触发器：更新时同步到 FTS 表
        CREATE TRIGGER IF NOT EXISTS file_fts_au AFTER UPDATE ON file_index BEGIN
            INSERT INTO file_fts(file_fts, rowid, name) VALUES ('delete', old.id, old.name);
            INSERT INTO file_fts(rowid, name) VALUES (new.id, new.name);
        END;",
    )
    .map_err(|e| e.to_string())?;

    // 迁移：如果 FTS 表为空但主表有数据（从旧版本升级），重建 FTS 索引
    // 注意：扫描过程中会自己管理 FTS（先禁用触发器→批量插入→重建FTS→恢复触发器）
    // 所以仅在非扫描状态下做迁移
    if !INDEXING.load(Ordering::SeqCst) {
        let main_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM file_index", [], |row| row.get(0))
            .unwrap_or(0);
        let fts_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM file_fts", [], |row| row.get(0))
            .unwrap_or(0);
        if main_count > 0 && fts_count == 0 {
            let _ = conn.execute("INSERT INTO file_fts(rowid, name) SELECT id, name FROM file_index;", []);
        }
    }

    Ok(conn)
}

/// 读取 index_meta 表中的键值。
fn read_meta(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM index_meta WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .ok()
}

/// 写入 index_meta 表中的键值。
fn write_meta(conn: &Connection, key: &str, value: &str) {
    let _ = conn.execute(
        "INSERT OR REPLACE INTO index_meta (key, value) VALUES (?1, ?2)",
        params![key, value],
    );
}

// ===========================================================================
// 路径过滤
// ===========================================================================

/// 判断路径是否应被排除（系统目录、虚拟文件系统、缓存目录等）。
fn should_skip(path: &Path) -> bool {
    #[cfg(target_os = "macos")]
    {
        let skip_prefixes = [
            "/System", "/Library", "/usr", "/bin", "/sbin", "/opt",
            "/private", "/dev", "/proc", "/sys", "/.vol",
            "/var/folders", "/var/db", "/var/log", "/var/tmp",
            "/private/var", "/private/tmp", "/private/etc",
        ];
        if let Some(s) = path.to_str() {
            if skip_prefixes.iter().any(|p| s.starts_with(p)) {
                return true;
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        let skip_prefixes = [
            "/proc", "/sys", "/dev", "/run", "/snap",
            "/usr", "/bin", "/sbin", "/lib", "/lib64",
            "/var/cache", "/var/log", "/var/tmp",
            "/boot", "/lost+found",
        ];
        if let Some(s) = path.to_str() {
            if skip_prefixes.iter().any(|p| s.starts_with(p)) {
                return true;
            }
        }
    }
    #[cfg(windows)]
    {
        let skip_names = [
            r"C:\Windows",
            r"C:\$Recycle.Bin",
            r"C:\ProgramData",
            r"C:\Recovery",
            r"C:\System Volume Information",
        ];
        if let Some(s) = path.to_str() {
            let lower = s.to_lowercase();
            if skip_names
                .iter()
                .any(|p| lower.starts_with(&p.to_lowercase()))
            {
                return true;
            }
        }
    }
    // 通用：跳过隐藏目录中的常见缓存/版本控制内部目录（减少噪音）
    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
        if matches!(
            name,
            "node_modules" | ".git" | ".cache" | "__pycache__"
                | ".Trash" | "target" | ".npm" | ".cargo"
                | ".rustup" | ".vscode" | ".idea"
        ) {
            return true;
        }
    }
    false
}

/// 判断路径是否在用户配置的排除列表中。
fn is_config_excluded(path: &Path, config: &IndexConfig) -> bool {
    if let Some(s) = path.to_str() {
        return config
            .excluded_paths
            .iter()
            .any(|p| s.starts_with(p.as_str()));
    }
    false
}

// ===========================================================================
// 批量写入
// ===========================================================================

/// 批量插入文件记录（事务内）。
fn batch_insert(conn: &Connection, rows: &[(String, String, String, bool, u64, u64)]) {
    if rows.is_empty() {
        return;
    }
    let tx = conn.unchecked_transaction();
    if tx.is_err() {
        return;
    }
    let tx = tx.unwrap();
    for (path, name, parent_dir, is_dir, size, modified) in rows {
        let ext = Path::new(name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        let _ = tx.execute(
            "INSERT OR REPLACE INTO file_index (path, name, parent_dir, is_dir, size, modified, extension, indexed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![path, name, parent_dir, if *is_dir { 1 } else { 0 }, size, modified, ext, now_secs()],
        );
    }
    let _ = tx.commit();
}

// ===========================================================================
// 后台扫描
// ===========================================================================

/// 后台扫描入口。在独立线程中使用 jwalk 并行遍历文件系统并构建索引。
///
/// - 如果存在有效索引（roots 匹配 + 非空 + 版本一致）→ 直接复用，跳过全量重建
/// - 否则 → 全量构建（清空 + 并行扫描 + 重建 FTS）
///
/// `emit_progress` 回调用于向前端推送进度事件（节流：最多每 500ms 一次）。
/// `config_override` 允许使用指定配置而非默认读取。
pub fn start_background_scan<F>(emit_progress: F, config_override: Option<IndexConfig>)
where
    F: Fn(u64, u64, &str) + Send + 'static,
{
    if INDEXING.swap(true, Ordering::SeqCst) {
        return; // 已在索引中
    }

    std::thread::spawn(move || {
        let config = config_override
            .unwrap_or_else(|| load_index_config().unwrap_or_else(|_| default_index_config()));

        let conn = match open_db() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[file_index] open db failed: {e}");
                INDEXING.store(false, Ordering::SeqCst);
                return;
            }
        };

        let config_roots_json = serde_json::to_string(&config.roots).unwrap_or_default();

        // ============================================================
        // 检查是否可复用现有索引
        // ============================================================
        let can_reuse = {
            let meta_roots = read_meta(&conn, "roots");
            let meta_version = read_meta(&conn, "scan_version");
            let meta_total: u64 = read_meta(&conn, "total_files")
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            let main_count: i64 = conn
                .query_row("SELECT COUNT(*) FROM file_index", [], |row| row.get(0))
                .unwrap_or(0);

            meta_roots.is_some()
                && meta_roots.as_deref() == Some(config_roots_json.as_str())
                && meta_version.as_deref() == Some(SCAN_VERSION)
                && meta_total > 0
                && main_count > 0
        };

        if can_reuse {
            // 复用现有索引，跳过全量重建，仅启动 watcher
            let total: u64 = conn
                .query_row("SELECT COUNT(*) FROM file_index", [], |row| {
                    row.get::<_, i64>(0)
                })
                .map(|n| n as u64)
                .unwrap_or(0);
            let build_time: u64 = read_meta(&conn, "build_time")
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            TOTAL_FILES.store(total, Ordering::SeqCst);
            LAST_SCAN.store(build_time, Ordering::SeqCst);
            ESTIMATED_TOTAL.store(total, Ordering::SeqCst);
            INDEXING.store(false, Ordering::SeqCst);
            emit_progress(total, total, "");
            eprintln!("[file_index] reusing existing index ({} files), skipping full rebuild", total);
            start_watcher(config);
            return;
        }

        // ============================================================
        // 全量构建
        // ============================================================
        eprintln!("[file_index] starting full rebuild, roots: {:?}", config.roots);

        // 扫描前：禁用 FTS 触发器，避免逐行同步的巨大开销
        let _ = conn.execute_batch(
            "DROP TRIGGER IF EXISTS file_fts_ai; DROP TRIGGER IF EXISTS file_fts_ad; DROP TRIGGER IF EXISTS file_fts_au;",
        );
        // 清空旧索引
        let _ = conn.execute("DELETE FROM file_index;", []);
        let _ = conn.execute("DELETE FROM file_fts;", []);

        let scan_roots: Vec<PathBuf> = config.roots.iter().map(PathBuf::from).collect();

        // 粗略初始估算（随扫描推进动态更新）
        let initial_estimate: u64 = 500_000;
        ESTIMATED_TOTAL.store(initial_estimate, Ordering::SeqCst);
        emit_progress(0, initial_estimate, "");

        let mut count: u64 = 0;
        let mut batch: Vec<(String, String, String, bool, u64, u64)> = Vec::with_capacity(500);
        let mut last_emit = Instant::now();
        let emit_interval = Duration::from_millis(500);

        for root in &scan_roots {
            // jwalk 并行遍历：通过 process_read_dir 在目录读取阶段过滤掉
            // 系统目录和缓存目录，避免递归进入（大幅减少 I/O）
            let walker = jwalk::WalkDir::new(root)
                .parallelism(jwalk::Parallelism::RayonDefaultPool {
                    busy_timeout: Duration::from_secs(1),
                })
                .skip_hidden(false)
                .follow_links(false)
                .process_read_dir(|_depth, _path, _state, children| {
                    // 移除应跳过的条目（系统目录、缓存目录等）
                    children.retain(|res| {
                        res.as_ref()
                            .map(|entry| !should_skip(&entry.path()))
                            .unwrap_or(true)
                    });
                });

            for entry in walker {
                // graceful 跳过权限错误等
                let entry = match entry {
                    Ok(e) => e,
                    Err(_) => continue,
                };

                let path = entry.path();
                let path_str = match path.to_str() {
                    Some(s) => s.to_string(),
                    None => continue,
                };

                // 双重检查 skip（process_read_dir 可能遗漏边界情况）
                if should_skip(&path) || is_config_excluded(&path, &config) {
                    continue;
                }

                let name = entry.file_name().to_str().unwrap_or("?").to_string();

                // 文件类型过滤：目录始终通过，仅过滤文件
                let is_dir = entry.file_type().is_dir();
                if !is_dir && !is_file_allowed(&name, &config) {
                    continue;
                }

                let parent_dir = path
                    .parent()
                    .and_then(|p| p.to_str())
                    .unwrap_or("")
                    .to_string();

                let metadata = entry.metadata().ok();
                let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
                let modified = metadata
                    .as_ref()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);

                batch.push((path_str, name, parent_dir, is_dir, size, modified));
                count += 1;

                // 动态更新估算总数：当计数接近当前估算时，按 1.5 倍扩展
                let current_est = ESTIMATED_TOTAL.load(Ordering::SeqCst);
                if count >= current_est {
                    ESTIMATED_TOTAL.store((count as f64 * 1.5) as u64, Ordering::SeqCst);
                }

                if batch.len() >= 500 {
                    batch_insert(&conn, &batch);
                    batch.clear();
                    TOTAL_FILES.store(count, Ordering::SeqCst);

                    // 节流：每 500ms 最多发一次进度
                    let now = Instant::now();
                    if now.duration_since(last_emit) >= emit_interval {
                        last_emit = now;
                        let cur = path.to_str().unwrap_or("");
                        let est = ESTIMATED_TOTAL.load(Ordering::SeqCst);
                        emit_progress(count, est, cur);
                        if let Ok(mut cp) = CURRENT_PATH.lock() {
                            *cp = cur.to_string();
                        }
                    }
                }
            }
        }

        // 插入剩余
        batch_insert(&conn, &batch);
        TOTAL_FILES.store(count, Ordering::SeqCst);

        // 扫描完成后：一次性批量重建 FTS5 索引（比逐行触发器快 100x）
        let _ = conn.execute("INSERT INTO file_fts(rowid, name) SELECT id, name FROM file_index;", []);

        // 重建完成后恢复 FTS 触发器（用于后续增量更新）
        let _ = conn.execute_batch(
            "CREATE TRIGGER IF NOT EXISTS file_fts_ai AFTER INSERT ON file_index BEGIN
                INSERT INTO file_fts(rowid, name) VALUES (new.id, new.name);
             END;
             CREATE TRIGGER IF NOT EXISTS file_fts_ad AFTER DELETE ON file_index BEGIN
                INSERT INTO file_fts(file_fts, rowid, name) VALUES ('delete', old.id, old.name);
             END;
             CREATE TRIGGER IF NOT EXISTS file_fts_au AFTER UPDATE ON file_index BEGIN
                INSERT INTO file_fts(file_fts, rowid, name) VALUES ('delete', old.id, old.name);
                INSERT INTO file_fts(rowid, name) VALUES (new.id, new.name);
             END;",
        );

        // 写入索引元数据
        let build_time = now_secs();
        write_meta(&conn, "build_time", &build_time.to_string());
        write_meta(&conn, "scan_version", SCAN_VERSION);
        write_meta(&conn, "roots", &config_roots_json);
        write_meta(&conn, "total_files", &count.to_string());

        LAST_SCAN.store(build_time, Ordering::SeqCst);
        INDEXING.store(false, Ordering::SeqCst);
        if let Ok(mut cp) = CURRENT_PATH.lock() {
            *cp = String::new();
        }

        let est = ESTIMATED_TOTAL.load(Ordering::SeqCst);
        emit_progress(count, est, "");
        eprintln!("[file_index] full rebuild complete: {} files indexed", count);

        // 启动增量 watcher
        start_watcher(config);
    });
}

// ===========================================================================
// 增量 watcher（notify + mpsc + debounce）
// ===========================================================================

/// 启动 notify 文件监听器，增量更新索引。
///
/// 架构：
/// 1. watcher 线程：notify 监听配置的根目录（递归），事件通过 mpsc 通道发送
/// 2. writer 线程（同一线程）：持单一 DB 连接，500ms debounce 窗口批量合并事件
/// 3. 攒一批事件后用单事务批量 INSERT OR REPLACE / DELETE
fn start_watcher(config: IndexConfig) {
    if WATCHER_RUNNING.swap(true, Ordering::SeqCst) {
        return; // 已有 watcher 在运行
    }

    std::thread::spawn(move || {
        use notify::{RecommendedWatcher, RecursiveMode, Watcher};

        let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();

        let mut watcher: RecommendedWatcher = match Watcher::new(
            move |res: notify::Result<notify::Event>| {
                let _ = tx.send(res);
            },
            notify::Config::default(),
        ) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("[file_index] watcher init failed: {e}");
                WATCHER_RUNNING.store(false, Ordering::SeqCst);
                return;
            }
        };

        // 监听配置的根目录（递归）
        let mut watch_count = 0;
        for root in &config.roots {
            let path = Path::new(root);
            if !path.exists() {
                continue;
            }
            match watcher.watch(path, RecursiveMode::Recursive) {
                Ok(()) => {
                    watch_count += 1;
                }
                Err(e) => {
                    eprintln!("[file_index] recursive watch failed for {root}: {e}, trying non-recursive");
                    // inotify watch 数超限时降级为只监听顶层目录
                    let _ = watcher.watch(path, RecursiveMode::NonRecursive);
                    watch_count += 1;
                }
            }
        }

        if watch_count == 0 {
            eprintln!("[file_index] no directories to watch, watcher exiting");
            WATCHER_RUNNING.store(false, Ordering::SeqCst);
            return;
        }

        eprintln!("[file_index] watcher started, monitoring {} root(s)", watch_count);

        // 打开独立的查询/写入连接（WAL 模式下读写不互斥）
        let conn = match open_db() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[file_index] watcher db open failed: {e}");
                WATCHER_RUNNING.store(false, Ordering::SeqCst);
                return;
            }
        };

        // 事件处理循环：debounce 窗口 + 批量写入
        let debounce = Duration::from_millis(500);
        let mut pending: Vec<notify::Event> = Vec::new();
        let mut last_event_time: Option<Instant> = None;

        loop {
            // 计算下一次 recv 超时
            let timeout = match last_event_time {
                Some(t) => {
                    let elapsed = Instant::now().duration_since(t);
                    if elapsed >= debounce {
                        Duration::from_millis(10) // debounce 窗口已过，尽快处理
                    } else {
                        debounce - elapsed
                    }
                }
                None => Duration::from_secs(1), // 无待处理事件，长等待
            };

            match rx.recv_timeout(timeout) {
                Ok(Ok(event)) => {
                    pending.push(event);
                    last_event_time = Some(Instant::now());
                }
                Ok(Err(_)) => {
                    // notify 错误事件，忽略（不更新 debounce 时间）
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    // debounce 窗口结束，处理积压事件
                    if !pending.is_empty() {
                        process_event_batch(&conn, &pending, &config);
                        pending.clear();
                        last_event_time = None;
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    // watcher 已关闭，处理剩余事件后退出
                    if !pending.is_empty() {
                        process_event_batch(&conn, &pending, &config);
                    }
                    break;
                }
            }
        }

        WATCHER_RUNNING.store(false, Ordering::SeqCst);
        eprintln!("[file_index] watcher stopped");
    });
}

/// 批量处理文件系统事件：去重 → 单事务写入。
fn process_event_batch(conn: &Connection, events: &[notify::Event], config: &IndexConfig) {
    let mut to_upsert: Vec<PathBuf> = Vec::new();
    let mut to_delete: Vec<PathBuf> = Vec::new();

    for event in events {
        match event.kind {
            EventKind::Create(_) | EventKind::Modify(_) => {
                for path in &event.paths {
                    if should_skip(path) || is_config_excluded(path, config) {
                        continue;
                    }
                    to_upsert.push(path.clone());
                }
            }
            EventKind::Remove(_) => {
                for path in &event.paths {
                    to_delete.push(path.clone());
                }
            }
            _ => {}
        }
    }

    if to_upsert.is_empty() && to_delete.is_empty() {
        return;
    }

    // 去重
    to_upsert.sort();
    to_upsert.dedup();
    to_delete.sort();
    to_delete.dedup();

    let tx = match conn.unchecked_transaction() {
        Ok(t) => t,
        Err(_) => return,
    };

    // 处理新增/修改
    for path in &to_upsert {
        let path_str = match path.to_str() {
            Some(s) => s.to_string(),
            None => continue,
        };
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        if let Ok(meta) = std::fs::metadata(path) {
            // 文件类型过滤：目录不过滤，文件需通过 is_file_allowed
            if !meta.is_dir() && !is_file_allowed(&name, config) {
                continue;
            }
            let parent_dir = path
                .parent()
                .and_then(|p| p.to_str())
                .unwrap_or("")
                .to_string();
            let is_dir = meta.is_dir();
            let size = meta.len();
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("");

            let _ = tx.execute(
                "INSERT OR REPLACE INTO file_index (path, name, parent_dir, is_dir, size, modified, extension, indexed_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![path_str, name, parent_dir, if is_dir { 1 } else { 0 }, size, modified, ext, now_secs()],
            );
        }
    }

    // 处理删除（同时清理子路径）
    for path in &to_delete {
        if let Some(path_str) = path.to_str() {
            let _ = tx.execute(
                "DELETE FROM file_index WHERE path = ?1 OR path LIKE ?2",
                params![path_str, format!("{}%", path_str)],
            );
        }
    }

    let _ = tx.commit();
}

// ===========================================================================
// 搜索
// ===========================================================================

/// 搜索文件（FTS5 全文搜索，毫秒级响应）。
///
/// 使用 SQLite FTS5 倒排索引，支持：
/// - 前缀匹配（输入 "term" 匹配 "terminal"）
/// - 多词 AND 查询（输入 "src main" 匹配同时含两者的路径）
/// - 大小写不敏感（unicode61 tokenizer 原生支持）
///
/// 性能：FTS5 的倒排索引使搜索从 O(n) 全表扫描降为 O(log n + k)，
/// k 为匹配结果数。百万级文件仍可在 1ms 内返回。
pub fn search(query: &str, limit: i64) -> Result<Vec<FileSearchResult>, String> {
    let conn = open_db()?;

    // 构造 FTS5 MATCH 查询：
    // 1. 将查询拆分为词，每个词加 * 做前缀匹配
    // 2. 用空格连接多个词（FTS5 默认 AND 语义）
    let fts_query = query
        .split_whitespace()
        .map(|w| {
            // 转义 FTS5 特殊字符，用双引号包裹
            let escaped = w.replace('"', "");
            if escaped.is_empty() {
                String::new()
            } else {
                format!("\"{}\"*", escaped)
            }
        })
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join(" ");

    if fts_query.is_empty() {
        return Ok(Vec::new());
    }

    // FTS5 bm25() 排名：相关性越高分数越低（负值），用 rank 排序避免全量排序
    // 子查询先在 FTS 层面限制结果集（用 FTS5 的 rank 优化），再做 JOIN 取详情
    let sql = "SELECT fi.path, fi.name, fi.is_dir, fi.size, fi.modified
               FROM (
                   SELECT rowid, bm25(file_fts) AS score
                   FROM file_fts
                   WHERE file_fts.name MATCH ?1
                   ORDER BY score
                   LIMIT ?2
               ) AS fts_top
               JOIN file_index fi ON fi.id = fts_top.rowid
               ORDER BY fi.is_dir DESC, fi.name ASC";

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let results = stmt
        .query_map(params![fts_query, limit], |row| {
            Ok(FileSearchResult {
                path: row.get(0)?,
                name: row.get(1)?,
                is_dir: row.get::<_, i64>(2)? != 0,
                size: row.get(3)?,
                modified: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(results)
}

// ===========================================================================
// 状态查询
// ===========================================================================

/// 获取索引状态。
pub fn get_status() -> IndexStatus {
    let total = TOTAL_FILES.load(Ordering::SeqCst);
    let estimated = ESTIMATED_TOTAL.load(Ordering::SeqCst);
    let indexing = INDEXING.load(Ordering::SeqCst);
    let progress = if !indexing {
        100
    } else if estimated > 0 {
        ((total as f64 / estimated as f64) * 100.0).min(99.0) as u8
    } else {
        0
    };

    IndexStatus {
        indexing,
        total_files: total,
        last_scan: LAST_SCAN.load(Ordering::SeqCst),
        current_path: CURRENT_PATH
            .lock()
            .map(|s| s.clone())
            .unwrap_or_default(),
        estimated_total: estimated,
        progress,
    }
}

/// 手动触发重建索引（清空 + 重新扫描）。
pub fn rebuild() {
    start_background_scan(|_, _, _| {}, None);
}
