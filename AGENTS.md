# AGENTS.md — Easy Terminal 项目 AI 开发指南

## 项目概述

Easy Terminal 是一个面向开发者的**桌面终端工作台**，基于 **Tauri 2 + Vanilla TypeScript + Rust + xterm.js** 构建。它将传统终端拆成可拖拽、可缩放的画布窗口，并集成 SSH 远程管理、命令知识库、历史回放、命令映射、全局快捷键和自动更新等功能。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | Vanilla TypeScript（无 React/Vue） |
| 构建工具 | Vite 6 |
| 桌面壳 | Tauri 2 |
| 后端 | Rust（portable-pty、ssh2、rusqlite） |
| 终端渲染 | xterm.js 5 (@xterm/xterm) |
| 代码编辑 | CodeMirror 6 |
| 搜索引擎 | FlexSearch |
| 包管理 | pnpm |
| 数据存储 | SQLite（命令库/历史/配置） |

---

## 项目结构

```
easy_terminal/
├── src/                          # 前端 TypeScript 源码
│   ├── main.ts                   # 应用入口，初始化所有模块
│   ├── canvas.ts                 # 无限画布控制器（平移/缩放/拖拽创建/对齐辅助线）
│   ├── terminal-manager.ts       # 终端实例管理器（创建/关闭/聚焦/复制粘贴/SSH 终端）
│   ├── terminal-window.ts        # 单个终端窗口组件（xterm.js + 拖拽/缩放/标题栏）
│   ├── command-intelligence.ts   # 命令智能引擎（补全/映射/历史/搜索/ghost text）
│   ├── command-suggest.ts        # 命令补全弹出层 UI 控制器
│   ├── command-config.ts         # 命令管理面板（CRUD/分类/导入导出）
│   ├── command-market.ts         # 命令市场面板（在线命令库发现/安装/卸载）
│   ├── command-intercept.ts      # 命令拦截与 SSH 命令构建
│   ├── command-intelligence.ts   # 命令智能（聚合系统命令/历史/映射/SSH配置的联想）
│   ├── shell-parse.ts            # Shell 命令行解析器
│   ├── placeholder.ts            # 命令占位符解析与 Tab 跳转
│   ├── file-tree.ts              # 文件树面板（本地+远程文件浏览/CRUD/拖拽/收藏/排序）
│   ├── file-preview.ts           # 文件预览弹层（语法高亮只读预览）
│   ├── file-editor.ts            # 文件编辑器（CodeMirror 6，支持本地和远程文件）
│   ├── ssh-panel.ts              # SSH 配置面板（主机分组/认证/跳板机/连接测试）
│   ├── history-panel.ts          # 历史命令面板（按时间/频率沉淀/复用）
│   ├── mapping-panel.ts          # 命令映射面板（自然语言 → 真实命令）
│   ├── sidebar.ts                # 左侧图标导航栏
│   ├── settings.ts               # 设置面板（主题/语言/会话恢复/自动更新）
│   ├── app-update.ts             # 应用自动更新管理器
│   ├── shortcut-manager.ts       # 快捷键管理器（跨平台绑定/匹配）
│   ├── shortcut-panel.ts         # 快捷键配置面板
│   ├── global-shortcut.ts        # 全局快捷键注册（自由画布模式）
│   ├── desktop-draw.ts           # 自由画布模式（全屏框选生成独立终端窗口）
│   ├── detached-terminal.ts      # 独立终端窗口模式（无边框原生窗口）
│   ├── mode-bootstrap.ts         # 模式引导（根据 URL 参数选择主/绘制/独立模式）
│   ├── i18n.ts                   # 国际化（中英文，手动 key-value 映射）
│   ├── types.ts                  # 全局 TypeScript 类型定义
│   ├── perf.ts                   # 性能追踪工具
│   └── styles.css                # 全局样式（CSS 变量主题系统：dark/light/warm）
│
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── lib.rs                # Tauri 入口：注册所有命令、窗口管理、全局快捷键
│   │   ├── main.rs               # 应用 main 函数
│   │   ├── pty.rs                # PTY 进程管理（portable-pty，创建/写入/调整大小/销毁）
│   │   ├── ssh.rs                # SSH 功能（ssh2 连接/远程文件操作/SFTP 传输/跳板机）
│   │   ├── fs.rs                 # 本地文件系统操作（读取目录/创建/重命名/删除/预览）
│   │   ├── db.rs                 # SQLite 命令数据库（命令库 CRUD/搜索/导入导出）
│   │   ├── commands.rs           # 命令平台检测
│   │   ├── settings.rs           # 设置持久化（JSON 文件存储）
│   │   └── build.rs              # Tauri 构建脚本
│   ├── commands/                 # 内置命令库 JSON 文件
│   │   ├── system/               # 系统命令（darwin/linux/windows/ubuntu/arch）
│   │   └── custom/               # 自定义命令模板（git/docker/kubectl/python/rust/java 等）
│   ├── Cargo.toml                # Rust 依赖
│   └── tauri.conf.json           # Tauri 配置（窗口/打包/更新/安全）
│
├── index.html                    # 入口 HTML（自定义标题栏/侧栏/面板区/画布视口）
├── vite.config.ts                # Vite 配置
├── tsconfig.json                 # TypeScript 配置
├── package.json                  # 前端依赖
└── .github/workflows/            # CI/CD（release.yml, ci.yml）
```

---

## 架构设计

### 前端架构

前端采用**纯 Vanilla TypeScript + 类组件**模式，没有使用任何前端框架。每个功能面板都是一个独立的类，在 `main.ts` 中统一初始化并连接。

```
main.ts (入口)
├── Canvas            → 无限画布（平移/缩放/对齐辅助线）
├── TerminalManager   → 管理所有 TerminalWindow 实例
│   └── TerminalWindow → 单个终端（xterm.js + 拖拽/缩放/补全）
├── CommandIntelligence → 命令智能引擎（聚合多种来源的补全数据）
│   └── CommandSuggest  → 补全弹出层 UI
├── Sidebar           → 左侧导航
├── FileTree          → 文件管理面板
├── CommandConfigPanel→ 命令管理面板
├── CommandMarketPanel→ 命令市场面板
├── HistoryPanel      → 历史命令面板
├── MappingPanel      → 命令映射面板
├── SSHPanel          → SSH 配置面板
├── ShortcutPanel     → 快捷键面板
├── Settings          → 设置面板
└── AppUpdater        → 自动更新管理
```

### 三种运行模式

应用根据 URL 参数 `mode` 进入三种不同模式：

1. **主模式** (`index.html`)：完整的桌面终端工作台，包含画布、侧栏、面板
2. **自由画布绘制模式** (`?mode=desktop-draw`)：全屏透明窗口，用于框选区域创建独立终端
3. **独立终端模式** (`?mode=detached-terminal`)：无边框独立终端窗口，由自由画布创建

### 后端架构 (Rust/Tauri)

后端通过 Tauri Commands 暴露能力：

- **PTY 管理**：`create_pty`、`write_pty`、`resize_pty`、`kill_pty`
- **文件系统**：`read_dir`、`create_file`、`rename_entry`、`delete_entries`、`read_file_preview` 等
- **SSH**：`test_ssh_connection`、`read_remote_dir`、`download_remote_entries`、`upload_local_entries` 等
- **命令数据库**：`list_command_libraries`、`search_command_summaries`、`create_command`、`import_command_library` 等
- **设置**：`get_settings`、`save_settings`、`load_workspace_state`、`save_workspace_state` 等
- **窗口管理**：`open_desktop_draw_window`、`create_detached_terminal_window`、`sync_desktop_draw_shortcut`

### 数据持久化

- **SQLite 数据库**：命令库（libraries + commands 表），支持全文搜索
- **JSON 文件**：设置、SSH 配置、命令历史、命令映射、快捷键、工作区状态
- **工作区状态恢复**：画布平移/缩放 + 终端位置/大小/类型 + 活跃终端 ID

---

## 核心功能模块

### 1. 终端画布 (`canvas.ts`)

无限画布支持多终端并行。用户可以：
- 拖拽空白区域框选创建终端窗口
- 滚轮平移画布（Ctrl+滚轮缩放，Shift+滚轮水平移动）
- 终端窗口可拖拽移动和八方向缩放
- 对齐辅助线（吸附其他终端边缘）
- 右键菜单（对齐所有终端/新建终端）

### 2. 终端管理 (`terminal-manager.ts`, `terminal-window.ts`)

- 基于 xterm.js 渲染终端，通过 Tauri PTY command 与系统 shell 交互
- 每个终端窗口有独立的标题栏（红黄绿按钮）
- 支持最小化、最大化、关闭
- 支持 Ctrl/Cmd+D 复制终端，Ctrl/Cmd+Shift+D 粘贴终端
- 终端间拖拽排序和 Z 轴管理
- 冻结/解冻机制（拖拽/缩放时冻结其他终端提升性能）

### 3. 命令智能补全 (`command-intelligence.ts`, `command-suggest.ts`)

命令输入时的智能联想系统，聚合以下数据源：
- 系统命令库（按平台自动加载）
- 自定义命令库（用户创建/导入）
- 命令历史（按时间和频率排序）
- 命令映射（触发词匹配）
- SSH 配置（`ssh` 命令自动补全已配置服务器）

支持：
- Ghost text（幽灵文本预览建议）
- 命令占位符 Tab 跳转
- 内联语法高亮（命令/参数/路径/变量分色）
- 详情弹窗（用法/示例/别名/标签）

### 4. SSH 远程管理 (`ssh-panel.ts`, `ssh.rs`)

- 主机分组管理
- 支持密码认证和密钥认证
- 跳板机链路（ProxyJump）
- 连接测试
- 远程文件浏览（与本地文件树统一交互）
- SFTP 文件上传/下载（带进度条）
- 远程文件编辑（CodeMirror 6）
- 自动生成 SSH 连接命令并处理密码输入

### 5. 文件管理 (`file-tree.ts`)

- 本地和远程文件统一浏览
- 目录树展开/折叠
- 文件创建/重命名/删除
- 拖拽移动文件
- 收藏夹（快速访问常用目录）
- 排序和筛选
- 文件预览和编辑（CodeMirror 6，支持多语言语法高亮）
- 与终端上下文联动（活动终端 CWD 自动同步到文件树）

### 6. 命令市场 (`command-market.ts`)

- 在线命令库发现和安装
- 命令库预览（浏览内部命令）
- 安装/卸载/同步
- 基于 GitHub 仓库的命令库分发

### 7. 快捷键系统 (`shortcut-manager.ts`, `shortcut-panel.ts`)

- 跨平台快捷键配置（Windows/macOS/Linux 分别设置）
- 可视化录制快捷键
- 全局快捷键（自由画布模式，即使应用不在前台也能触发）
- 分类管理：终端操作 / 导航切换 / 工作台

### 8. 主题系统 (`styles.css`)

三种主题通过 CSS 变量切换：
- **Dark**：深色主题（Tokyo Night 风格）
- **Light**：亮色主题
- **Warm**：暖色主题

### 9. 国际化 (`i18n.ts`)

- 支持中文（zh-CN）和英文（en-US）
- 手动 key-value 映射，`t('key', ...args)` 函数
- 支持参数插值（`{0}`, `{1}` 占位符）
- 语言切换实时生效

### 10. 自动更新 (`app-update.ts`)

- 基于 Tauri Updater 插件
- 启动时自动检查（可配置）
- 下载进度展示
- GitHub Releases 分发

---

## 开发命令

```bash
# 安装依赖
pnpm install

# 启动开发模式（需要 Tauri 2 构建环境）
pnpm tauri dev

# 类型检查
pnpm typecheck

# 构建前端
pnpm build

# 构建桌面应用
pnpm tauri build

# 按平台构建
pnpm build:mac          # macOS 通用二进制
pnpm build:mac-arm      # macOS ARM
pnpm build:mac-intel    # macOS Intel
pnpm build:windows      # Windows
pnpm build:linux        # Linux
```

### 环境要求

- Node.js 20+
- pnpm 9+
- Rust stable
- Tauri 2 构建环境（macOS 需要 Xcode，Windows 需要 Visual Studio Build Tools）

---

## 编码规范

### TypeScript

- 使用 ES2020 目标，ESNext 模块
- 严格模式（`strict: true`）
- 未使用变量/参数检查
- 所有类型定义集中在 `src/types.ts`
- 类组件模式，每个功能模块一个文件
- 使用 Tauri 的 `invoke` 调用后端命令

### CSS

- 全局 CSS 变量主题系统
- 无 CSS 框架，手写所有样式
- 字体：Manrope（UI）、JetBrains Mono（终端/代码）
- 所有圆角设为 `0`（方形设计语言）
- 滚动条：细长透明，hover 时显示

### Rust

- 所有 Tauri Commands 使用 `#[tauri::command]` 宏
- 错误处理返回 `Result<T, String>`
- 状态管理通过 `tauri::State`
- 数据库操作使用 `rusqlite`
- SSH 使用 `ssh2` crate

---

## 前后端交互

前端通过 `@tauri-apps/api/core` 的 `invoke` 函数调用 Rust 后端命令：

```typescript
// 调用 Tauri Command
const result = await invoke<ReturnType>('command_name', { param1, param2 });
```

PTY 交互使用 Tauri 的事件系统（`listen`/`emit`）：
- 前端写入：`invoke('write_pty', { sessionId, data })`
- 后端输出：通过 Tauri Event `pty-output-{sessionId}` 推送到前端

---

## 关键设计决策

1. **无前端框架**：选择 Vanilla TypeScript 避免框架开销，直接操作 DOM，保持轻量
2. **画布架构**：终端窗口作为绝对定位的 DOM 元素放在可平移/缩放的容器中
3. **双进程模型**：前端 TypeScript 负责 UI，后端 Rust 负责 PTY/文件系统/SSH/数据库
4. **SQLite 命令库**：命令数据存储在 SQLite 中，支持高效全文搜索
5. **自由画布终端**：通过多窗口实现，桌面绘制窗口和独立终端窗口是独立的 Tauri WebviewWindow
6. **会话恢复**：关闭应用时保存工作区状态（终端位置/大小/类型 + 画布状态），下次启动恢复
