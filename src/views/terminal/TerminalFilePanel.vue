<template>
  <div class="terminal-file-panel">
    <FileTree
      ref="fileTreeRef"
      @open-terminal="onOpenTerminal"
      @open-current-terminal="onOpenCurrentTerminal"
      @open-preview="onOpenPreview"
      @locate-cwd="onLocateCwd"
      @ready="onReady"
      @strategy-change="onStrategyChange"
    />
    <!-- 左下角缩放手柄：触发绑定终端自身的 startResize('sw')，面板随之同步缩放（一体） -->
    <div
      class="filepanel-resize-handle"
      data-tooltip="拖动缩放整体（文件列表+终端）"
      @mousedown.stop.prevent="onResizeStart"
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 13L13 3"/><path d="M7 13h6V7"/></svg>
    </div>
  </div>
</template>
<script src="./TerminalFilePanel.ts"></script>
<style src="./TerminalFilePanel.css" scoped></style>
