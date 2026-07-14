<template>
  <div
    class="file-manager"
    tabindex="0"
    @focusin="focused = true"
    @focusout="focused = false"
    @dragover.prevent="dragState.externalDragging = true"
    @dragleave.prevent="dragState.externalDragging = false"
    @drop.prevent="onExternalDrop"
  >
    <!-- ═══ 工具栏 ═══ -->
    <header class="fm-toolbar">
      <div class="fm-nav-btns">
        <button class="fm-nav-btn" :disabled="!canGoBack" :title="t('filemanager.nav.back')" @click="goBack">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <button class="fm-nav-btn" :disabled="!canGoForward" :title="t('filemanager.nav.forward')" @click="goForward">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
        </button>
        <button class="fm-nav-btn" :disabled="!canGoUp" :title="t('filemanager.nav.up')" @click="goUp">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
        </button>
        <button class="fm-nav-btn" :title="t('filemanager.nav.refresh')" @click="refresh">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/><path d="M21 3v6h-6"/></svg>
        </button>
      </div>

      <!-- 地址栏（面包屑） -->
      <div class="fm-addrbar">
        <svg class="fm-addrbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
        <div class="fm-addrbar-path">
          <template v-for="(seg, i) in breadcrumbSegments" :key="seg.path">
            <span
              class="crumb"
              :class="{ current: i === breadcrumbSegments.length - 1 }"
              @click="navigateTo(seg.path)"
            >{{ seg.name }}</span>
            <span v-if="i < breadcrumbSegments.length - 1" class="crumb-sep">›</span>
          </template>
        </div>
      </div>

      <!-- 搜索框 -->
      <div class="fm-searchbox">
        <svg v-if="!searchLoading" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
        <svg v-else class="fm-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
        <input
          v-model="searchQuery"
          type="text"
          :placeholder="t('filemanager.search.placeholder')"
          @input="onSearchInput"
          @keydown.esc="clearSearch"
        />
      </div>

      <div class="fm-toolbar-tail">
        <button class="fm-nav-btn" :title="t('filemanager.index.settings')" @click="openIndexSettings">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
      </div>
    </header>

    <!-- ═══ 主体：侧栏 + 文件列表 ═══ -->
    <div class="fm-body">
      <!-- 左侧栏 -->
      <aside class="fm-sidebar">
        <!-- 快速访问 -->
        <div class="fm-nav-group">
          <div class="fm-nav-group-title">{{ t('filemanager.sidebar.quickAccess') }}</div>
          <div
            v-for="qa in quickAccess"
            :key="qa.path"
            class="fm-nav-quick"
            :class="{ active: currentPath === qa.path }"
            @click="navigateTo(qa.path)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <template v-if="qa.icon === 'home'"><path d="M3 12L12 4l9 8"/><path d="M5 10v10h4v-6h6v6h4V10"/></template>
              <template v-else-if="qa.icon === 'download'"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></template>
              <template v-else-if="qa.icon === 'document'"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6"/></template>
              <template v-else-if="qa.icon === 'desktop'"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></template>
              <template v-else-if="qa.icon === 'picture'"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></template>
            </svg>
            <span>{{ qa.label }}</span>
          </div>
        </div>

        <!-- 此电脑：磁盘列表 -->
        <div class="fm-nav-group">
          <div class="fm-nav-group-title">{{ t('filemanager.sidebar.thisPc') }}</div>
          <div
            v-for="disk in disks"
            :key="disk.mount_point"
            class="fm-disk-item"
            :class="{ active: currentDisk?.mount_point === disk.mount_point }"
            @click="navigateTo(disk.mount_point)"
          >
            <div class="fm-disk-row">
              <div class="fm-disk-ico" :class="disk.kind">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                  <template v-if="disk.kind === 'ssd'"><rect x="2.5" y="6" width="19" height="13" rx="1"/><line x1="2.5" y1="10" x2="21.5" y2="10"/><line x1="7" y1="14" x2="11" y2="14"/></template>
                  <template v-else-if="disk.kind === 'hdd'"><rect x="2.5" y="6" width="19" height="13" rx="1"/><line x1="2.5" y1="10" x2="21.5" y2="10"/><circle cx="17" cy="14.5" r="1.2" fill="currentColor" stroke="none"/></template>
                  <template v-else-if="disk.kind === 'external'"><path d="M12 2L4 7v10l8 5 8-5V7z"/><path d="M4 7l8 5 8-5"/><line x1="12" y1="22" x2="12" y2="12"/></template>
                  <template v-else-if="disk.kind === 'network'"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></template>
                  <template v-else><rect x="2.5" y="6" width="19" height="13" rx="1"/><line x1="2.5" y1="10" x2="21.5" y2="10"/><circle cx="17" cy="14.5" r="1.2" fill="currentColor" stroke="none"/></template>
                </svg>
              </div>
              <div class="fm-disk-info">
                <div class="fm-disk-name">{{ disk.name }}</div>
                <div class="fm-disk-meta">{{ disk.fs_type }} · {{ diskPercent(disk) }}% {{ t('filemanager.disk.used') }}</div>
              </div>
            </div>
            <div class="fm-disk-bar-wrap">
              <div class="fm-disk-bar">
                <div class="fm-disk-bar-fill" :class="diskBarClass(disk)" :style="{ width: diskPercent(disk) + '%' }"></div>
              </div>
              <div class="fm-disk-bar-text">
                <span class="used">{{ formatSize(disk.used) }}</span>
                <span>{{ formatSize(disk.total) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 总容量 -->
        <div class="fm-sidebar-foot">
          <div class="fm-foot-label">{{ t('filemanager.sidebar.allDisks') }}</div>
          <div class="fm-foot-total">{{ formatSize(totalUsed) }} <span class="sub">/ {{ formatSize(totalCapacity) }}</span></div>
          <div class="fm-foot-bar">
            <i :class="{ danger: totalPercent >= 75 }" :style="{ width: totalPercent + '%' }"></i>
          </div>
        </div>
      </aside>

      <!-- 文件列表面板 -->
      <section class="fm-files">
        <!-- 加载骨架 -->
        <div v-if="loading" class="fm-files-loading">
          <div v-for="n in 12" :key="n" class="fm-row-skeleton"></div>
        </div>

        <template v-else>
          <!-- 列头 -->
          <div class="fm-files-header">
            <div class="fm-col" :class="{ sorted: sortKey === 'name', [sortDir]: sortKey === 'name' }" @click="setSort('name')">
              {{ t('filemanager.col.name') }}<span class="fm-sort-arrow"></span>
            </div>
            <div class="fm-col" :class="{ sorted: sortKey === 'date', [sortDir]: sortKey === 'date' }" @click="setSort('date')">
              {{ t('filemanager.col.modified') }}<span class="fm-sort-arrow"></span>
            </div>
            <div class="fm-col" :class="{ sorted: sortKey === 'type', [sortDir]: sortKey === 'type' }" @click="setSort('type')">
              {{ t('filemanager.col.type') }}<span class="fm-sort-arrow"></span>
            </div>
            <div class="fm-col fm-col-size" :class="{ sorted: sortKey === 'size', [sortDir]: sortKey === 'size' }" @click="setSort('size')">
              {{ t('filemanager.col.size') }}<span class="fm-sort-arrow"></span>
            </div>
          </div>

          <!-- 文件列表 -->
          <div class="fm-files-list" @contextmenu="onBlankContext" @click="onBlankClick">
            <!-- 内联新建行 -->
            <div v-if="creating.active" class="fm-frow fm-creating-row">
              <div class="fm-cell fm-cell-name">
                <FileTypeIcon :icon="creating.type === 'folder' ? 'folder' : 'file'" size="list" />
                <input
                  v-model="creating.text"
                  class="fm-inline-input"
                  :placeholder="creating.type === 'folder' ? t('filemanager.placeholder.folderName') : t('filemanager.placeholder.fileName')"
                  @keydown.enter="commitCreate"
                  @keydown.esc="cancelCreate"
                  @blur="commitCreate"
                  v-focus
                />
              </div>
              <div class="fm-cell fm-cell-date"></div>
              <div class="fm-cell fm-cell-type"></div>
              <div class="fm-cell fm-cell-size"></div>
            </div>

            <!-- 文件行 -->
            <div
              v-for="entry in displayEntries"
              :key="entry.path"
              class="fm-frow"
              :class="{
                selected: selectedPaths.has(entry.path),
                'is-dir': entry.is_dir,
                'drop-target': dragState.dropTargetPath === entry.path,
                cut: fileClipboard.isCut(entry.path),
              }"
              draggable="true"
              @click="onNodeClick(entry, $event)"
              @dblclick="onNodeDblClick(entry)"
              @contextmenu="onNodeContext(entry, $event)"
              @dragstart="onDragStart(entry, $event)"
              @dragover="onDragOverTarget(entry, $event)"
              @dragleave="onDragLeaveTarget"
              @drop="onDropOnTarget(entry, $event)"
              @dragend="onDragEnd"
            >
              <div class="fm-cell fm-cell-name">
                <FileTypeIcon :icon="entry.icon" size="list" />
                <input
                  v-if="renamingPath === entry.path"
                  v-model="renamingText"
                  class="fm-inline-input"
                  @keydown.enter="commitRename"
                  @keydown.esc="cancelRename"
                  @blur="commitRename"
                  @click.stop
                  @dblclick.stop
                  v-focus
                />
                <span v-else class="fm-cell-name-text">{{ entry.name }}</span>
              </div>
              <div class="fm-cell fm-cell-date">{{ formatTime(entry.modified) }}</div>
              <div class="fm-cell fm-cell-type">{{ fileTypeLabel(entry) }}</div>
              <div class="fm-cell fm-cell-size">{{ entry.is_dir ? '' : formatSize(entry.size) }}</div>
            </div>

            <!-- 空状态 -->
            <div v-if="displayEntries.length === 0 && !creating.active" class="fm-empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
              <div class="fm-empty-title">{{ searchQuery ? t('filemanager.empty.search') : t('filemanager.empty.title') }}</div>
            </div>
          </div>
        </template>

        <!-- 外部拖入覆盖层 -->
        <Transition name="fm-drop">
          <div v-if="dragState.externalDragging" class="fm-drop-overlay">
            <div class="fm-drop-content">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v4M10 13h4"/></svg>
              <span>{{ t('filemanager.drop.hint') }}</span>
            </div>
          </div>
        </Transition>
      </section>
    </div>

    <!-- ═══ 状态栏 ═══ -->
    <footer class="fm-statusbar">
      <span>{{ t('filemanager.status.items', String(displayEntries.length)) }}</span>
      <template v-if="selectedPaths.size > 0">
        <span class="fm-st-sep">|</span>
        <span>{{ t('filemanager.status.selected', String(selectedPaths.size)) }}</span>
        <template v-if="selectedSize > 0">
          <span class="fm-st-sep">|</span>
          <span class="mono">{{ formatSize(selectedSize) }}</span>
        </template>
      </template>
      <span class="fm-st-spacer"></span>
      <span v-if="currentDisk" class="mono">{{ currentDisk.name }} · {{ formatSize(currentDisk.used) }}/{{ formatSize(currentDisk.total) }}</span>
    </footer>

    <!-- ═══ 索引进度芯片（右上角浮动） ═══ -->
    <Transition name="fm-index-bar">
      <div v-if="indexStatus.indexing" class="fm-index-chip">
        <svg class="fm-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
        <div class="fm-index-track">
          <div class="fm-index-glow" :style="{ width: indexStatus.progress + '%' }"></div>
        </div>
        <span class="fm-index-num">{{ indexStatus.progress }}%</span>
      </div>
    </Transition>

    <!-- ═══ 右键菜单 ═══ -->
    <div
      v-if="contextMenu.visible"
      class="fm-context-menu"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
      @click.stop
    >
      <template v-if="!contextMenu.isBlank">
        <button class="fm-ctx" @click="contextMenu.targetPath && navigateTo(contextMenu.targetPath); closeContextMenu()">{{ t('filemanager.ctx.open') }}</button>
        <button class="fm-ctx" @click="openWithSystem(); closeContextMenu()">{{ t('filemanager.ctx.openWith') }}</button>
        <button class="fm-ctx" @click="revealInFM(); closeContextMenu()">{{ t('filemanager.ctx.reveal') }}</button>
        <div class="fm-ctx-sep"></div>
        <button class="fm-ctx" @click="copySelection(); closeContextMenu()">{{ t('filemanager.ctx.copy') }}<span class="fm-ctx-key">⌘C</span></button>
        <button class="fm-ctx" @click="cutSelection(); closeContextMenu()">{{ t('filemanager.ctx.cut') }}<span class="fm-ctx-key">⌘X</span></button>
        <button v-if="selectedPaths.size === 1" class="fm-ctx" @click="contextMenu.targetPath && renameNode(contextMenu.targetPath); closeContextMenu()">{{ t('filemanager.ctx.rename') }}<span class="fm-ctx-key">F2</span></button>
        <div class="fm-ctx-sep"></div>
        <button class="fm-ctx danger" @click="deleteSelection(); closeContextMenu()">{{ t('filemanager.ctx.delete') }}<span class="fm-ctx-key">⌫</span></button>
        <div class="fm-ctx-sep"></div>
        <button class="fm-ctx" @click="copyAbsolutePath(); closeContextMenu()">{{ t('filemanager.ctx.copyPath') }}</button>
      </template>
      <template v-else>
        <button class="fm-ctx" :disabled="clipboardEmpty" @click="paste(); closeContextMenu()">{{ t('filemanager.ctx.paste') }}<span class="fm-ctx-key">⌘V</span></button>
        <div class="fm-ctx-sep"></div>
        <button class="fm-ctx" @click="startCreate('folder')">{{ t('filemanager.ctx.newFolder') }}</button>
        <button class="fm-ctx" @click="startCreate('file')">{{ t('filemanager.ctx.newFile') }}</button>
        <div class="fm-ctx-sep"></div>
        <button class="fm-ctx" @click="refresh(); closeContextMenu()">{{ t('filemanager.nav.refresh') }}</button>
        <button class="fm-ctx" @click="selectAll(); closeContextMenu()">{{ t('filemanager.ctx.selectAll') }}<span class="fm-ctx-key">⌘A</span></button>
        <div class="fm-ctx-sep"></div>
        <button class="fm-ctx" :disabled="undoEmpty" @click="undo(); closeContextMenu()">{{ t('filemanager.ctx.undo') }}<span class="fm-ctx-key">⌘Z</span></button>
        <button class="fm-ctx" @click="redo(); closeContextMenu()">{{ t('filemanager.ctx.redo') }}<span class="fm-ctx-key">⌘⇧Z</span></button>
      </template>
    </div>

    <!-- ═══ Toast ═══ -->
    <Transition name="fm-toast">
      <div v-if="toast.visible" class="fm-toast">
        <span>{{ toast.text }}</span>
        <button v-if="!undoEmpty" class="fm-toast-btn" @click="undo(); toast.visible = false">{{ t('filemanager.toast.undoBtn') }}</button>
      </div>
    </Transition>

    <!-- ═══ 索引设置面板 ═══ -->
    <IndexSettingsPanel :visible="indexSettingsVisible" @close="indexSettingsVisible = false" />
  </div>
</template>

<script src="./FileManager.ts"></script>

<style src="./FileManager.css"></style>
