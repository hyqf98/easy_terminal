use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use tauri::{AppHandle, Emitter};
use serde::{Deserialize, Serialize};
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
            if let Some(ref dir) = cwd {
                let p = std::path::Path::new(dir);
                if p.is_dir() {
                    c.cwd(p);
                }
            }
            c
        } else {
            let mut c = CommandBuilder::new_default_prog();
            c.env(
                "PROMPT_COMMAND",
                r#"printf "\033]0;%s\007" "$PWD""#,
            );
            c.env("PS1", r#"\[\e]0;\w\a\]\w $ "#);
            if let Some(ref dir) = cwd {
                let p = std::path::Path::new(dir);
                if p.is_dir() {
                    c.cwd(p);
                }
            }
            c
        };

        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

        let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

        let session_id = Uuid::new_v4().to_string();

        let sid = session_id.clone();
        std::thread::spawn(move || {
            let mut reader = reader;
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app_handle.emit(
                            "pty-output",
                            PtyOutputEvent {
                                session_id: sid.clone(),
                                data,
                            },
                        );
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
        let session = self
            .sessions
            .get(session_id)
            .ok_or("Session not found")?;
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
