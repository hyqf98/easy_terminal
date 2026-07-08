<template>
  <div id="app-resize-handles" aria-hidden="true">
    <div class="app-resize-handle app-resize-handle-n" data-resize-direction="North"></div>
    <div class="app-resize-handle app-resize-handle-s" data-resize-direction="South"></div>
    <div class="app-resize-handle app-resize-handle-e" data-resize-direction="East"></div>
    <div class="app-resize-handle app-resize-handle-w" data-resize-direction="West"></div>
    <div class="app-resize-handle app-resize-handle-ne" data-resize-direction="NorthEast"></div>
    <div class="app-resize-handle app-resize-handle-nw" data-resize-direction="NorthWest"></div>
    <div class="app-resize-handle app-resize-handle-se" data-resize-direction="SouthEast"></div>
    <div class="app-resize-handle app-resize-handle-sw" data-resize-direction="SouthWest"></div>
  </div>
  <Titlebar
    @minimize="onMinimize"
    @maximize="onMaximize"
    @close="onClose"
  />
  <main id="stage">
    <!-- 终端画布视图 -->
    <section class="view" :class="{ active: activeView === 'canvas' }" v-show="activeView === 'canvas'">
      <div class="canvas-stage" ref="viewportRef">
        <CanvasStatus />
        <CanvasMinimap />
        <div v-if="showHint" class="canvas-empty">
          <n-empty :description="hintLabel">
            <template #extra>
              <n-button type="primary" @click="openTerminalModal">
                {{ newTerminalLabel }}
              </n-button>
            </template>
          </n-empty>
        </div>
        <div id="canvas" ref="canvasRef">
          <TerminalWindow
            v-for="terminal in terminals"
            :key="terminal.id"
            :terminal-id="terminal.id"
            :initial-x="terminal.x"
            :initial-y="terminal.y"
            :initial-width="terminal.w"
            :initial-height="terminal.h"
            :launch-options="terminal.launchOptions"
            :z-index="terminal.zIndex"
            :snap-rect="snapRectFn"
            :clear-guides="clearGuidesFn"
            :viewport-zoom="canvasZoom"
            @activate="onTerminalActivate"
            @close="onTerminalClose"
            @command-executed="onCommandExecuted"
            @interaction-start="onTerminalInteractionStart"
            @interaction-end="onTerminalInteractionEnd"
          />
          <div id="selection-rect"></div>
        </div>
      </div>
      <TerminalModal
        :open="terminalModalOpen"
        @close="terminalModalOpen = false"
        @update:open="terminalModalOpen = $event"
        @create="onToolbarNewTerminal"
      />
    </section>

    <!-- 文件管理视图 -->
    <section class="view" v-show="activeView === 'files'">
      <FileTree ref="fileTreeRef" @open-terminal="onOpenTerminalAt" />
    </section>

    <!-- 命令管理视图 -->
    <section class="view" v-show="activeView === 'commands'">
      <CommandConfigPanel @commands-changed="onCommandsChanged" />
    </section>

    <!-- 命令市场视图 -->
    <section class="view" v-show="activeView === 'market'">
      <CommandMarketPanel ref="marketRef" @commands-changed="onCommandsChanged" />
    </section>

    <!-- 历史命令视图 -->
    <section class="view" v-show="activeView === 'history'">
      <HistoryPanel @send-command="onSendCommand" />
    </section>

    <!-- 命令映射视图 -->
    <section class="view" v-show="activeView === 'mappings'">
      <MappingPanel />
    </section>

    <!-- SSH 视图 -->
    <section class="view" v-show="activeView === 'ssh'">
      <SshPanel
        ref="sshPanelRef"
        @connect="onSshConnect"
        @profiles-change="onSshProfilesChange"
        @selection-change="onSshSelectionChange"
      />
    </section>

    <!-- 快捷键视图 -->
    <section class="view" v-show="activeView === 'shortcuts'">
      <ShortcutPanel />
    </section>

    <!-- 设置视图 -->
    <section class="view" v-show="activeView === 'settings'">
      <SettingsPanel ref="settingsRef" @theme-change="onThemeChange" />
    </section>
  </main>

  <Dock :active-view="activeView" @view-change="onViewChange" />
</template>
<script src="./AppLayout.ts"></script>
<style src="./AppLayout.css"></style>
