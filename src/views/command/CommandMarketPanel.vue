<template>
  <div class="page market-page">
    <div class="market-scroll">
      <div class="market-hero">
        <h2>{{ titleLabel }}</h2>
        <p>{{ heroDesc }}</p>
        <div class="market-hero-stats">
          <div v-for="stat in heroStats" :key="stat.label" class="market-stat">
            <span class="market-stat-value">{{ stat.value }}</span>
            <span class="market-stat-label">{{ stat.label }}</span>
          </div>
        </div>
      </div>

      <!-- 仓库地址配置 -->
      <div class="market-repo-config">
        <div class="market-repo-input-wrap">
          <svg class="market-repo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
          <input
            type="text"
            class="market-repo-input"
            v-model="repoUrlInput"
            placeholder="https://github.com/owner/repo 或 owner/repo"
            @keydown.enter="saveRepoUrl"
          />
        </div>
        <button class="btn btn-soft" @click="saveRepoUrl">保存</button>
        <button
          class="icon-btn market-refresh-btn"
          :title="refreshLabel"
          :disabled="loading"
          @click="refresh"
        >
          <svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        </button>
      </div>

      <div class="market-filter">
        <span
          v-for="chip in filterChips"
          :key="chip"
          class="filter-chip"
          :class="{ active: activeFilter === chip }"
          @click="activeFilter = chip"
        >{{ chip }}</span>
      </div>

      <div v-if="loading" class="market-loading">{{ loadingLabel }}</div>
      <div v-else-if="errorMsg" class="market-error">{{ errorMsg }}</div>
      <template v-else>
        <div v-if="filteredLibs.length === 0" class="market-empty">{{ noResultsLabel }}</div>
        <div v-else class="market-grid">
          <div
            v-for="(lib, index) in filteredLibs"
            :key="lib.name"
            class="card market-card"
            :style="{ animationDelay: `${Math.min(index, 6) * 60}ms` }"
          >
            <div class="market-card-head">
              <div class="market-card-icon-wrap" v-html="categoryIcon(lib.name)"></div>
              <div>
                <div class="market-card-title">{{ lib.label }}</div>
                <div class="market-card-author">{{ libraryMeta(lib) }}</div>
              </div>
            </div>
            <div class="market-card-desc">
              {{ lib.description || (lib.directory === 'system' ? '系统内置命令库，随应用自动管理。' : '社区贡献的命令库，安装后可在终端调用。') }}
            </div>
            <div class="market-card-foot">
              <div class="market-card-meta">
                <span>📦 {{ lib.commandCount }}</span>
                <span>⬇ —</span>
                <span>★ —</span>
              </div>
              <button
                v-if="lib.directory !== 'system' && !lib.isInstalled"
                class="btn btn-primary market-install-btn"
                @click="openInstallPreview(lib)"
              >{{ installLabel }}</button>
              <button
                v-else
                class="btn btn-soft market-install-btn"
                :title="lib.isInstalled ? uninstallLabel : ''"
                @click="lib.isInstalled && uninstallLib(lib)"
              >{{ installedLabel }}</button>
            </div>
          </div>
        </div>
      </template>
    </div>

    <InstallPreviewModal
      :open="installModalOpen"
      :library="pendingLibrary"
      @close="installModalOpen = false"
      @update:open="installModalOpen = $event"
      @install="onInstall"
    />
  </div>
</template>
<script src="./CommandMarketPanel.ts"></script>
<style src="./CommandMarketPanel.css" scoped></style>
