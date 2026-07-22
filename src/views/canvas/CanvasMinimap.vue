<template>
  <div class="minimap" v-show="visible" @mousedown="onMinimapMouseDown">
    <div class="minimap-label">Overview</div>
    <div class="minimap-grid"></div>
    <div
      v-for="(item, index) in items"
      :key="index"
      class="minimap-term"
      :class="{ focused: item.focused, hovered: hoveredIndex === index }"
      :style="item.style"
      :data-tooltip="`跳转至终端 (${Math.round(item.rect.x)}, ${Math.round(item.rect.y)})`"
      @mouseenter="onTermEnter(index)"
      @mouseleave="onTermLeave"
      @click.stop="onTermClick(item)"
    ></div>
    <div
      class="minimap-viewport"
      :style="viewportStyle"
      @mousedown.stop.prevent="onViewportMouseDown"
      data-tooltip="拖动以移动画布视口"
    ></div>
  </div>
</template>
<script src="./CanvasMinimap.ts"></script>
<style src="./CanvasMinimap.css" scoped></style>
