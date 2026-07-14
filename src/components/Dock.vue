<template>
  <div
    ref="dockShellRef"
    class="dock-shell"
    :class="{ expanded: dockExpanded }"
    @mouseenter="expandDock"
    @mouseleave="scheduleCollapse"
    @focusin="expandDock"
    @focusout="scheduleCollapse"
  >
    <button
      class="dock-toggle"
      type="button"
      :aria-label="dockExpanded ? '收起底部导航' : '展开底部导航'"
      :aria-expanded="dockExpanded"
      aria-controls="app-bottom-dock"
      @click="toggleDock"
    >
      <Icon :size="14"><component :is="dockExpanded ? ChevronDown : ChevronUp" /></Icon>
    </button>
    <nav
      id="app-bottom-dock"
      class="dock"
      :aria-hidden="!dockExpanded"
      :inert="!dockExpanded"
    >
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
  </div>
</template>
<script src="./Dock.ts"></script>
<style src="./Dock.css" scoped></style>
