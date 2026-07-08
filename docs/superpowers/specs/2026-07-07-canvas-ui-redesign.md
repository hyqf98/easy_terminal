# Easy Terminal 自由画布 UI 全站重构

**Date:** 2026-07-07  
**Status:** Approved  
**Approach:** 保留自由画布核心 + Naive UI + Craft 温暖工艺主题

## 概述

保留自由画布（平移/缩放/框选创建终端）与浮动终端窗口（拖拽、八方向缩放），全面重构视觉与布局：引入 Naive UI、统一 Craft 主题、右侧遮罩抽屉、设置页双栏布局。

## 用户偏好

| 维度 | 选择 |
|------|------|
| 终端范式 | 保留自由画布 |
| 视觉气质 | 温暖工艺感 |
| UI 框架 | Naive UI |
| 工具面板 | 右侧 n-drawer 遮罩抽屉 |
| 终端装饰 | 迷你页眉 + 保留三色圆点 |

## 布局架构

- **Titlebar** — 应用级窗口控制
- **LeftRail (52px)** — 图标导航，点击打开右侧抽屉
- **CanvasStage** — 画布视口 + 浮动终端
- **RightDrawer** — n-drawer 遮罩式，280–560px 可拖拽

## 设计系统 Craft Theme

- 亮色：`#FAF7F2` 背景，`#C17F59` 强调色
- 暗色：`#1E1C1A` 背景，暖调不泛蓝
- 字号：11/12/13/15/18px 阶梯
- 圆角：6/8/12px
- UI 字体 Manrope，终端 JetBrains Mono Nerd Font

## 实施阶段

1. Phase 0 — Naive UI + ConfigProvider + Craft CSS
2. Phase 1 — AppLayout 三栏 + TerminalWindow 视觉 + Settings 重设计
3. Phase 2 — 面板迁移 Naive UI + 移除左侧 panel-area
4. Phase 3 — Craft Dark、清理 native-ui.css、画布空状态

## 保留模块

- `canvas.ts` — 平移缩放框选
- `TerminalWindow.ts` — xterm/PTY/补全/拖拽
- 工作区状态格式不变

## 废弃

- `native-ui.css`（Phase 3）
- `themes/dark.css`、`light.css`、`warm.css` → `craft.css`
