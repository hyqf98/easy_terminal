<template>
  <div class="minimap" v-show="visible">
    <div class="minimap-label">Overview</div>
    <div class="minimap-grid"></div>
    <div
      v-for="(item, index) in items"
      :key="index"
      class="minimap-term"
      :class="{ focused: item.focused }"
      :style="item.style"
    ></div>
    <div class="minimap-viewport" :style="viewportStyle"></div>
  </div>
</template>
<script src="./CanvasMinimap.ts"></script>
<style src="./CanvasMinimap.css" scoped></style>
