<template>
  <nav class="dock">
    <button
      v-for="item in items"
      :key="item.id"
      class="dock-item"
      :class="{ active: activeView === item.id, divider: false }"
      @click="$emit('view-change', item.id)"
      :aria-label="item.label"
    >
      <Icon :size="20"><component :is="iconMap[item.id]" /></Icon>
      <span class="dock-label">{{ item.label }}</span>
    </button>
    <div class="dock-divider"></div>
    <button
      v-for="item in tailItems"
      :key="item.id"
      class="dock-item"
      :class="{ active: activeView === item.id }"
      @click="$emit('view-change', item.id)"
      :aria-label="item.label"
    >
      <Icon :size="20"><component :is="iconMap[item.id]" /></Icon>
      <span class="dock-label">{{ item.label }}</span>
    </button>
  </nav>
</template>
<script src="./Dock.ts"></script>
<style src="./Dock.css" scoped></style>
