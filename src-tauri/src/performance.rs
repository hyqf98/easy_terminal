use serde::Serialize;
use std::collections::HashSet;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
use sysinfo::{Disks, ProcessesToUpdate, System};

const PORT_LIMIT: usize = 200;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MetricStatus {
    pub state: String,
    pub reason: Option<String>,
}

impl MetricStatus {
    fn available() -> Self {
        Self {
            state: "available".into(),
            reason: None,
        }
    }
    fn unavailable(reason: impl Into<String>) -> Self {
        Self {
            state: "unavailable".into(),
            reason: Some(reason.into()),
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CpuMetric {
    pub usage_percent: f32,
    pub cores: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MemoryMetric {
    pub total: u64,
    pub used: u64,
    pub usage_percent: f32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiskMetric {
    pub name: String,
    pub mount_point: String,
    pub total: u64,
    pub used: u64,
    pub available: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GpuMetric {
    pub name: String,
    pub utilization_percent: Option<f32>,
    pub memory_total: Option<u64>,
    pub memory_used: Option<u64>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PortMetric {
    pub protocol: String,
    pub address: String,
    pub port: u16,
    pub process: Option<String>,
    pub pid: Option<u32>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProcessMetric {
    pub pid: u32,
    pub name: String,
    pub cpu_percent: f32,
    pub memory: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceSnapshot {
    pub captured_at: u64,
    pub cpu: CpuMetric,
    pub memory: MemoryMetric,
    pub disks: Vec<DiskMetric>,
    pub gpus: Vec<GpuMetric>,
    pub ports: Vec<PortMetric>,
    pub ports_truncated: bool,
    pub processes: Vec<ProcessMetric>,
    pub gpu_status: MetricStatus,
    pub ports_status: MetricStatus,
    pub processes_status: MetricStatus,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn percentage(used: u64, total: u64) -> f32 {
    if total == 0 {
        0.0
    } else {
        used as f32 * 100.0 / total as f32
    }
}

fn local_disks() -> Vec<DiskMetric> {
    let disks = Disks::new_with_refreshed_list();
    disks
        .list()
        .iter()
        .filter_map(|disk| {
            let total = disk.total_space();
            if total == 0 {
                return None;
            }
            let available = disk.available_space();
            Some(DiskMetric {
                name: disk.name().to_string_lossy().to_string(),
                mount_point: disk.mount_point().to_string_lossy().to_string(),
                total,
                used: total.saturating_sub(available),
                available,
            })
        })
        .collect()
}

fn parse_nvidia_smi(output: &str) -> Vec<GpuMetric> {
    output
        .lines()
        .filter_map(|line| {
            let fields: Vec<_> = line.split(',').map(str::trim).collect();
            if fields.len() != 4 {
                return None;
            }
            Some(GpuMetric {
                name: fields[0].to_string(),
                utilization_percent: fields[1].parse().ok(),
                memory_total: fields[2]
                    .parse::<u64>()
                    .ok()
                    .map(|value| value * 1024 * 1024),
                memory_used: fields[3]
                    .parse::<u64>()
                    .ok()
                    .map(|value| value * 1024 * 1024),
            })
        })
        .collect()
}

fn collect_gpus() -> (Vec<GpuMetric>, MetricStatus) {
    let output = Command::new("nvidia-smi")
        .args([
            "--query-gpu=name,utilization.gpu,memory.total,memory.used",
            "--format=csv,noheader,nounits",
        ])
        .output();
    match output {
        Ok(result) if result.status.success() => {
            let gpus = parse_nvidia_smi(&String::from_utf8_lossy(&result.stdout));
            if gpus.is_empty() {
                (gpus, MetricStatus::unavailable("未检测到可读取的 GPU"))
            } else {
                (gpus, MetricStatus::available())
            }
        }
        Ok(result) => (
            Vec::new(),
            MetricStatus::unavailable(String::from_utf8_lossy(&result.stderr).trim().to_string()),
        ),
        Err(_) => (
            Vec::new(),
            MetricStatus::unavailable("未安装 nvidia-smi，暂不支持此 GPU 的实时数据"),
        ),
    }
}

fn endpoint_parts(raw: &str) -> Option<(String, u16)> {
    let value = raw.trim().trim_matches('[').trim_matches(']');
    let (address, port) = value.rsplit_once(':')?;
    Some((
        address.trim_matches(['[', ']']).to_string(),
        port.parse().ok()?,
    ))
}

/// Parse `ss -H -lntup` rows. It intentionally tolerates missing process ownership.
pub fn parse_ss_ports(output: &str) -> Vec<PortMetric> {
    output
        .lines()
        .filter_map(|line| {
            let fields: Vec<_> = line.split_whitespace().collect();
            if fields.len() < 5 {
                return None;
            }
            let protocol = fields[0].to_string();
            let (address, port) = endpoint_parts(fields[4])?;
            let suffix = fields.get(6..).unwrap_or(&[]).join(" ");
            let pid = suffix
                .split("pid=")
                .nth(1)
                .and_then(|tail| tail.split(|ch: char| !ch.is_ascii_digit()).next())
                .and_then(|value| value.parse().ok());
            let process = suffix.split('"').nth(1).map(str::to_string);
            Some(PortMetric {
                protocol,
                address,
                port,
                process,
                pid,
            })
        })
        .collect()
}

fn parse_lsof_ports(output: &str) -> Vec<PortMetric> {
    output
        .lines()
        .skip(1)
        .filter_map(|line| {
            let fields: Vec<_> = line.split_whitespace().collect();
            if fields.len() < 3 {
                return None;
            }
            let protocol_index = fields
                .iter()
                .position(|item| *item == "TCP" || *item == "UDP")?;
            let endpoint = fields.get(protocol_index + 1)?;
            let (address, port) = endpoint_parts(endpoint)?;
            Some(PortMetric {
                protocol: fields[protocol_index].to_ascii_lowercase(),
                address,
                port,
                process: fields.first().map(|item| (*item).to_string()),
                pid: fields.get(1).and_then(|item| item.parse().ok()),
            })
        })
        .collect()
}

/// Parse the stable pipe-delimited PowerShell output used for local Windows listeners.
#[cfg(any(windows, test))]
pub fn parse_windows_ports(output: &str) -> Vec<PortMetric> {
    output
        .lines()
        .filter_map(|line| {
            let mut fields = line.trim().splitn(4, '|');
            let protocol = fields.next()?.trim().to_ascii_lowercase();
            let address = fields.next()?.trim().to_string();
            let port = fields.next()?.trim().parse().ok()?;
            let pid = fields.next()?.trim().parse().ok();
            Some(PortMetric {
                protocol,
                address,
                port,
                process: None,
                pid,
            })
        })
        .collect()
}

fn limit_ports(mut ports: Vec<PortMetric>) -> (Vec<PortMetric>, bool) {
    ports.sort_by(|left, right| {
        left.port
            .cmp(&right.port)
            .then(left.protocol.cmp(&right.protocol))
            .then(left.address.cmp(&right.address))
    });
    let truncated = ports.len() > PORT_LIMIT;
    ports.truncate(PORT_LIMIT);
    (ports, truncated)
}

fn collect_local_ports() -> (Vec<PortMetric>, bool, MetricStatus) {
    #[cfg(target_os = "linux")]
    let command = ("ss", vec!["-H", "-lntup"]);
    #[cfg(target_os = "macos")]
    let command = ("lsof", vec!["-nP", "-iTCP", "-sTCP:LISTEN", "-iUDP"]);
    #[cfg(windows)]
    let command = ("powershell", vec!["-NoProfile", "-Command", "$ErrorActionPreference='SilentlyContinue'; Get-NetTCPConnection -State Listen | ForEach-Object { 'tcp|{0}|{1}|{2}' -f $_.LocalAddress,$_.LocalPort,$_.OwningProcess }; Get-NetUDPEndpoint | ForEach-Object { 'udp|{0}|{1}|{2}' -f $_.LocalAddress,$_.LocalPort,$_.OwningProcess }"]);

    let result = Command::new(command.0).args(command.1).output();
    match result {
        Ok(output) if output.status.success() => {
            #[cfg(target_os = "linux")]
            let ports = parse_ss_ports(&String::from_utf8_lossy(&output.stdout));
            #[cfg(target_os = "macos")]
            let ports = parse_lsof_ports(&String::from_utf8_lossy(&output.stdout));
            #[cfg(windows)]
            let ports = parse_windows_ports(&String::from_utf8_lossy(&output.stdout));
            let (ports, truncated) = limit_ports(ports);
            (ports, truncated, MetricStatus::available())
        }
        Ok(output) => (
            Vec::new(),
            false,
            MetricStatus::unavailable(String::from_utf8_lossy(&output.stderr).trim().to_string()),
        ),
        Err(_) => (
            Vec::new(),
            false,
            MetricStatus::unavailable("无法运行端口采集工具"),
        ),
    }
}

/// Stop a local listener process by PID without escalating privileges.
/// Unix sends SIGTERM; Windows terminates the selected process tree through taskkill.
pub fn stop_local_port_process(pid: u32) -> Result<(), String> {
    if pid == 0 {
        return Err("无效的进程 PID".to_string());
    }
    #[cfg(windows)]
    let output = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .output()
        .map_err(|error| format!("无法执行 taskkill: {}", error))?;
    #[cfg(not(windows))]
    let output = Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .output()
        .map_err(|error| format!("无法执行 kill: {}", error))?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() {
            format!("停止 PID {} 失败", pid)
        } else {
            stderr
        })
    }
}

/// Refresh and return the ten resident-memory-heaviest local processes.
fn collect_local_processes(system: &mut System) -> Vec<ProcessMetric> {
    system.refresh_processes(ProcessesToUpdate::All, true);
    let mut processes: Vec<_> = system
        .processes()
        .values()
        .filter_map(|process| {
            let pid = process.pid().as_u32();
            (pid != 0).then(|| ProcessMetric {
                pid,
                name: process.name().to_string_lossy().to_string(),
                cpu_percent: process.cpu_usage(),
                memory: process.memory(),
            })
        })
        .collect();
    processes.sort_by_key(|process| std::cmp::Reverse(process.memory));
    processes.truncate(10);
    processes
}

pub fn local_snapshot(system: &mut System) -> PerformanceSnapshot {
    system.refresh_cpu_usage();
    system.refresh_memory();
    let total = system.total_memory();
    let used = system.used_memory();
    let (gpus, gpu_status) = collect_gpus();
    let (ports, ports_truncated, ports_status) = collect_local_ports();
    let processes = collect_local_processes(system);
    PerformanceSnapshot {
        captured_at: now_ms(),
        cpu: CpuMetric {
            usage_percent: system.global_cpu_usage(),
            cores: system.cpus().len(),
        },
        memory: MemoryMetric {
            total,
            used,
            usage_percent: percentage(used, total),
        },
        disks: local_disks(),
        gpus,
        ports,
        ports_truncated,
        processes,
        gpu_status,
        ports_status,
        processes_status: MetricStatus::available(),
    }
}

fn cpu_totals(line: &str) -> Option<(u64, u64)> {
    let values: Vec<u64> = line
        .split_whitespace()
        .skip(1)
        .filter_map(|item| item.parse().ok())
        .collect();
    if values.len() < 4 {
        return None;
    }
    let total = values.iter().sum();
    let idle = values[3] + values.get(4).copied().unwrap_or(0);
    Some((total, idle))
}

fn parse_df(output: &str) -> Vec<DiskMetric> {
    let mut disks: Vec<_> = output
        .lines()
        .skip(1)
        .filter_map(|line| {
            let parts: Vec<_> = line.split_whitespace().collect();
            if parts.len() < 6
                || matches!(parts[0], "tmpfs" | "devtmpfs" | "overlay")
                || ["/proc", "/sys", "/run", "/dev", "/boot", "/efi"]
                    .iter()
                    .any(|prefix| {
                        parts[5] == *prefix || parts[5].starts_with(&format!("{prefix}/"))
                    })
            {
                return None;
            }
            let total = parts[1].parse().ok()?;
            let used = parts[2].parse().ok()?;
            let available = parts[3].parse().ok()?;
            Some(DiskMetric {
                name: parts[0].to_string(),
                mount_point: parts[5].to_string(),
                total,
                used,
                available,
            })
        })
        .collect();

    // A bind mount is reported once per path by `df`. Keep one representative
    // for each filesystem, preferring `/` and then the shortest mount point.
    disks.sort_by_key(|disk| (disk.mount_point != "/", disk.mount_point.len()));
    let mut seen_filesystems = HashSet::new();
    disks.retain(|disk| seen_filesystems.insert(disk.name.clone()));
    disks
}

/// Parse the `ps` PID/name/CPU/RSS rows emitted by the fixed remote collector script.
pub fn parse_processes(output: &str) -> Vec<ProcessMetric> {
    output
        .lines()
        .filter_map(|line| {
            let fields: Vec<_> = line.split_whitespace().collect();
            if fields.len() < 4 {
                return None;
            }
            Some(ProcessMetric {
                pid: fields[0].parse().ok()?,
                name: fields[1].to_string(),
                cpu_percent: fields[2].parse().ok()?,
                memory: fields[3].parse::<u64>().ok()?.saturating_mul(1024),
            })
        })
        .collect()
}

const REMOTE_SCRIPT: &str = "printf '__ET_CPU_A__\\n'; head -1 /proc/stat; sleep 0.15; printf '__ET_CPU_B__\\n'; head -1 /proc/stat; printf '__ET_MEM__\\n'; awk '/MemTotal:|MemAvailable:/{print $1,$2}' /proc/meminfo; printf '__ET_DF__\\n'; df -P -B1; printf '__ET_GPU__\\n'; command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi --query-gpu=name,utilization.gpu,memory.total,memory.used --format=csv,noheader,nounits || true; printf '__ET_PORTS__\\n'; command -v ss >/dev/null 2>&1 && ss -H -lntup | head -n 201 || true; printf '__ET_PROCESSES__\\n'; ps -eo pid=,comm=,%cpu=,rss= --sort=-rss 2>/dev/null | head -n 10 || true";

fn tagged_section<'a>(text: &'a str, tag: &str, next_tags: &[&str]) -> &'a str {
    let Some(start) = text.find(tag) else {
        return "";
    };
    let rest = &text[start + tag.len()..];
    let end = next_tags
        .iter()
        .filter_map(|next| rest.find(next))
        .min()
        .unwrap_or(rest.len());
    rest[..end].trim()
}

pub fn parse_remote_snapshot(output: &str) -> Result<PerformanceSnapshot, String> {
    let cpu_a = tagged_section(output, "__ET_CPU_A__", &["__ET_CPU_B__"]);
    let cpu_b = tagged_section(output, "__ET_CPU_B__", &["__ET_MEM__"]);
    let (total_a, idle_a) =
        cpu_totals(cpu_a.lines().next().unwrap_or("")).ok_or("远端 CPU 数据无效")?;
    let (total_b, idle_b) =
        cpu_totals(cpu_b.lines().next().unwrap_or("")).ok_or("远端 CPU 数据无效")?;
    let total_delta = total_b.saturating_sub(total_a);
    let idle_delta = idle_b.saturating_sub(idle_a);
    let cpu_usage = if total_delta == 0 {
        0.0
    } else {
        (total_delta.saturating_sub(idle_delta)) as f32 * 100.0 / total_delta as f32
    };
    let mem = tagged_section(output, "__ET_MEM__", &["__ET_DF__"]);
    let mut memory_total = 0u64;
    let mut memory_available = 0u64;
    for line in mem.lines() {
        let parts: Vec<_> = line.split_whitespace().collect();
        if parts.len() != 2 {
            continue;
        }
        if parts[0].starts_with("MemTotal") {
            memory_total = parts[1].parse::<u64>().unwrap_or(0) * 1024;
        }
        if parts[0].starts_with("MemAvailable") {
            memory_available = parts[1].parse::<u64>().unwrap_or(0) * 1024;
        }
    }
    let memory_used = memory_total.saturating_sub(memory_available);
    let gpu_section = tagged_section(output, "__ET_GPU__", &["__ET_PORTS__"]);
    let gpus = parse_nvidia_smi(gpu_section);
    let gpu_status = if gpus.is_empty() {
        MetricStatus::unavailable("远端未提供 nvidia-smi GPU 数据")
    } else {
        MetricStatus::available()
    };
    let ports_section = tagged_section(output, "__ET_PORTS__", &["__ET_PROCESSES__"]);
    let (ports, ports_truncated) = limit_ports(parse_ss_ports(ports_section));
    let ports_status = if ports_section.is_empty() {
        MetricStatus::unavailable("远端未安装 ss 或无权限读取端口")
    } else {
        MetricStatus::available()
    };
    let processes_section = tagged_section(output, "__ET_PROCESSES__", &[]);
    let processes = parse_processes(processes_section);
    let processes_status = if processes_section.is_empty() {
        MetricStatus::unavailable("远端无法读取进程资源信息")
    } else {
        MetricStatus::available()
    };
    Ok(PerformanceSnapshot {
        captured_at: now_ms(),
        cpu: CpuMetric {
            usage_percent: cpu_usage,
            cores: 0,
        },
        memory: MemoryMetric {
            total: memory_total,
            used: memory_used,
            usage_percent: percentage(memory_used, memory_total),
        },
        disks: parse_df(tagged_section(output, "__ET_DF__", &["__ET_GPU__"])),
        gpus,
        ports,
        ports_truncated,
        processes,
        gpu_status,
        ports_status,
        processes_status,
    })
}

pub fn remote_script() -> &'static str {
    REMOTE_SCRIPT
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_ss_output() {
        let ports = parse_ss_ports(
            "tcp LISTEN 0 4096 127.0.0.1:22 0.0.0.0:* users:((\"sshd\",pid=12,fd=3))",
        );
        assert_eq!(ports[0].port, 22);
        assert_eq!(ports[0].pid, Some(12));
    }
    #[test]
    fn parses_windows_listener_output() {
        let ports = parse_windows_ports("tcp|0.0.0.0|8080|42\nudp|::|5353|77\n");
        assert_eq!(ports.len(), 2);
        assert_eq!(ports[0].protocol, "tcp");
        assert_eq!(ports[1].pid, Some(77));
    }
    #[test]
    fn parses_process_rows() {
        let processes = parse_processes("42 node 12.5 2048\n77 python 0.0 1024\n");
        assert_eq!(processes.len(), 2);
        assert_eq!(processes[0].memory, 2048 * 1024);
        assert_eq!(processes[1].name, "python");
    }
    #[test]
    fn parses_remote_output_without_gpu() {
        let snapshot = parse_remote_snapshot("__ET_CPU_A__\ncpu 10 0 5 80 0\n__ET_CPU_B__\ncpu 20 0 10 90 0\n__ET_MEM__\nMemTotal: 1000\nMemAvailable: 400\n__ET_DF__\nFilesystem 1B-blocks Used Available Use% Mounted on\n/dev/sda 100 60 40 60% /\n__ET_GPU__\n__ET_PORTS__\n").unwrap();
        assert_eq!(snapshot.memory.used, 600 * 1024);
        assert_eq!(snapshot.gpu_status.state, "unavailable");
    }
    #[test]
    fn filters_boot_partitions_and_deduplicates_bind_mounts() {
        let disks = parse_df("Filesystem 1B-blocks Used Available Use% Mounted on\n/dev/sda1 100 60 40 60% /\n/dev/sda1 100 60 40 60% /app/model\n/dev/sdb1 200 10 190 5% /app/model\n/dev/sda2 100 1 99 1% /boot/efi\n");
        assert_eq!(disks.len(), 2);
        assert_eq!(disks[0].mount_point, "/");
        assert_eq!(disks[1].mount_point, "/app/model");
        assert_eq!(disks[1].name, "/dev/sdb1");
    }
}
