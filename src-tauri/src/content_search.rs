//! 文件内容搜索模块 — 基于 ripgrep 嵌入式库
//!
//! 使用 `ignore` crate 并行遍历目录，`grep-searcher` + `grep-regex` 做内容匹配。
//! 无需预建索引，实时搜索，支持行号、匹配高亮、上下文。

use grep::regex::RegexMatcher;
use grep::searcher::{sinks::UTF8, BinaryDetection, MmapChoice, SearcherBuilder};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicUsize, Ordering};

use crate::file_index;

/// 单条匹配行
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentMatchLine {
    pub line_number: u64,
    pub line_text: String,
    pub match_start: usize, // 行内匹配起始偏移
    pub match_end: usize,   // 行内匹配结束偏移
}

/// 单个文件的内容搜索结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchResult {
    pub path: String,
    pub name: String,
    pub matches: Vec<ContentMatchLine>,
    pub match_count: usize,
    pub has_more_matches: bool,
}

/// 在指定目录下搜索文件内容。
///
/// - `query`: 纯文本搜索词（会自动 regex::escape 转义，用户无需懂正则）
/// - `root`: 搜索根目录（通常是文件管理器的当前路径）
/// - `limit`: 最大返回文件数
/// - `max_matches_per_file`: 每个文件最多收集多少条匹配行
pub fn search_content(
    query: &str,
    root: &str,
    limit: usize,
    max_matches_per_file: usize,
) -> Result<Vec<ContentSearchResult>, String> {
    let mut results = Vec::new();
    let mut cancelled = || false;
    search_content_with_callback(
        query,
        root,
        limit,
        max_matches_per_file,
        &mut cancelled,
        |result| results.push(result),
    )?;
    Ok(results)
}

/// 在指定目录中搜索内容，并在每个命中文件准备好后立即调用回调。
pub fn search_content_with_callback<C, F>(
    query: &str,
    root: &str,
    limit: usize,
    max_matches_per_file: usize,
    cancelled: &mut C,
    mut on_result: F,
) -> Result<bool, String>
where
    C: FnMut() -> bool,
    F: FnMut(ContentSearchResult),
{
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(false);
    }

    let pattern = regex::escape(trimmed);
    let matcher = RegexMatcher::new(&format!("(?i){pattern}"))
        .map_err(|e| format!("Invalid search pattern: {e}"))?;
    let highlight_matcher = regex::RegexBuilder::new(&pattern)
        .case_insensitive(true)
        .build()
        .map_err(|e| format!("Invalid search pattern: {e}"))?;
    let index_config =
        file_index::load_index_config().unwrap_or_else(|_| file_index::default_index_config());
    let file_count = AtomicUsize::new(0);
    let walker = ignore::WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .build();

    for entry in walker {
        if cancelled() {
            return Ok(false);
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let path = entry.path();
        if !path.is_file()
            || file_index::should_skip(path)
            || file_index::is_config_excluded(path, &index_config)
        {
            continue;
        }

        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("");
        if !file_index::is_file_allowed(file_name, &index_config) {
            continue;
        }
        if file_count.load(Ordering::Relaxed) >= limit {
            return Ok(true);
        }

        let mut searcher = SearcherBuilder::new()
            .line_number(true)
            .binary_detection(BinaryDetection::quit(b'\x00'))
            .memory_map(MmapChoice::never())
            .heap_limit(Some(8 * 1024 * 1024))
            .build();
        let mut matches = Vec::new();
        let mut total_matches = 0;
        let search_result = searcher.search_path(
            &matcher,
            path,
            UTF8(|line_num, line| {
                if cancelled() {
                    return Ok(false);
                }
                total_matches += 1;
                if matches.len() < max_matches_per_file {
                    let line_text = line
                        .trim_end_matches('\n')
                        .trim_end_matches('\r')
                        .to_string();
                    let (match_start, match_end) = find_match_range(&line_text, &highlight_matcher);
                    matches.push(ContentMatchLine {
                        line_number: line_num,
                        line_text,
                        match_start,
                        match_end,
                    });
                }
                Ok(true)
            }),
        );
        if search_result.is_err() || matches.is_empty() {
            continue;
        }

        file_count.fetch_add(1, Ordering::Relaxed);
        on_result(ContentSearchResult {
            path: path.to_string_lossy().to_string(),
            name: file_name.to_string(),
            has_more_matches: total_matches > matches.len(),
            match_count: total_matches,
            matches,
        });
        if file_count.load(Ordering::Relaxed) >= limit {
            return Ok(true);
        }
    }

    Ok(false)
}

/// 在行文本中查找搜索词的首个匹配位置（大小写不敏感，用于高亮）。
///
/// 偏移以 UTF-16 code unit 计算，直接可供 JavaScript 字符串 slice 使用。
fn find_match_range(line: &str, matcher: &regex::Regex) -> (usize, usize) {
    let Some(found) = matcher.find(line) else {
        return (0, 0);
    };

    (
        line[..found.start()].encode_utf16().count(),
        line[..found.end()].encode_utf16().count(),
    )
}

#[cfg(test)]
mod tests {
    use super::find_match_range;

    #[test]
    fn returns_utf16_offsets_for_case_insensitive_matches() {
        let matcher = regex::RegexBuilder::new("agents")
            .case_insensitive(true)
            .build()
            .unwrap();

        assert_eq!(find_match_range("前 AGENTS 后", &matcher), (2, 8));
    }

    #[test]
    fn returns_utf16_offsets_after_astral_unicode() {
        let matcher = regex::RegexBuilder::new("agents")
            .case_insensitive(true)
            .build()
            .unwrap();

        assert_eq!(find_match_range("😀 AGENTS", &matcher), (3, 9));
    }
}
