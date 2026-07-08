<template>
  <div class="files-layout">
    <!-- 左侧文件树 -->
    <aside class="files-tree">
      <div class="tree-toolbar">
        <button class="btn btn-soft" @click="openCreateModal">
          <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
          {{ newLabel }}
        </button>
        <button class="btn btn-ghost" title="刷新" @click="refreshTree">
          <svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-9-9" /><path d="M21 3v6h-6" /></svg>
        </button>
        <div style="flex:1"></div>
        <button
          class="btn btn-ghost"
          :class="{ 'is-active': showFavorites }"
          :title="favoritesLabel"
          @click="showFavorites = !showFavorites"
        >
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" /></svg>
        </button>
      </div>

      <div class="tree-search-row">
        <div class="search-input tree-search">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
          <input v-model="filterText" :placeholder="filterPlaceholder" />
        </div>
        <select class="select tree-sort" v-model="sortKey">
          <option value="name">{{ sortNameLabel }}</option>
          <option value="modified">{{ sortModifiedLabel }}</option>
          <option value="size">{{ sortSizeLabel }}</option>
        </select>
        <button
          class="btn btn-ghost tree-sort-dir"
          :class="{ 'is-desc': sortDir === 'desc' }"
          @click="sortDir = sortDir === 'asc' ? 'desc' : 'asc'"
        >
          <svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9" /></svg>
        </button>
      </div>

      <div class="tree-list">
        <div
          v-for="item in visibleNodes"
          :key="item.node.entry.path"
          class="tree-node"
          :class="{
            selected: selectedPath === item.node.entry.path,
            collapsed: item.node.entry.is_dir && !item.node.expanded,
            'is-dir': item.node.entry.is_dir,
            'is-file': !item.node.entry.is_dir,
            renaming: renamingPath === item.node.entry.path,
          }"
          :style="{ paddingLeft: 8 + item.depth * 14 + 'px' }"
          draggable="true"
          @click="onNodeClick(item.node)"
          @contextmenu="onNodeContext($event, item.node)"
          @dragstart="onDragStart($event, item.node)"
          @dragover="onDragOver($event, item.node)"
          @drop="onDrop($event, item.node)"
        >
          <span class="tree-chevron" @click.stop="toggleNode(item.node)">
            <svg v-if="item.node.entry.is_dir" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9" /></svg>
          </span>
          <span class="tree-icon" :class="item.node.entry.is_dir ? 'folder' : 'file'">
            <svg v-if="item.node.entry.is_dir" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
            <svg v-else viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
          </span>

          <template v-if="renamingPath === item.node.entry.path">
            <input
              class="tree-rename-input"
              v-model="renamingValue"
              @click.stop
              @keydown.enter.prevent="commitRename(item.node)"
              @keydown.esc.prevent="cancelRename"
            />
          </template>
          <template v-else>
            <span class="tree-name">{{ item.node.entry.name }}</span>
            <svg
              v-if="item.node.entry.is_dir && isFavorite(item.node.entry.path)"
              class="tree-fav"
              viewBox="0 0 24 24"
              fill="currentColor"
              @click.stop="toggleFavorite(item.node)"
            ><path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" /></svg>
            <span v-else-if="!item.node.entry.is_dir" class="tree-meta">{{ formatSize(item.node.entry.size) }}</span>
          </template>
        </div>

        <div v-if="visibleNodes.length === 0" class="tree-empty">{{ emptyLabel }}</div>
      </div>

      <div v-if="showFavorites" class="tree-favorites">
        <div class="tree-favorites-title">{{ favoritesLabel }}</div>
        <div v-if="favorites.length === 0" class="tree-favorites-empty">{{ favoritesEmptyLabel }}</div>
        <div
          v-for="fav in favorites"
          :key="fav.path"
          class="tree-node fav-item"
          @click="navigateTo(fav.path)"
        >
          <span class="tree-chevron" style="opacity:0"></span>
          <span class="tree-icon folder" style="color: var(--accent)">
            <svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
          </span>
          <span class="tree-name">{{ fav.name }}</span>
          <span class="tree-fav-remove" @click.stop="removeFavorite(fav.path)">
            <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </span>
        </div>
      </div>
    </aside>

    <!-- 右侧预览 / 编辑区 -->
    <div class="files-preview">
      <template v-if="selectedFile">
        <div class="preview-toolbar">
          <div class="breadcrumb">
            <template v-for="(crumb, idx) in breadcrumb" :key="crumb.path">
              <span v-if="idx > 0" class="breadcrumb-sep">/</span>
              <span class="breadcrumb-item" :class="{ current: crumb.current }" @click="navigateTo(crumb.path)">
                {{ crumb.name }}
              </span>
            </template>
          </div>
          <button class="btn btn-ghost preview-action" @click="openEditor">
            <svg viewBox="0 0 24 24"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
            编辑
          </button>
          <button class="btn btn-ghost preview-action" @click="copyPath">
            <svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            复制路径
          </button>
        </div>
        <div class="preview-host" ref="previewHostRef"></div>
      </template>
      <div v-else class="preview-empty">
        <div class="preview-empty-card card">
          <div class="preview-empty-icon">
            <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
          </div>
          <div class="preview-empty-title">选择一个文件以预览</div>
          <div class="preview-empty-desc">单击文件查看内容，单击文件夹展开目录</div>
        </div>
      </div>
    </div>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <div
        v-if="contextMenu"
        class="tree-context-menu"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
        @click.stop
      >
        <button class="tree-context-item" @click="openCreateModal">
          <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
          {{ newLabel }}
        </button>
        <button class="tree-context-item" @click="startRename(contextMenu.node)">
          <svg viewBox="0 0 24 24"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
          {{ renameLabel }}
        </button>
        <button class="tree-context-item" @click="deleteNode(contextMenu.node)">
          <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
          {{ deleteLabel }}
        </button>
        <div class="tree-context-divider"></div>
        <button
          v-if="contextMenu.node.entry.is_dir"
          class="tree-context-item"
          @click="toggleFavorite(contextMenu.node)"
        >
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" /></svg>
          {{ isFavorite(contextMenu.node.entry.path) ? removeFavoriteLabel : addFavoriteLabel }}
        </button>
        <button
          v-if="contextMenu.node.entry.is_dir"
          class="tree-context-item"
          @click="openTerminalHere(contextMenu.node)"
        >
          <svg viewBox="0 0 24 24"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>
          {{ openInTerminalLabel }}
        </button>
      </div>
    </Teleport>

    <!-- 新建文件 / 文件夹弹框 -->
    <FileModal
      :open="fileModalOpen"
      :parent-path="fileModalParent"
      :mode="fileModalMode"
      @close="fileModalOpen = false"
      @update:open="fileModalOpen = $event"
      @create="onFileModalCreate"
    />
  </div>
</template>
<script src="./FileTree.ts"></script>
<style src="./FileTree.css" scoped></style>
