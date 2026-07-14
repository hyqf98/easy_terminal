<template>
  <div
    class="terminal-window"
    ref="rootRef"
    :class="containerClasses"
    :style="containerStyle"
    @mouseenter="onActivate"
    @mousedown="onActivate"
  >
    <div class="title-bar" @mousedown.prevent="startDrag">
      <div class="terminal-dots">
        <button class="terminal-dot dot-close" title="关闭" @click.stop="requestClose"></button>
        <button class="terminal-dot dot-minimize" title="最小化" @click.stop="minimize"></button>
        <button class="terminal-dot dot-maximize" title="最大化" @click.stop="toggleMaximize"></button>
      </div>
      <div class="terminal-title">
        <svg v-if="isSsh" class="terminal-title-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
        <svg v-else class="terminal-title-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
        <span class="terminal-title-name" @dblclick="startRename">{{ terminalName }}</span>
        <span v-if="currentCwd" class="terminal-title-cwd" :title="currentCwd">{{ currentCwd }}</span>
      </div>
      <div class="terminal-status">
        <!-- SSH 切换按钮：在本地/SSH 终端间快速切换 -->
        <div class="terminal-ssh-switch" v-if="sshProfiles.length > 0">
          <button
            class="ssh-switch-btn"
            :class="{ active: isSsh }"
            :title="isSsh ? '切换 SSH / 本地' : '连接 SSH 服务器'"
            @click.stop="sshMenuOpen = !sshMenuOpen"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
          </button>
          <div class="ssh-switch-menu" v-if="sshMenuOpen" @click.stop>
            <div v-if="!isSsh" class="ssh-switch-header">连接 SSH 服务器</div>
            <button
              v-for="p in sshProfiles"
              :key="p.id"
              class="ssh-switch-item"
              @click="emitSwitchSsh(p.id)"
            >{{ p.name }} ({{ p.user }}@{{ p.host }})</button>
            <button v-if="isSsh" class="ssh-switch-item" @click="emitSwitchSsh(null)">切换为本地终端</button>
          </div>
        </div>
        <span :class="['status-pulse', statusPulseColor]"></span>
        <span>{{ statusText }}</span>
      </div>
    </div>
    <div class="terminal-body" ref="bodyRef"></div>
    <!-- 箭头把手：absolute 定位在终端左边缘垂直居中，点击切换独立文件面板 -->
    <button
      class="terminal-file-tab"
      :class="{ expanded: filePanelExpanded }"
      :title="filePanelExpanded ? '收起文件列表' : '展开文件列表'"
      @click.stop="toggleFilePanel"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline v-if="!filePanelExpanded" points="9 6 15 12 9 18" />
        <polyline v-else points="15 6 9 12 15 18" />
      </svg>
    </button>
    <!-- 补全弹窗 Teleport 到 body 并使用 position:fixed，避免被 .terminal-window 的 overflow:hidden 裁剪 -->
    <Teleport to="body">
      <div ref="completionPopupRef" class="completion-popup" v-if="suggestVisible && suggestItems.length > 0"
        :class="`selection-mode-${suggestSelectionMode}`"
        :data-placement="suggestPlacement"
        :style="suggestStyle">
        <div class="completion-header">
          <span>{{ suggestHeaderText }}</span>
          <span class="completion-count">{{ suggestItems.length }} 条匹配</span>
        </div>
        <div class="completion-list">
          <div
            v-for="(item, idx) in suggestItems"
            :key="item.id"
            :class="['completion-item', { selected: suggestIndex === idx }]"
            @click="selectSuggestion(item)"
            @mousemove="(event) => selectSuggestionByMouse(idx, event)"
          >
            <span class="completion-icon" v-html="'<svg viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'1.6\' stroke-linecap=\'round\' stroke-linejoin=\'round\'>' + suggestIconSvg(item) + '</svg>'"></span>
            <div class="completion-body">
              <div class="completion-cmd" v-html="item.title"></div>
              <div class="completion-desc" v-if="item.subtitle || item.description">{{ item.subtitle || item.description }}</div>
            </div>
            <span class="completion-kbd">{{ suggestKbdHint(idx, item) }}</span>
          </div>
        </div>
        <div class="completion-footer">
          <span>↑↓ / Tab 选择 · Enter 接受 · Esc 关闭</span>
          <span class="completion-source">{{ activeSuggestion ? activeSuggestion.sourceLabel : '' }}</span>
        </div>
      </div>
    </Teleport>
    <Teleport to="body">
      <span v-if="ghostText" class="terminal-ghost-text" :style="ghostStyle" aria-hidden="true">{{ ghostText }}</span>
    </Teleport>
    <div class="resize-handle resize-n" @mousedown.prevent.stop="startResize('n', $event)"></div>
    <div class="resize-handle resize-s" @mousedown.prevent.stop="startResize('s', $event)"></div>
    <div class="resize-handle resize-e" @mousedown.prevent.stop="startResize('e', $event)"></div>
    <div class="resize-handle resize-w" @mousedown.prevent.stop="startResize('w', $event)"></div>
    <div class="resize-handle resize-ne" @mousedown.prevent.stop="startResize('ne', $event)"></div>
    <div class="resize-handle resize-nw" @mousedown.prevent.stop="startResize('nw', $event)"></div>
    <div class="resize-handle resize-se" @mousedown.prevent.stop="startResize('se', $event)"></div>
    <div class="resize-handle resize-sw" @mousedown.prevent.stop="startResize('sw', $event)"></div>
  </div>
</template>
<script src="./TerminalWindow.ts"></script>
<style src="./TerminalWindow.css"></style>
