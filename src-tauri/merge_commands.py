import json

# Read existing file
with open('commands/system/linux.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

existing_names = set(cmd['name'] for cmd in data['commands'])
print('Existing command count:', len(existing_names))

# New commands to add
new_commands = [
    {"name":"journalctl -u","alias":[],"name_cn":"查看服务日志","description":"查看指定systemd服务的日志","usage":"journalctl -u <service> -f","category":"日志管理","command":""},
    {"name":"journalctl -b","alias":[],"name_cn":"启动日志","description":"查看指定启动序号的日志","usage":"journalctl -b -1","category":"日志管理","command":""},
    {"name":"journalctl --since","alias":[],"name_cn":"时间范围日志","description":"查看指定时间之后的日志","usage":"journalctl --since \"2024-01-01\" --until \"2024-01-02\"","category":"日志管理","command":""},
    {"name":"journalctl --disk-usage","alias":[],"name_cn":"日志磁盘用量","description":"查看日志占用的磁盘空间","usage":"journalctl --disk-usage","category":"日志管理","command":""},
    {"name":"journalctl --vacuum-size","alias":[],"name_cn":"清理日志","description":"清理日志到指定大小","usage":"sudo journalctl --vacuum-size=100M","category":"日志管理","command":""},
    {"name":"dmesg -w","alias":[],"name_cn":"实时内核日志","description":"实时跟踪内核环形缓冲区日志","usage":"dmesg -w","category":"日志管理","command":""},
    {"name":"dmesg -l","alias":[],"name_cn":"按级别过滤日志","description":"按日志级别过滤内核消息","usage":"dmesg -l err,warn","category":"日志管理","command":""},
    {"name":"docker ps","alias":[],"name_cn":"容器列表","description":"列出运行中或所有Docker容器","usage":"docker ps [-a]","category":"容器","command":""},
    {"name":"docker images","alias":[],"name_cn":"镜像列表","description":"列出本地Docker镜像","usage":"docker images","category":"容器","command":""},
    {"name":"docker build","alias":[],"name_cn":"构建镜像","description":"从Dockerfile构建Docker镜像","usage":"docker build -t <name> .","category":"容器","command":""},
    {"name":"docker exec","alias":[],"name_cn":"容器内执行","description":"在运行中的容器内执行命令","usage":"docker exec -it <container> bash","category":"容器","command":""},
    {"name":"docker-compose","alias":["docker compose"],"name_cn":"容器编排","description":"管理多容器Docker应用","usage":"docker-compose up [-d]","category":"容器","command":""},
    {"name":"kubectl","alias":["k8s"],"name_cn":"Kubernetes管理","description":"Kubernetes集群命令行管理工具","usage":"kubectl get pods -A","category":"容器","command":""},
    {"name":"kubectl get","alias":[],"name_cn":"K8s资源查看","description":"查看Kubernetes集群资源","usage":"kubectl get pods/svc/deploy -n <namespace>","category":"容器","command":""},
    {"name":"kubectl describe","alias":[],"name_cn":"K8s资源详情","description":"显示Kubernetes资源详细信息","usage":"kubectl describe pod <pod-name>","category":"容器","command":""},
    {"name":"kubectl logs","alias":[],"name_cn":"K8s日志","description":"查看Kubernetes Pod容器日志","usage":"kubectl logs <pod-name> [-f]","category":"容器","command":""},
    {"name":"perf","alias":[],"name_cn":"性能分析","description":"Linux性能事件采样和分析工具","usage":"perf top","category":"系统调试","command":""},
    {"name":"bpftrace","alias":[],"name_cn":"eBPF追踪","description":"基于eBPF的高级追踪工具","usage":"bpftrace -e 'tracepoint:syscalls:sys-enter-open { printf(\"%s\\n\", comm); }'","category":"系统调试","command":""},
    {"name":"systemd-analyze","alias":[],"name_cn":"启动分析","description":"分析系统启动时间和服务依赖","usage":"systemd-analyze blame","category":"系统调试","command":""},
    {"name":"tshark","alias":[],"name_cn":"命令行抓包","description":"Wireshark命令行版网络协议分析器","usage":"sudo tshark -i eth0 -c 100","category":"网络工具","command":""},
    {"name":"nload","alias":[],"name_cn":"实时网络流量","description":"实时监控网络流量和带宽使用","usage":"nload","category":"网络工具","command":""},
    {"name":"iftop","alias":[],"name_cn":"带宽使用监控","description":"实时显示网络接口带宽使用情况","usage":"sudo iftop -i eth0","category":"网络工具","command":""},
    {"name":"ss -tulnp","alias":[],"name_cn":"端口监听详情","description":"显示所有TCP/UDP监听端口及进程","usage":"ss -tulnp","category":"网络工具","command":""},
    {"name":"ip addr","alias":[],"name_cn":"IP地址管理","description":"显示或管理网络接口IP地址","usage":"ip addr show","category":"网络工具","command":""},
    {"name":"ip link","alias":[],"name_cn":"链路层管理","description":"显示或管理网络链路层设备","usage":"ip link show","category":"网络工具","command":""},
    {"name":"ip route","alias":[],"name_cn":"路由管理","description":"显示或管理路由表","usage":"ip route show","category":"网络工具","command":""},
    {"name":"ip neigh","alias":[],"name_cn":"ARP/邻居表","description":"显示或管理ARP邻居表","usage":"ip neigh show","category":"网络工具","command":""},
    {"name":"nmcli con show","alias":[],"name_cn":"连接列表","description":"列出所有NetworkManager连接配置","usage":"nmcli con show","category":"网络工具","command":""},
    {"name":"nmcli dev wifi list","alias":[],"name_cn":"WiFi扫描","description":"扫描并列出可用WiFi网络","usage":"nmcli dev wifi list","category":"网络工具","command":""},
    {"name":"rg","alias":["ripgrep"],"name_cn":"快速搜索","description":"ripgrep正则表达式搜索工具，比grep快得多","usage":"rg <pattern> [path]","category":"文本处理","command":""},
    {"name":"fd","alias":[],"name_cn":"快速查找","description":"fd是find的现代替代，语法更简洁","usage":"fd <pattern> [path]","category":"文本处理","command":""},
    {"name":"bat","alias":[],"name_cn":"语法高亮查看","description":"cat的增强版，支持语法高亮和行号","usage":"bat <file>","category":"文本处理","command":""},
    {"name":"eza","alias":["exa"],"name_cn":"现代ls","description":"ls的现代替代，支持颜色和Git状态","usage":"eza -la","category":"文本处理","command":""},
    {"name":"dust","alias":[],"name_cn":"可视化磁盘","description":"du的现代替代，可视化显示磁盘使用","usage":"dust [path]","category":"文本处理","command":""},
    {"name":"tokei","alias":[],"name_cn":"代码统计","description":"快速统计代码行数，支持多语言","usage":"tokei [path]","category":"文本处理","command":""},
    {"name":"hyperfine","alias":[],"name_cn":"基准测试","description":"命令行基准测试工具，支持统计分析","usage":"hyperfine '<command1>' '<command2>'","category":"文本处理","command":""},
    {"name":"neofetch","alias":[],"name_cn":"系统信息展示","description":"在终端以ASCII艺术显示系统信息","usage":"neofetch","category":"系统信息","command":""},
    {"name":"fastfetch","alias":[],"name_cn":"快速系统信息","description":"neofetch的C语言重写版，速度更快","usage":"fastfetch","category":"系统信息","command":""},
    {"name":"inxi","alias":[],"name_cn":"硬件信息汇总","description":"强大的系统硬件和软件信息报告工具","usage":"inxi -F","category":"系统信息","command":""},
    {"name":"lshw","alias":[],"name_cn":"硬件列表","description":"列出详细硬件配置信息","usage":"sudo lshw -short","category":"系统信息","command":""},
    {"name":"btop","alias":[],"name_cn":"资源监控","description":"美观的系统资源监控工具（htop替代）","usage":"btop","category":"系统信息","command":""},
    {"name":"flatpak","alias":[],"name_cn":"Flatpak管理","description":"Flatpak通用Linux应用管理器","usage":"flatpak [install|remove|list|update]","category":"包管理","command":""},
    {"name":"flatpak install","alias":[],"name_cn":"安装Flatpak","description":"从远程仓库安装Flatpak应用","usage":"flatpak install <app-id>","category":"包管理","command":""},
    {"name":"flatpak remote-add","alias":[],"name_cn":"添加Flatpak源","description":"添加Flatpak远程仓库（如Flathub）","usage":"flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo","category":"包管理","command":""},
    {"name":"btrfs subvolume","alias":[],"name_cn":"Btrfs子卷","description":"管理Btrfs文件系统子卷","usage":"btrfs subvolume create/list/delete <path>","category":"文件系统","command":""},
    {"name":"btrfs snapshot","alias":[],"name_cn":"Btrfs快照","description":"创建或删除Btrfs子卷快照","usage":"btrfs subvolume snapshot <src> <dest>","category":"文件系统","command":""},
    {"name":"btrfs scrub","alias":[],"name_cn":"Btrfs数据校验","description":"校验Btrfs文件系统数据完整性","usage":"sudo btrfs scrub start <path>","category":"文件系统","command":""},
    {"name":"zfs","alias":[],"name_cn":"ZFS管理","description":"ZFS文件系统管理工具","usage":"zfs list","category":"文件系统","command":""},
    {"name":"zpool","alias":[],"name_cn":"ZFS存储池","description":"ZFS存储池管理工具","usage":"zpool status","category":"文件系统","command":""},
    {"name":"fstrim","alias":[],"name_cn":"SSD优化","description":"在SSD上回收未使用的块（TRIM）","usage":"sudo fstrim -v /","category":"文件系统","command":""},
    {"name":"tune2fs","alias":[],"name_cn":"ext文件系统调优","description":"调整ext2/3/4文件系统参数","usage":"sudo tune2fs -l <device>","category":"文件系统","command":""},
    {"name":"resize2fs","alias":[],"name_cn":"ext文件系统扩缩","description":"调整ext2/3/4文件系统大小","usage":"sudo resize2fs <device> <size>","category":"文件系统","command":""},
    {"name":"ffmpeg","alias":[],"name_cn":"音视频处理","description":"强大的音视频录制、转换和流媒体工具","usage":"ffmpeg -i <input> -c:v libx264 <output.mp4>","category":"音视频","command":""},
    {"name":"ffprobe","alias":[],"name_cn":"音视频分析","description":"分析多媒体文件流信息","usage":"ffprobe <file>","category":"音视频","command":""},
    {"name":"aria2c","alias":[],"name_cn":"多线程下载","description":"支持多协议多线程的下载工具","usage":"aria2c -x 16 <url>","category":"下载工具","command":""},
    {"name":"yt-dlp","alias":[],"name_cn":"视频下载","description":"youtube-dl的活跃分支，支持1000+网站","usage":"yt-dlp <url>","category":"下载工具","command":""},
]

# Check for duplicates
duplicates = []
to_add = []
for cmd in new_commands:
    if cmd['name'] in existing_names:
        duplicates.append(cmd['name'])
    else:
        to_add.append(cmd)

print()
if duplicates:
    print('Duplicate commands (will be skipped):')
    for d in duplicates:
        print(f'  - {d}')
else:
    print('No duplicate commands found.')
print()
print('New commands to add:', len(to_add))
print('Duplicates skipped:', len(duplicates))

# Add new commands
data['commands'].extend(to_add)

# Write back
with open('commands/system/linux.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write('\n')

print()
print('Total commands after merge:', len(data['commands']))
print('File written successfully.')
