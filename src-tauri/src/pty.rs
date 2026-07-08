use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

#[derive(Serialize, Deserialize, Clone)]
pub struct PtyOutputEvent {
    pub session_id: String,
    pub data: String,
}

struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send>,
}

pub struct PtyManager {
    sessions: HashMap<String, PtySession>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    pub fn create(
        &mut self,
        app_handle: AppHandle,
        cols: u16,
        rows: u16,
        cwd: Option<String>,
    ) -> Result<String, String> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;

        let cmd = if cfg!(target_os = "windows") {
            // Use PowerShell with custom prompt that:
            // 1. Converts backslashes to forward slashes
            // 2. Removes colon from drive letters (C:\Users -> C/Users)
            // 3. Shortens home directory to ~
            // 4. Emits OSC 0 title sequence for terminal title bar
            let prompt_script = r#"
$e=[char]27
function global:prompt {
  $p = $PWD.Path
  [Console]::Write("$e]0;$p$e\")
  "$p> "
}
"#;
            let mut c = CommandBuilder::new("powershell.exe");
            c.arg("-ExecutionPolicy");
            c.arg("Bypass");
            c.arg("-NoLogo");
            c.arg("-NoExit");
            c.arg("-Command");
            c.arg(prompt_script.trim());
            c.env("TERM", "xterm-256color");
            apply_cwd(&mut c, cwd.as_deref());
            c
        } else {
            build_unix_command(cwd.as_deref())?
        };

        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

        let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

        let session_id = Uuid::new_v4().to_string();

        let sid = session_id.clone();
        std::thread::spawn(move || {
            let mut reader = reader;
            let mut buf = [0u8; 8192];
            let mut pending: Vec<u8> = Vec::new();
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        pending.extend_from_slice(&buf[..n]);

                        // Decode as much valid UTF-8 as possible
                        let mut start = 0;
                        loop {
                            if start >= pending.len() {
                                pending.clear();
                                break;
                            }

                            match std::str::from_utf8(&pending[start..]) {
                                Ok(s) => {
                                    if !s.is_empty() {
                                        let _ = app_handle.emit(
                                            "pty-output",
                                            PtyOutputEvent {
                                                session_id: sid.clone(),
                                                data: s.to_string(),
                                            },
                                        );
                                    }
                                    pending.clear();
                                    break;
                                }
                                Err(e) => {
                                    let valid_up_to = e.valid_up_to();
                                    if valid_up_to > 0 {
                                        // Emit the valid portion
                                        let valid_str = unsafe {
                                            std::str::from_utf8_unchecked(&pending[start..start + valid_up_to])
                                        };
                                        let _ = app_handle.emit(
                                            "pty-output",
                                            PtyOutputEvent {
                                                session_id: sid.clone(),
                                                data: valid_str.to_string(),
                                            },
                                        );
                                        start += valid_up_to;
                                    }

                                    let remaining = pending.len() - start;
                                    let error_len = e.error_len();

                                    if let Some(len) = error_len {
                                        // Truly invalid byte(s) - skip them
                                        let _ = app_handle.emit(
                                            "pty-output",
                                            PtyOutputEvent {
                                                session_id: sid.clone(),
                                                data: "\u{fffd}".to_string(),
                                            },
                                        );
                                        start += len;
                                    } else if remaining < 4 {
                                        // Incomplete multi-byte char - keep remaining bytes for next read
                                        pending = pending[start..].to_vec();
                                        break;
                                    } else {
                                        // Shouldn't happen: >4 remaining but not valid and no error_len
                                        let _ = app_handle.emit(
                                            "pty-output",
                                            PtyOutputEvent {
                                                session_id: sid.clone(),
                                                data: "\u{fffd}".to_string(),
                                            },
                                        );
                                        start += 1;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        self.sessions.insert(
            session_id.clone(),
            PtySession {
                writer,
                master: pair.master,
                child,
            },
        );

        Ok(session_id)
    }

    pub fn write(&mut self, session_id: &str, data: &str) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or("Session not found")?;
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        session.writer.flush().map_err(|e| e.to_string())
    }

    pub fn resize(&mut self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let session = self.sessions.get(session_id).ok_or("Session not found")?;
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    }

    pub fn kill(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(mut session) = self.sessions.remove(session_id) {
            let _ = session.child.kill();
            Ok(())
        } else {
            Err("Session not found".into())
        }
    }
}

fn apply_cwd(command: &mut CommandBuilder, cwd: Option<&str>) {
    if let Some(dir) = cwd {
        let p = Path::new(dir);
        if p.is_dir() {
            command.cwd(p);
        }
    }
}

fn build_unix_command(cwd: Option<&str>) -> Result<CommandBuilder, String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let shell_name = Path::new(&shell)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("sh");

    if shell_name == "zsh" {
        let zdotdir = ensure_easy_terminal_zdotdir()?;
        let mut c = CommandBuilder::new(&shell);
        c.arg("-i");
        c.env("ZDOTDIR", zdotdir);
        c.env("EASY_TERMINAL", "1");
        c.env("TERM", "xterm-256color");
        c.env("LANG", "en_US.UTF-8");
        c.env("LC_ALL", "en_US.UTF-8");
        apply_cwd(&mut c, cwd);
        return Ok(c);
    }

    let mut c = CommandBuilder::new_default_prog();
    c.env("PROMPT_COMMAND", r#"printf "\033]0;%s\007" "$PWD""#);
    c.env("PS1", r#"\[\e]0;\w\a\]\w $ "#);
    c.env("EASY_TERMINAL", "1");
    c.env("TERM", "xterm-256color");
    c.env("LANG", "en_US.UTF-8");
    c.env("LC_ALL", "en_US.UTF-8");
    apply_cwd(&mut c, cwd);
    Ok(c)
}

fn ensure_easy_terminal_zdotdir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let dir = home.join(".easy-terminal").join("zdotdir");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let zshrc = dir.join(".zshrc");
    let content = r#"
export EASY_TERMINAL=1

if [ -f "$HOME/.zshrc" ]; then
  source "$HOME/.zshrc"
fi

if typeset -f autosuggest-disable >/dev/null 2>&1; then
  autosuggest-disable >/dev/null 2>&1
fi
if typeset -f _zsh_autosuggest_clear >/dev/null 2>&1; then
  _zsh_autosuggest_clear >/dev/null 2>&1
fi
typeset -g ZSH_AUTOSUGGEST_DISABLED=1
typeset -ga ZSH_AUTOSUGGEST_STRATEGY
ZSH_AUTOSUGGEST_STRATEGY=()
POSTDISPLAY=
ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE='fg=8'

autoload -Uz add-zsh-hook >/dev/null 2>&1 || true
if typeset -f add-zsh-hook >/dev/null 2>&1; then
  _easy_terminal_precmd() { print -Pn "\e]0;%~\a" }
  add-zsh-hook precmd _easy_terminal_precmd
fi

autoload -Uz add-zle-hook-widget >/dev/null 2>&1 || true
if typeset -f add-zle-hook-widget >/dev/null 2>&1; then
  _easy_terminal_clear_postdisplay() { POSTDISPLAY= }
  add-zle-hook-widget line-init _easy_terminal_clear_postdisplay >/dev/null 2>&1 || true
  add-zle-hook-widget keymap-select _easy_terminal_clear_postdisplay >/dev/null 2>&1 || true
fi
"#;

    fs::write(zshrc, content).map_err(|e| e.to_string())?;
    Ok(dir)
}
