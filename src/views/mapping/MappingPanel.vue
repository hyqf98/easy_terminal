<template>
  <div class="page mapping-page">
    <div class="page-header">
      <div>
        <div class="page-title">
          <div class="page-title-icon">
            <Icon :size="18"><ArrowsLeftRight /></Icon>
          </div>
          {{ titleLabel }}
        </div>
        <div class="page-subtitle">{{ subtitleLabel }}</div>
      </div>
      <div class="page-actions">
        <div class="search-input">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input v-model="keyword" :placeholder="searchPlaceholder" />
        </div>
        <button class="btn btn-primary" @click="openAdd">
          <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
          {{ newLabel }}
        </button>
      </div>
    </div>

    <div class="mapping-intro">
      <div class="mapping-intro-icon">
        <svg viewBox="0 0 24 24"><path d="M7 8l-4 4 4 4"/><path d="M17 8l4 4-4 4"/><path d="M14 4l-4 16"/></svg>
      </div>
      <div>
        <h3>{{ introTitle }}</h3>
        <p>{{ introDesc }}</p>
      </div>
    </div>

    <div v-if="filteredMappings.length === 0" class="mapping-empty">{{ emptyLabel }}</div>
    <div v-else class="mapping-pairs">
      <div v-for="mapping in filteredMappings" :key="mapping.id" class="mapping-pair">
        <div class="mapping-side">
          <span class="mapping-side-label">{{ t('mapping.trigger') }}</span>
          <div class="mapping-side-triggers">
            <span v-for="trigger in mapping.triggers" :key="trigger" class="mapping-trigger-chip" :data-tooltip="trigger">{{ trigger }}</span>
            <span v-if="!mapping.triggers || !mapping.triggers.length" class="mapping-side-empty">—</span>
          </div>
        </div>
        <div class="mapping-arrow">
          <svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </div>
        <div class="mapping-side">
          <span class="mapping-side-label">{{ t('mapping.realCommand') }}</span>
          <span class="mapping-side-value code" v-html="renderCommand(mapping.command)"></span>
        </div>
        <div class="mapping-tail">
          <div
            class="mapping-toggle"
            :class="{ on: mapping.enabled }"
            :data-tooltip="t('mapping.toggle')"
            @click="toggleMapping(mapping)"
          ></div>
          <div class="mapping-pair-actions">
            <button class="icon-btn mapping-copy-btn" :data-tooltip="t('mapping.copy')" @click="copyCommand(mapping.command)">
              <svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <button class="icon-btn" :data-tooltip="t('mapping.edit')" @click="editMapping(mapping)">
              <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button
              v-if="mapping.sourceType !== 'builtin'"
              class="icon-btn mapping-delete-btn"
              :data-tooltip="t('history.delete')"
              @click="deleteMapping(mapping)"
            >
              <svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
        <div v-if="mapping.description" class="mapping-pair-desc">{{ mapping.description }}</div>
      </div>
    </div>

    <MappingModal
      :open="modalOpen"
      :mapping="editingMapping"
      @close="closeModal"
      @update:open="modalOpen = $event"
      @save="onSave"
    />
  </div>
</template>
<script src="./MappingPanel.ts"></script>
<style src="./MappingPanel.css" scoped></style>
