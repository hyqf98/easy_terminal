<template>
  <div
    class="terminal-window"
    ref="rootRef"
    :class="containerClasses"
    :style="containerStyle"
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
        <span :class="['status-pulse', statusPulseColor]"></span>
        <span>{{ statusText }}</span>
      </div>
    </div>
    <div class="terminal-body" ref="bodyRef"></div>
    <div class="terminal-suggest" v-if="suggestVisible && suggestItems.length > 0"
      :style="suggestStyle">
      <div class="suggest-header">
        <span class="suggest-header-label">{{ suggestItems.length }} results</span>
      </div>
      <div class="suggest-body">
        <div class="suggest-list">
          <div
            v-for="(item, idx) in suggestItems"
            :key="item.id"
            :class="['suggest-item', { active: suggestIndex === idx }]"
            @click="selectSuggestion(item)"
            @mouseenter="suggestIndex = idx"
          >
            <span :class="['suggest-type-badge', `type-${item.type}`]">{{ item.type === 'history' ? 'H' : item.type === 'mapping' ? 'M' : item.type === 'completion' ? 'S' : 'C' }}</span>
            <div class="suggest-info">
              <span class="suggest-title">{{ item.title }}</span>
              <span class="suggest-subtitle" v-if="item.subtitle">{{ item.subtitle }}</span>
            </div>
          </div>
        </div>
        <div class="suggest-detail" v-if="activeSuggestion">
          <div class="suggest-detail-title">{{ activeSuggestion.title }}</div>
          <div class="suggest-detail-desc" v-if="activeSuggestion.description">{{ activeSuggestion.description }}</div>
          <div class="suggest-detail-section" v-if="activeSuggestion.usage">
            <span class="suggest-detail-label">Usage</span>
            <code class="suggest-detail-code">{{ activeSuggestion.usage }}</code>
          </div>
          <div class="suggest-detail-section" v-if="activeSuggestion.examples && activeSuggestion.examples.length > 0">
            <span class="suggest-detail-label">Examples</span>
            <code class="suggest-detail-code" v-for="(ex, i) in activeSuggestion.examples.slice(0, 3)" :key="i">{{ ex }}</code>
          </div>
          <div class="suggest-detail-section" v-if="activeSuggestion.tags && activeSuggestion.tags.length > 0">
            <div class="suggest-detail-tags">
              <span class="suggest-detail-tag" v-for="tag in activeSuggestion.tags.slice(0, 5)" :key="tag">{{ tag }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
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
