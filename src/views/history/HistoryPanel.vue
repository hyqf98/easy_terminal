<template>
  <div class="page history-page">
    <div class="page-header">
      <div>
        <div class="page-title">
          <div class="page-title-icon">
            <Icon :size="18"><History /></Icon>
          </div>
          {{ titleLabel }}
        </div>
        <div class="page-subtitle">{{ subtitleLabel }}</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost" @click="exportHistory">
          <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
          {{ exportLabel }}
        </button>
        <button class="btn btn-danger" @click="clearHistory">
          <svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          {{ clearLabel }}
        </button>
      </div>
    </div>

    <div class="history-layout">
      <aside class="history-rail">
        <div class="history-rail-section">
          <div class="history-rail-title">{{ t('history.sectionTerminal') }}</div>
          <div
            v-for="option in railGroupOptions"
            :key="option.key"
            class="history-rail-item"
            :class="{ active: activeGroup === option.key }"
            @click="selectGroup(option.key)"
          >
            <span>{{ option.label }}</span>
            <span class="history-rail-count">{{ option.count }}</span>
          </div>
        </div>
      </aside>

      <div class="history-main">
        <div v-if="visibleItems.length === 0" class="history-empty">{{ emptyLabel }}</div>
        <div
          v-for="item in visibleItems"
          :key="item.id"
          class="history-row"
          :title="item.command"
          @click="sendCommand(item.command)"
        >
          <span class="history-cmd" v-html="renderCommand(item.command)"></span>
          <span class="history-freq"><span class="history-freq-dot"></span>{{ countLabel(item.count) }}</span>
          <span class="history-term-tag">{{ terminalTag(item) }}</span>
          <button
            class="icon-btn history-copy-btn"
            :title="t('history.copy')"
            @click.stop="copyCommand(item.command)"
          >
            <svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
<script src="./HistoryPanel.ts"></script>
<style src="./HistoryPanel.css" scoped></style>
