<template>
  <div class="page history-page">
    <div class="page-header">
      <div>
        <div class="page-title">
          <div class="page-title-icon">
            <svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>
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

    <div class="history-filter-bar">
      <div class="search-input">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
        <input v-model="keyword" :placeholder="searchPlaceholder" />
      </div>
      <div class="segmented">
        <button
          v-for="option in timeOptions"
          :key="option.value"
          type="button"
          class="segmented-item"
          :class="{ active: timeRange === option.value }"
          @click="timeRange = option.value"
        >{{ option.label }}</button>
      </div>
      <select class="select history-sort" v-model="sortBy">
        <option value="time">{{ sortTimeLabel }}</option>
        <option value="freq">{{ sortFreqLabel }}</option>
      </select>
    </div>

    <div class="history-main">
      <div v-if="dayGroups.length === 0" class="history-empty">{{ emptyLabel }}</div>
      <div v-for="group in dayGroups" :key="group.key" class="history-day">
        <div class="history-day-header">
          <span class="history-day-date">{{ group.label }}</span>
          <span class="history-day-line"></span>
          <span class="history-day-count">{{ t('history.countShort', String(group.count)) }}</span>
        </div>
        <div
          v-for="item in group.items"
          :key="item.id"
          class="history-row"
          :title="item.command"
          @click="sendCommand(item.command)"
        >
          <span class="history-time">{{ formatClock(item.timestamp) }}</span>
          <span class="history-cmd" v-html="renderCommand(item.command)"></span>
          <span class="history-freq"><span class="history-freq-dot"></span>{{ countLabel(item.count) }}</span>
          <span class="history-term-tag">{{ terminalTag(item) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
<script src="./HistoryPanel.ts"></script>
<style src="./HistoryPanel.css" scoped></style>
