<template>
  <div class="page command-page">
    <div class="page-header">
      <div>
        <div class="page-title">
          <div class="page-title-icon">
            <Icon :size="18"><Book /></Icon>
          </div>
          {{ titleLabel }}
        </div>
        <div class="page-subtitle">{{ subtitleLabel }}</div>
      </div>
    </div>

    <div class="library-layout">
      <aside class="lib-rail">
        <div class="lib-rail-title">分类</div>
        <div
          class="lib-rail-item"
          :class="{ active: activeLibraryId === ALL_CATEGORY }"
          @click="selectLibrary(ALL_CATEGORY)"
        >
          <div class="lib-rail-icon"><svg viewBox="0 0 24 24"><path d="M4 4h6v16H4z"/><path d="M10 4h4v16h-4z"/><path d="M14 4l6 1-3 15-6-1z"/></svg></div>
          <span class="lib-rail-name">全部</span>
          <span class="lib-rail-count">{{ totalCount }}</span>
        </div>
        <div
          v-for="lib in libraries"
          :key="lib.id"
          class="lib-rail-item"
          :class="{ active: activeLibraryId === lib.id }"
          @click="selectLibrary(lib.id)"
        >
          <div class="lib-rail-icon" :style="{ color: railIconColor(lib) }" v-html="railIconSvg(lib)"></div>
          <span class="lib-rail-name">{{ lib.label || formatTitle(lib.id) }}</span>
          <span class="lib-rail-count">{{ lib.commandCount }}</span>
        </div>
      </aside>

      <div class="lib-main">
        <div class="lib-toolbar">
          <div class="search-input" style="flex:1;max-width:420px">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
            <input type="text" v-model="keyword" :placeholder="searchPlaceholder" @input="debouncedSearch" />
          </div>
          <button class="btn btn-soft" @click="importFile">
            <Icon :size="13"><Download /></Icon>
            {{ importLabel }}
          </button>
          <button class="btn btn-soft" :disabled="!activeLibrary" @click="exportLibrary">
            <Icon :size="13"><Download /></Icon>
            {{ exportLabel }}
          </button>
          <button class="btn btn-primary" @click="openAddCommand">
            <Icon :size="13"><Plus /></Icon>
            {{ addCmdLabel }}
          </button>
          <span class="lib-source-tag" v-if="activeLibrary">{{ describeSource(activeLibrary) }}</span>
        </div>
        <div class="lib-list">
          <div
            v-for="(cmd, index) in activePage.items"
            :key="cmd.id"
            class="lib-row"
            :style="{ animationDelay: `${Math.min(index, 6) * 60}ms` }"
          >
            <div class="lib-row-icon" v-html="commandRowIcon()"></div>
            <div class="lib-row-main">
              <div class="lib-row-name">
                {{ cmd.name }}
                <span v-if="cmd.name_cn" class="tag tag-muted">{{ cmd.name_cn }}</span>
                <span v-for="tag in cmd.tags" :key="tag" class="tag tag-accent">{{ tag }}</span>
                <span v-if="!cmd.enabled" class="tag tag-muted">{{ disabledLabel }}</span>
              </div>
              <div class="lib-row-cmd" v-html="tokenize(cmd.command || cmd.name)"></div>
              <div v-if="cmd.description" class="lib-row-desc">{{ cmd.description }}</div>
            </div>
            <div class="lib-row-tags">
              <span v-if="cmd.exampleCount > 0" class="tag tag-green">{{ cmd.exampleCount }} 例</span>
            </div>
            <div class="lib-row-actions">
              <button class="icon-btn" :title="editLabel" @click="openCommandEditor(cmd)">
                <svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
              </button>
              <button class="icon-btn" :title="deleteLabel" @click="deleteCommand(cmd)">
                <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          </div>
          <div v-if="activePage.items.length === 0" class="lib-empty">{{ emptyLabel }}</div>
        </div>
      </div>
    </div>

    <!-- 分类管理弹框（沿用 native dialog，保留 CRUD） -->
    <div v-if="libraryDialogVisible" class="native-dialog-overlay" @click.self="libraryDialogVisible = false">
      <div class="native-dialog" style="width: min(400px, calc(100vw - 48px))">
        <div class="native-dialog-title">{{ libraryEditMode === 'create' ? addCategoryLabel : editLabel }}</div>
        <div class="native-dialog-body">
          <div class="native-field">
            <label class="native-field-label">{{ categoryNameLabel }}</label>
            <input class="native-input" v-model="libraryForm.label" placeholder="Team Tools" />
          </div>
          <div class="native-field">
            <label class="native-field-label">{{ categoryIdLabel }}</label>
            <input class="native-input" v-model="libraryForm.id" :disabled="libraryEditMode === 'edit'" placeholder="team-tools" />
          </div>
          <div class="native-field">
            <label class="native-field-label">{{ platformsLabel }}</label>
            <input class="native-input" v-model="libraryForm.platformsText" placeholder="darwin, linux" />
          </div>
          <div class="native-field">
            <label class="native-field-label">{{ languageFieldLabel }}</label>
            <input class="native-input" v-model="libraryForm.language" placeholder="python" />
          </div>
          <label class="native-checkbox"><input type="checkbox" v-model="libraryForm.enabled" /> {{ enabledLabel }}</label>
        </div>
        <div class="native-dialog-footer">
          <button class="native-btn" @click="libraryDialogVisible = false">{{ cancelLabel }}</button>
          <button class="native-btn primary" @click="saveLibrary">{{ saveLabel }}</button>
        </div>
      </div>
    </div>

    <!-- 新建/编辑命令弹框 -->
    <CommandModal
      :open="commandModalOpen"
      :command="editingCommand"
      :categories="categoryOptions"
      @close="commandModalOpen = false"
      @update:open="commandModalOpen = $event"
      @save="onCommandSave"
    />
  </div>
</template>
<script src="./CommandConfigPanel.ts"></script>
<style src="./CommandConfigPanel.css" scoped></style>
