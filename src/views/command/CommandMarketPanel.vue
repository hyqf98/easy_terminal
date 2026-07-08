<template>
  <div class="page market-page">
    <div class="page-header">
      <div>
        <div class="page-title">
          <div class="page-title-icon">
            <svg viewBox="0 0 24 24"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
          </div>
          {{ titleLabel }}
        </div>
        <div class="page-subtitle">从社区精选命令库一键安装，让团队经验沉淀为可复用资产</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost" :disabled="loading" @click="refresh">
          <svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          {{ refreshLabel }}
        </button>
      </div>
    </div>

    <div class="market-scroll">
      <div class="market-hero">
        <h2>{{ titleLabel }}</h2>
        <p>从社区精选命令库一键安装，让团队经验沉淀为可复用资产。</p>
        <div class="market-hero-stats">
          <div v-for="stat in heroStats" :key="stat.label" class="market-stat">
            <span class="market-stat-value">{{ stat.value }}</span>
            <span class="market-stat-label">{{ stat.label }}</span>
          </div>
        </div>
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
                <span v-if="lib.commandCount > 0">{{ lib.commandCount }} 条</span>
                <span v-if="lib.isInstalled" class="market-card-installed">已安装</span>
              </div>
              <div class="market-card-actions">
                <template v-if="lib.directory === 'system'">
                  <span class="tag tag-muted">系统</span>
                </template>
                <template v-else-if="lib.isInstalled">
                  <button class="icon-btn" :title="syncLabel" @click="syncLib(lib)">
                    <svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                  </button>
                  <button class="icon-btn" :title="uninstallLabel" @click="uninstallLib(lib)">
                    <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
                  </button>
                  <button class="btn btn-soft market-install-btn">{{ installedLabel }}</button>
                </template>
                <template v-else>
                  <button class="btn btn-primary market-install-btn" @click="openInstallPreview(lib)">
                    <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    {{ installLabel }}
                  </button>
                </template>
              </div>
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
