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
    @cmdk="onCmdk"
  />
  <main id="stage">
    <!-- 终端画布视图 -->
    <section class="view canvas-view" :class="{ active: activeView === 'canvas' }" v-show="activeView === 'canvas'">
      <div class="canvas-view-content">
        <div class="canvas-stage" ref="viewportRef">
        <CanvasMinimap />
        <div v-if="showHint" class="canvas-empty">
          <n-empty :description="hintLabel" />
        </div>
        <div id="canvas" ref="canvasRef">
          <TerminalWindow
            v-for="terminal in terminals"
            :key="`terminal-${terminal.id}`"
            :ref="(el) => { setTerminalRef(terminal.id, el); }"
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
            :ssh-profiles="sshProfiles"
            :platform="currentPlatform"
            :handle-file-preview="onTerminalFilePreview"
            :file-panel-open="filePanelTerminalId === terminal.id"
            :file-panel-inset="filePanelWidth"
            :performance-panel-open="isPerformancePanelOpen(terminal.id)"
            :performance-panel-inset="performancePanelWidth"
            :unified-panel-open="hasAttachedPanel(terminal)"
            :data-unified-terminal-id="terminal.id"
            @mouseenter="onUnifiedPointerEnter(terminal.id)"
            @mouseleave="(event) => onUnifiedPointerLeave(terminal.id, event)"
            @activate="onTerminalActivate"
            @close="onTerminalClose"
            @command-executed="(cmd, cwd) => onCommandExecuted(cmd, cwd, terminal.launchOptions)"
            @cwd-change="(cwd) => onTerminalCwdChange(terminal.id, cwd)"
            @interaction-start="onTerminalInteractionStart"
            @interaction-end="onTerminalInteractionEnd"
            @switch-ssh="(pid) => onSwitchSsh(terminal.id, pid)"
            @toggle-file-panel="onToggleFilePanel"
            @toggle-performance-panel="onTogglePerformancePanel"
            @rect-change="(id, rect) => onTerminalRectChange(id, rect)"
          />
          <template v-for="terminal in terminals.filter(hasAttachedPanel)" :key="`unified-group-${terminal.id}`">
          <div
            class="terminal-unified-titlebar"
            :class="getUnifiedWindowClasses(terminal)"
            :style="getUnifiedTitlebarStyle(terminal)"
            :data-unified-terminal-id="terminal.id"
            @mousedown.prevent="(event) => onUnifiedTitleDrag(terminal.id, event)"
            @mouseenter="onUnifiedPointerEnter(terminal.id)"
            @mouseleave="(event) => onUnifiedPointerLeave(terminal.id, event)"
          >
            <span class="resize-handle resize-n unified-title-resize-handle" aria-hidden="true" @mousedown.stop.prevent="(event) => onUnifiedResizeStart(terminal.id, 'n', event)"></span>
            <span class="resize-handle resize-nw unified-title-resize-handle" aria-hidden="true" @mousedown.stop.prevent="(event) => onUnifiedResizeStart(terminal.id, 'nw', event)"></span>
            <span class="resize-handle resize-ne unified-title-resize-handle" aria-hidden="true" @mousedown.stop.prevent="(event) => onUnifiedResizeStart(terminal.id, 'ne', event)"></span>
            <div class="terminal-dots unified-terminal-dots">
              <button class="terminal-dot dot-close" data-tooltip="关闭" @mousedown.stop @click.stop="onUnifiedClose(terminal.id)"></button>
              <button class="terminal-dot dot-minimize" data-tooltip="最小化" @mousedown.stop @click.stop="onUnifiedMinimize(terminal.id)"></button>
              <button class="terminal-dot dot-maximize" data-tooltip="最大化" @mousedown.stop @click.stop="onUnifiedMaximize(terminal.id)"></button>
            </div>
            <div class="terminal-title unified-terminal-title">
              <svg v-if="isUnifiedSsh(terminal)" class="terminal-title-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
              <svg v-else class="terminal-title-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
              <span class="terminal-title-name">{{ getUnifiedTitle(terminal) }}</span>
              <span v-if="getUnifiedCwd(terminal)" class="terminal-title-cwd" :data-tooltip="getUnifiedCwd(terminal)">{{ getUnifiedCwd(terminal) }}</span>
            </div>
            <div class="terminal-status unified-terminal-status">
              <div class="terminal-ssh-switch" v-if="sshProfiles.length > 0">
                <button
                  class="ssh-switch-btn"
                  :class="{ active: isUnifiedSsh(terminal) }"
                  :data-tooltip="isUnifiedSsh(terminal) ? '切换 SSH / 本地' : '连接 SSH 服务器'"
                  @mousedown.stop
                  @click.stop="toggleUnifiedSshMenu(terminal.id)"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
                </button>
                <div class="ssh-switch-menu unified-ssh-menu" v-if="unifiedSshMenuTerminalId === terminal.id" @mousedown.stop @click.stop>
                  <div v-if="!isUnifiedSsh(terminal)" class="ssh-switch-header">连接 SSH 服务器</div>
                  <button
                    v-for="p in sshProfiles"
                    :key="p.id"
                    class="ssh-switch-item"
                    @click="onUnifiedSwitchSsh(terminal.id, p.id)"
                  >{{ p.name }} ({{ p.user }}@{{ p.host }})</button>
                  <button v-if="isUnifiedSsh(terminal)" class="ssh-switch-item" @click="onUnifiedSwitchSsh(terminal.id, null)">切换为本地终端</button>
                </div>
              </div>
              <span :class="['status-pulse', getUnifiedStatusPulse(terminal)]"></span>
              <span>{{ getUnifiedStatusText(terminal) }}</span>
            </div>
          </div>
          </template>
          <!-- 文件面板：画布上独立元素，拼接在终端左侧（不挤压/不悬浮） -->
          <TerminalFilePanel
            v-if="filePanelTerminal"
            :key="`terminal-file-panel-${filePanelTerminal.id}`"
            :terminal-id="filePanelTerminal.id"
            :cwd="terminalCwds[filePanelTerminal.id] || filePanelTerminal.launchOptions.cwd || ''"
            :launch-options="filePanelTerminal.launchOptions"
            :ssh-profiles="sshProfiles"
            :style="filePanelStyle"
            :data-unified-terminal-id="filePanelTerminal.id"
            @mousedown="onTerminalActivate(filePanelTerminal.id)"
            @mouseenter="onUnifiedPointerEnter(filePanelTerminal.id)"
            @mouseleave="(event) => onUnifiedPointerLeave(filePanelTerminal.id, event)"
            @open-preview="onTerminalPanelPreview"
            @open-terminal="onOpenTerminalAt"
            @open-current-terminal="onOpenCurrentTerminalAt"
            @panel-resize-start="onPanelResizeStart"
          />
          <PerformancePanel
            v-for="terminal in terminals.filter((item) => isPerformancePanelOpen(item.id))"
            :key="`terminal-performance-panel-${terminal.id}`"
            :launch-options="terminal.launchOptions"
            :ssh-profiles="sshProfiles"
            :refresh-seconds="performanceRefreshSeconds"
            :style="getPerformancePanelStyle(terminal)"
            :data-unified-terminal-id="terminal.id"
            @mousedown="onTerminalActivate(terminal.id)"
            @mouseenter="onUnifiedPointerEnter(terminal.id)"
            @mouseleave="(event) => onUnifiedPointerLeave(terminal.id, event)"
            @panel-resize-start="(event) => onPerformancePanelResizeStart(terminal.id, event)"
            @close="onTogglePerformancePanel(terminal.id)"
          />
          <template v-for="terminal in terminals.filter(hasAttachedPanel)" :key="`unified-shell-group-${terminal.id}`">
          <div
            class="terminal-unified-window"
            :class="getUnifiedWindowClasses(terminal)"
            :style="getUnifiedWindowStyle(terminal)"
            :data-unified-terminal-id="terminal.id"
            aria-hidden="true"
          >
            <span class="resize-handle resize-n" @mousedown.stop.prevent="(event) => onUnifiedResizeStart(terminal.id, 'n', event)"></span>
            <span class="resize-handle resize-s" @mousedown.stop.prevent="(event) => onUnifiedResizeStart(terminal.id, 's', event)"></span>
            <span class="resize-handle resize-e" @mousedown.stop.prevent="(event) => onUnifiedResizeStart(terminal.id, 'e', event)"></span>
            <span class="resize-handle resize-w" @mousedown.stop.prevent="(event) => onUnifiedResizeStart(terminal.id, 'w', event)"></span>
            <span class="resize-handle resize-ne" @mousedown.stop.prevent="(event) => onUnifiedResizeStart(terminal.id, 'ne', event)"></span>
            <span class="resize-handle resize-nw" @mousedown.stop.prevent="(event) => onUnifiedResizeStart(terminal.id, 'nw', event)"></span>
            <span class="resize-handle resize-se" @mousedown.stop.prevent="(event) => onUnifiedResizeStart(terminal.id, 'se', event)"></span>
            <span class="resize-handle resize-sw" @mousedown.stop.prevent="(event) => onUnifiedResizeStart(terminal.id, 'sw', event)"></span>
          </div>
          </template>
          <div id="selection-rect"></div>
        </div>
        </div>
      </div>
      <aside v-if="isCanvasPreviewOpen" class="preview-dock" aria-label="文件预览">
        <PreviewPanel
          :file-path="previewPath"
          :strategy="currentFileStrategy"
          :prefetched="prefetchedPreview"
          @close="closePreview"
          @width-change="onPreviewWidthChange"
        />
      </aside>
      <TerminalModal
        :open="terminalModalOpen"
        @close="terminalModalOpen = false"
        @update:open="terminalModalOpen = $event"
        @create="onToolbarNewTerminal"
      />
    </section>

    <!-- 文件管理视图 -->
    <section class="view files-view" v-show="activeView === 'files'">
      <div class="files-view-content">
        <FileManager />
      </div>
      <!-- 文件预览并排追加在右侧；打开时主窗口同步增加预览宽度。 -->
      <aside v-if="isFileManagerPreviewOpen" class="preview-dock" aria-label="文件预览">
        <PreviewPanel
          :file-path="previewPath"
          :strategy="currentFileStrategy"
          :prefetched="prefetchedPreview"
          @close="closePreview"
          @width-change="onPreviewWidthChange"
        />
      </aside>
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

  <!-- ⌘K 命令面板：搜索命令 / 主机 / 文件并快速跳转 -->
  <Teleport to="body">
    <div v-if="cmdkOpen" class="cmdk-overlay" @click="cmdkOpen = false" @keydown.esc="cmdkOpen = false">
      <div class="cmdk-panel" @click.stop>
        <div class="cmdk-input-row">
          <svg class="cmdk-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input
            ref="cmdkInputRef"
            v-model="cmdkQuery"
            class="cmdk-input"
            :placeholder="cmdkPlaceholder"
            @keydown.enter="onCmdkEnter"
            @keydown.down.prevent="cmdkIndex = Math.min(cmdkIndex + 1, cmdkResults.length - 1)"
            @keydown.up.prevent="cmdkIndex = Math.max(cmdkIndex - 1, 0)"
            @keydown.esc="cmdkOpen = false"
          />
          <span class="cmdk-esc">Esc</span>
        </div>
        <div class="cmdk-results" v-if="cmdkResults.length > 0">
          <div
            v-for="(item, idx) in cmdkResults"
            :key="item.id"
            :class="['cmdk-result', { active: cmdkIndex === idx }]"
            @click="cmdkIndex = idx; onCmdkEnter()"
            @mouseenter="cmdkIndex = idx"
          >
            <span class="cmdk-result-icon" :style="{ color: item.color }">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" v-html="item.icon"></svg>
            </span>
            <div class="cmdk-result-body">
              <span class="cmdk-result-title">{{ item.title }}</span>
              <span class="cmdk-result-desc" v-if="item.desc">{{ item.desc }}</span>
            </div>
            <span class="cmdk-result-type">{{ item.type }}</span>
          </div>
        </div>
        <div class="cmdk-empty" v-else>{{ cmdkQuery ? '未找到匹配结果' : '开始输入以搜索…' }}</div>
        <div class="cmdk-footer">
          <span>↑↓ 导航 · ↹ 跳转 · Esc 关闭</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>
<script src="./AppLayout.ts"></script>
<style src="./AppLayout.css"></style>
