<template>
  <div class="page shortcut-view">
    <div class="page-header">
      <div>
        <div class="page-title">
          <div class="page-title-icon">
            <svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h0M11 10h0M15 10h0M7 14h10"/></svg>
          </div>
          {{ titleLabel }}
        </div>
        <div class="page-subtitle">{{ subtitleLabel }}</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost" @click="resetDefaults">{{ resetLabel }}</button>
      </div>
    </div>

    <div class="shortcut-platforms-bar">
      <span
        v-for="field in shortcutFields"
        :key="field"
        :class="['shortcut-platform-pill', { current: isCurrentPlatform(field) }]"
      >
        {{ fieldLabels[field] }}
        <em v-if="isCurrentPlatform(field)">当前</em>
      </span>
    </div>

    <section v-for="[category, bindings] in grouped" :key="category" class="shortcut-section">
      <div class="section-label">{{ categoryLabel(category) }}</div>
      <div class="shortcut-cards">
        <div v-for="binding in bindings" :key="binding.id" class="shortcut-row">
          <div class="shortcut-action">
            <div class="shortcut-action-icon" v-html="actionIcon(binding)"></div>
            <div class="shortcut-action-text">
              <div class="shortcut-action-name">{{ binding.label }}</div>
              <div class="shortcut-action-desc">{{ binding.description }}</div>
            </div>
          </div>
          <div class="shortcut-platforms">
            <div
              v-for="field in shortcutFields"
              :key="field"
              class="shortcut-platform-col"
              :class="{ current: isCurrentPlatform(field) }"
            >
              <div class="shortcut-platform-head">
                <span class="shortcut-platform-name">{{ fieldLabels[field] }}</span>
                <button
                  class="shortcut-record-btn"
                  :class="{ active: modalOpen && recording?.bindingId === binding.id && recording?.field === field }"
                  @click="openRecord(binding, field)"
                >
                  <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="9"/></svg>
                  {{ modalOpen && recording?.bindingId === binding.id && recording?.field === field ? '录制中' : '录制' }}
                </button>
              </div>
              <div
                v-if="modalOpen && recording?.bindingId === binding.id && recording?.field === field"
                class="shortcut-capture-inline keycapture recording"
              >
                <span class="keycapture-hint">等待按键…</span>
              </div>
              <div v-else-if="getFieldValue(binding, field)" class="shortcut-keycap-wrap">
                <div class="keycap-group">
                  <template v-for="(token, index) in getComboTokens(binding, field)" :key="index">
                    <span v-if="index > 0" class="keycap-plus">+</span>
                    <span class="keycap">{{ token }}</span>
                  </template>
                </div>
                <span v-if="isConflict(binding)" class="shortcut-conflict">
                  <svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.86l-8.6 14.94A2 2 0 0 0 3.42 21h17.16a2 2 0 0 0 1.72-3.2L13.7 3.86a2 2 0 0 0-3.42 0z"/></svg>
                  冲突
                </span>
                <button class="shortcut-clear-btn" title="清空" @click="clearField(binding, field)">
                  <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>
                </button>
              </div>
              <div v-else class="shortcut-empty">未绑定</div>
            </div>
          </div>
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
