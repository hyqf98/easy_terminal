<template>
  <div class="canvas-status" v-show="visible">
    <span class="dot"></span>
    <span>缩放</span>
    <span class="value">{{ zoomLabel }}</span>
    <span class="sep">·</span>
    <span>平移</span>
    <span class="value">({{ panX }}, {{ panY }})</span>
    <span class="sep">·</span>
    <span class="value">{{ terminalCount }}</span>
    <span>个终端</span>
  </div>
</template>
<script src="./CanvasStatus.ts"></script>
<style src="./CanvasStatus.css" scoped></style>
