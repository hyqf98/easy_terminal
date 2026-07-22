use sysinfo::Disks;

#[cfg(target_os = "macos")]
fn is_macos_helper_volume(mount_point: &str) -> bool {
    mount_point.starts_with("/System/Volumes/")
}

#[cfg(not(target_os = "macos"))]
fn is_macos_helper_volume(_mount_point: &str) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::is_macos_helper_volume;

    #[test]
    fn excludes_shared_macos_apfs_helper_volumes() {
        assert!(is_macos_helper_volume("/System/Volumes/Data"));
        assert!(is_macos_helper_volume("/System/Volumes/Preboot"));
        assert!(!is_macos_helper_volume("/Volumes/External"));
        assert!(!is_macos_helper_volume("/"));
    }
}

#[derive(serde::Serialize)]
pub struct DiskInfo {
    pub name: String,
    pub mount_point: String,
    pub fs_type: String,
    pub total: u64,
    /// 系统当前可用空间。macOS 使用“重要用途可用容量”，与 Finder 口径一致。
    pub available: u64,
    pub used: u64,
    pub kind: String,
}

/// Linux 伪文件系统 / 虚拟挂载点，需要过滤掉。
fn is_pseudo_filesystem(mount_point: &str, fs: &str) -> bool {
    let pseudo_mounts = [
        "/dev",
        "/proc",
        "/sys",
        "/run",
        "/tmp",
        "/var/lib/docker",
        "/var/lib/containers",
        "/snap",
        "/boot/efi",
        "/boot",
    ];
    if pseudo_mounts
        .iter()
        .any(|m| mount_point == *m || mount_point.starts_with(&format!("{}/", m)))
    {
        return true;
    }
    let fs_lower = fs.to_lowercase();
    let pseudo_fs = ["tmpfs", "devtmpfs", "squashfs", "overlay", "loop"];
    if pseudo_fs.iter().any(|p| fs_lower == *p) {
        return true;
    }
    false
}

/// 判断 file_system() 返回的值是否是设备路径（如 `/dev/disk1s1`）而非真正的文件系统类型。
fn looks_like_device_path(fs: &str) -> bool {
    fs.is_empty() || fs.starts_with("/dev/") || fs.contains('/')
}

/// 将 sysinfo 提供的 file_system 原始值映射为人类可读的文件系统类型。
fn infer_fs_type(fs: &str, _mount_point: &str) -> String {
    let fs_trimmed = fs.trim();
    let fs_lower = fs_trimmed.to_lowercase();
    let known_types = [
        "apfs", "ntfs", "fat32", "exfat", "msdos", "fat", "ext2", "ext3", "ext4", "btrfs", "xfs",
        "zfs", "f2fs", "reiserfs", "hfs", "iso9660", "udf", "fuseblk", "fuse",
    ];

    // file_system() 返回的是真正的文件系统类型（非设备路径），直接使用。
    if !looks_like_device_path(fs_trimmed) && known_types.iter().any(|k| fs_lower == *k) {
        return fs_trimmed.to_string();
    }

    // file_system() 返回的是设备路径或为空，按平台做 best-effort 推断。
    #[cfg(target_os = "macos")]
    {
        let _ = &fs_lower;
        // macOS 根盘通常为 APFS；外挂卷多为 exFAT/APFS，统一返回 APFS 作为合理默认。
        "APFS".to_string()
    }
    #[cfg(windows)]
    {
        let _ = &fs_lower;
        // Windows 绝大多数系统盘为 NTFS。
        "NTFS".to_string()
    }
    #[cfg(all(not(target_os = "macos"), not(windows)))]
    {
        if looks_like_device_path(fs_trimmed) {
            "disk".to_string()
        } else {
            fs_trimmed.to_string()
        }
    }
}

/// 根据平台与挂载点推断磁盘类别。
fn infer_kind(mount_point: &str, is_removable: bool) -> String {
    #[cfg(windows)]
    {
        if is_removable {
            return "removable".to_string();
        }
        let upper = mount_point.to_uppercase();
        if upper.starts_with("C:\\") || upper.starts_with("C:/") || upper == "C:" {
            return "ssd".to_string();
        }
        "hdd".to_string()
    }
    #[cfg(target_os = "macos")]
    {
        let _ = is_removable;
        if mount_point.starts_with("/Volumes/") {
            return "external".to_string();
        }
        "ssd".to_string()
    }
    #[cfg(all(not(target_os = "macos"), not(windows)))]
    {
        let _ = is_removable;
        if mount_point.starts_with("/mnt/") || mount_point.starts_with("/media/") {
            return "external".to_string();
        }
        if mount_point.contains("gvfs")
            || mount_point.starts_with("//")
            || mount_point.contains(':')
        {
            return "network".to_string();
        }
        "ssd".to_string()
    }
}

#[tauri::command]
pub fn list_disks() -> Result<Vec<DiskInfo>, String> {
    let disks = Disks::new_with_refreshed_list();
    let mut result = Vec::new();
    // 仅按挂载点去重。不同卷可能恰好同名且容量相同，不能因此从“此电脑”中隐藏。
    let mut seen_mount_points = Vec::new();

    for disk in disks.list() {
        let mount_point = disk.mount_point().to_string_lossy().to_string();
        let fs_raw = disk.file_system().to_string_lossy().to_string();

        // 过滤伪文件系统、虚拟挂载点和共享根盘容量的 macOS APFS 辅助卷。
        if is_pseudo_filesystem(&mount_point, &fs_raw) || is_macos_helper_volume(&mount_point) {
            continue;
        }

        let total = disk.total_space();
        // 过滤总容量为 0 的磁盘。
        if total == 0 {
            continue;
        }

        let name = disk.name().to_string_lossy().to_string();
        let name = name.trim();
        let name = if name.is_empty() {
            mount_point.clone()
        } else {
            name.to_string()
        };

        if seen_mount_points.iter().any(|seen| seen == &mount_point) {
            continue;
        }
        seen_mount_points.push(mount_point.clone());

        let available = disk.available_space();
        let used = total.saturating_sub(available);
        let is_removable = disk.is_removable();

        result.push(DiskInfo {
            name,
            mount_point,
            fs_type: infer_fs_type(&fs_raw, disk.mount_point().to_string_lossy().as_ref()),
            total,
            available,
            used,
            kind: infer_kind(disk.mount_point().to_string_lossy().as_ref(), is_removable),
        });
    }

    Ok(result)
}
