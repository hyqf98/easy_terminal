<template>
  <div class="page shortcut-view">
    <div class="page-header">
      <div>
        <div class="page-title">
          <div class="page-title-icon">
            <Icon :size="18"><Keyboard /></Icon>
          </div>
          {{ titleLabel }}
        </div>
        <div class="page-subtitle">{{ subtitleLabel }}</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost" @click="resetDefaults">{{ resetLabel }}</button>
      </div>
    </div>

    <div class="shortcut-platforms">
      <span
        v-for="field in shortcutFields"
        :key="field"
        class="platform-tab"
        :class="{ active: selectedPlatform === field }"
        @click="selectedPlatform = field"
      >
        <span class="platform-tab-icon" v-html="platformIconSvg(field)"></span>
        {{ fieldLabels[field] }}
      </span>
    </div>

    <section v-for="[category, bindings] in grouped" :key="category" class="shortcut-section">
      <div class="shortcut-section-title">{{ categoryLabel(category) }}</div>
      <div
        v-for="binding in bindings"
        :key="binding.id"
        class="shortcut-row"
        :class="{ conflict: isConflict(binding) }"
      >
        <div class="shortcut-action">
          <div class="shortcut-action-icon" v-html="actionIcon(binding)"></div>
          <div class="shortcut-action-text">
            <div class="shortcut-action-name">{{ binding.label }}</div>
            <div class="shortcut-action-desc">{{ binding.description }}</div>
          </div>
        </div>
        <div class="shortcut-keys" title="点击重新录制" @click="openRecord(binding, selectedPlatform)">
          <div v-if="getFieldValue(binding, selectedPlatform)" class="keycap-group">
            <template v-for="(token, index) in getComboTokens(binding, selectedPlatform)" :key="index">
              <span v-if="index > 0" class="keycap-plus">+</span>
              <span class="keycap">{{ token }}</span>
            </template>
          </div>
          <span v-else class="shortcut-empty">未绑定 · 点击录制</span>
        </div>
        <div class="shortcut-status-cell">
          <span v-if="isConflict(binding)" class="shortcut-conflict">
            <svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.86l-8.6 14.94A2 2 0 0 0 3.42 21h17.16a2 2 0 0 0 1.72-3.2L13.7 3.86a2 2 0 0 0-3.42 0z"/></svg>
            冲突
          </span>
          <template v-else-if="getFieldValue(binding, selectedPlatform)">
            <span class="shortcut-status">已绑定</span>
            <button class="shortcut-clear-btn" type="button" title="清空" @click="clearField(binding, selectedPlatform)">
              <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </template>
        </div>
      </div>
    </section>

    <ShortcutRecordModal
      :open="modalOpen"
      :action-name="modalAction"
      :platform="modalPlatform"
      @close="onRecordClose"
      @update:open="modalOpen = $event"
      @confirm="onRecordConfirm"
    />
  </div>
</template>
<script src="./ShortcutPanel.ts"></script>
<style src="./ShortcutPanel.css" scoped></style>
