<template>
  <div id="app-titlebar">
    <div class="app-titlebar-drag">
      <span class="app-title">
        <span class="app-mark" aria-hidden="true">E</span>
        <span class="app-title-text">Easy Terminal</span>
      </span>
    </div>
    <!-- 搜索按钮：绝对定位居中于标题栏 -->
    <button class="cmdk" type="button" @click="onCmdk">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      <span class="cmdk-text">搜索命令 / 主机 / 文件</span>
      <span class="cmdk-kbd">⌘K</span>
    </button>
    <div class="app-titlebar-actions">
      <button class="theme-toggle" type="button" :title="themeLabel" @click="toggleTheme">
        <span class="theme-track" :class="{ dark: isDark }"><span class="theme-thumb"></span></span>
        <span class="theme-label">{{ themeLabel }}</span>
      </button>
    </div>
    <div class="app-window-controls">
      <button class="app-btn-minimize" :title="minimizeLabel" @click="$emit('minimize')"></button>
      <button class="app-btn-maximize" :title="maximizeLabel" @click="$emit('maximize')"></button>
      <button class="app-btn-close" :title="closeLabel" @click="$emit('close')"></button>
    </div>
  </div>
</template>
<script src="./Titlebar.ts"></script>
<style src="./Titlebar.css"></style>
