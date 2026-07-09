# 终端画布交互优化与终端文件面板 — 设计文档

日期: 2026-07-09
状态: 已确认（用户在澄清问答中全部选择推荐项）

## 背景

当前问题：
1. 点击切换终端（含 SSH）会触发 420ms 的 `terminalPopIn` 缩放弹入动画，用户希望点击只是瞬间高亮，动画仅在移动/缩放时出现。
2. 文件列表只存在于底部导航栏打开的全局文件管理面板，没有"画出来的终端旁边"的文件列表。
3. 终端 CWD 联动功能被错误地放在了全局文件管理面板上（随活动终端切换本地/远程策略），而非各终端自带的文件列表。

## 现状关键事实（来自代码探查）

- `terminalPopIn` 入场动画：`TerminalWindow.css:10-26`（`animation: terminalPopIn 420ms ...` + `@keyframes`）。播完后加 `.appeared` 永久关闭（`TerminalWindow.ts:966-974`）。
- `.focused` 高亮（accent 边框 + `--shadow-focus`）已定义（`TerminalWindow.css:28-31`），但 `isFocused` 从未被父组件触发——`focus()`/`blur()` 方法存在（`TerminalWindow.ts:903-912`）却无人调用，属于"接好线但没通电"。
- 边框/阴影的 220ms 过渡（`transition: box-shadow 220ms ease, border-color 220ms ease`）使高亮平滑出现，正是期望的"高亮效果"。
- 仅有一个全局 `FileTree`（左侧浮层），通过 `AppLayout.syncFileTreeStrategy` 随活动终端切本地/远程。
- `FileTree` 已暴露 `syncToTerminal({cwd})`（`FileTree.ts:587`）但从未被调用；`locateToCwd` 仅由"定位"按钮触发。
- 终端 CWD 来自 `term.onTitleChange` → `currentCwd`（`TerminalWindow.ts:388-394`）。

## 设计决策

采用方案 A：**文件面板作为 TerminalWindow 内部子组件**（终端右侧吸附槽），与终端共享同一 DOM 单元，移动/缩放天然跟随。

用户确认：
1. 面板默认常驻显示（每个终端自带），可拖拽分隔条调宽，暂不做收起按钮。
2. 底部"定位"按钮保留但仅本地终端生效。
3. 移除 popIn 后终端瞬间出现 + 平滑 accent 高亮。

---

## 功能 1：移除点击触发的缩放弹入动画 + 接通高亮

### 改动

1. **删除 popIn 动画** — `TerminalWindow.css`：删除 `animation: terminalPopIn ...`（line 10-11）、`.appeared` 规则（19-21）、`@keyframes terminalPopIn`（23-26）。终端改为瞬间出现（无 transform 动画）。
2. **删除 `.appeared` 注册死代码** — `TerminalWindow.ts:966-974` 的 `onMounted` 中 `markAppeared` 相关逻辑。
3. **保留** 220ms 的 `transition: box-shadow/border-color`——它让高亮平滑出现。
4. **接通 `.focused` 高亮** — `AppLayout.ts`：`watch(activeTerminalId)`，对激活终端调 `focus()`，其余调 `blur()`。复用现有 `focus()`/`blur()` 方法与 `terminalInstanceMap`。
5. **保留** 拖拽/缩放时的 `transition: none`（已有，`TerminalWindow.css:40-41`）。

### 验收

- 点击/切换终端（含 SSH）：无缩放弹动；accent 边框 + 焦点阴影平滑（220ms）出现。
- 拖拽/缩放：即时跟随，无过渡延迟。
- 创建新终端：瞬间出现，不弹入。

---

## 功能 2：终端右侧吸附文件面板 + 底部面板固定纯本地

### 新组件 `TerminalFilePanel`

路径：`src/views/terminal/TerminalFilePanel.ts/.vue/.css`

- 内部复用现有 `FileTree` 组件（不重写文件浏览能力），通过 ref 调用其暴露方法。
- Props：
  - `terminalId: string`
  - `cwd: string`（来自该终端 `currentCwd`）
  - `launchOptions: TerminalLaunchOptions`（判断 local/ssh、profileId）
  - `sshProfiles: SSHProfile[]`
- 挂载时：
  - SSH 终端 → `switchToRemote(profile, profiles)` 设远程策略。
  - 本地终端 → 保持默认本地策略。
  - 策略就绪后再用 `cwd` 做初始定位（避免用本地策略读远程路径）。
- 联动（功能 3 详见下节）：`watch(cwd)` → `fileTreeRef.syncToTerminal({cwd})`。
- 容器 CSS：在面板内部覆盖 `FileTree` 根 `.files-layout` 为 `position: relative; width/height: 100%`，使其填充吸附槽而非左浮层。

### TerminalWindow 集成

- `TerminalWindow.vue` 模板：`.terminal-body` 之后加 `<TerminalFilePanel>` + 一根可拖拽垂直分隔条。
- `TerminalWindow.ts`：新增 `filePanelWidth`（默认 220，min 160 / max 420）状态 + 拖拽分隔条 handler；透传 `currentCwd`、`launchOptions`、`sshProfiles`。
- 移动/缩放终端时面板天然跟随（同一 DOM）。

### 底部全局文件管理面板（固定纯本地）

- `AppLayout.ts`：移除 `syncFileTreeStrategy`（186-211）的远程切换逻辑及 `onFileTreeReady` 中的调用；`onTerminalActivate` 不再切策略。
- `AppLayout.vue`：底部 `FileTree` 移除 `@strategy-change` 远程相关处理（`onStrategyChange` 仅更新 PreviewPanel 策略，本地时为本地策略——保留以支持预览）。
- "定位当前终端目录"按钮：保留，但仅当活动终端为**本地**时生效（SSH 终端的远程 CWD 不适用于本地面板）。
- 远程文件浏览完全交给各终端旁边的 `TerminalFilePanel`。

---

## 功能 3：终端旁边文件列表与终端 CWD 自动联动

- `TerminalFilePanel`：`watch(() => props.cwd)` → `fileTreeRef.value?.syncToTerminal({ cwd: props.cwd })`。
- `FileTree.syncToTerminal`（`FileTree.ts:587`）已实现：`cwd !== currentPath` 时 `navigateTo(cwd)`。现在正式启用它。
- 终端内 `cd` → `onTitleChange` 更新 `currentCwd` → 透传给面板 `cwd` prop → watch 触发 → 面板自动跟随目录。全程无需手动定位按钮。

---

## 数据流

```
TerminalWindow
 ├── xterm 终端区 (cd → onTitleChange → currentCwd)
 ├── 分隔条 (面板宽度: 160-420, 默认 220)
 └── TerminalFilePanel (cwd prop, launchOptions, sshProfiles)
       └── FileTree (strategy: local|remote)
             挂载 → 按 launchOptions.mode 选策略 → 用 cwd 定位
             watch(cwd) → syncToTerminal → 自动跟随

底部 FileTree (AppLayout) → 固定本地策略，独立浏览本机文件
```

## 影响文件清单

| 文件 | 改动 |
|---|---|
| `src/views/terminal/TerminalWindow.css` | 删 popIn 动画/keyframes/`.appeared`；加面板槽 + 分隔条样式 |
| `src/views/terminal/TerminalWindow.ts` | 删 `.appeared` 死代码；加 `filePanelWidth` + 分隔条 handler；透传 cwd/launchOptions/sshProfiles；注册组件 |
| `src/views/terminal/TerminalWindow.vue` | 模板加 `<TerminalFilePanel>` + 分隔条 |
| `src/views/terminal/TerminalFilePanel.ts/.vue/.css` | **新增**：复用 FileTree，绑定终端，自动联动 |
| `src/views/layout/AppLayout.ts` | `watch(activeTerminalId)` 接通 focus/blur；移除底部面板远程切换；locate 限本地 |
| `src/views/layout/AppLayout.vue` | 底部 FileTree 绑定调整 |
| `src/types/terminal.ts` | 若 `TerminalLaunchOptions` 缺字段则补（预计无需） |

## 风险与权衡

- FileTree 含全局 `document` click/keydown 监听；多实例时各自只动自身状态（contextMenu/renaming），无冲突。
- FileTree `init()` 发 `ready`/`strategy-change` 事件——TerminalFilePanel 自行处理，不转发给 AppLayout，避免触发底部面板逻辑。
- 面板宽度持久化暂不做（YAGNI），如需后续可加到 workspace state。
