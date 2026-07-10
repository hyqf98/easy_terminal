<template>
  <!-- 宽度通过 CSS 变量 --filetree-width 驱动，默认 280px；
       被 TerminalFilePanel 嵌入时 :deep 覆盖为 100%（内联 style 仅设变量，不直接设 width） -->
  <div class="files-layout" :style="{ '--filetree-width': panelWidth + 'px' }">
    <!-- 右侧拖拽缩放手柄：调整文件列宽度 -->
    <div
      class="files-resizer"
      :class="{ dragging: resizing }"
      @mousedown.stop.prevent="onResizerMouseDown"
    ></div>
    <!-- 左侧文件树（唯一内容，预览已迁移至独立 PreviewPanel） -->
    <aside class="files-tree">
      <!-- 收藏夹卡片：网格换行布局（每行3个），默认2行，超出则"更多"展开 -->
      <div
        v-if="favorites.length > 0"
        class="fav-cards-shell"
      >
        <div class="fav-cards-grid">
          <div
            v-for="fav in visibleFavorites"
            :key="fav.path"
            class="fav-card"
            :title="fav.path"
            @click="navigateTo(fav.path)"
            @contextmenu="onFavContext($event, fav)"
          >
            <span class="fav-card-icon" :style="{ color: fav.color || favIconColor(fav.icon) }" v-html="'<svg viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'1.6\' stroke-linecap=\'round\' stroke-linejoin=\'round\'>' + favIconSvg(fav.icon) + '</svg>'"></span>
            <span class="fav-card-name" :title="fav.name">{{ fav.name }}</span>
          </div>
        </div>
        <!-- 更多/收起按钮：收藏数超过当前显示行数时出现 -->
        <button
          v-if="favorites.length > visibleFavorites.length"
          class="fav-more-btn"
          @click="expandFavorites"
        >
          更多 {{ favorites.length - visibleFavorites.length }}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
        </button>
        <button
          v-else-if="favExpandedRows > FAV_DEFAULT_ROWS"
          class="fav-more-btn"
          @click="collapseFavorites"
        >
          收起
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
        </button>
      </div>

      <!-- 筛选 / 排序行：紧凑单行，方向切换按钮紧跟排序框 -->
      <div class="tree-search-row">
        <div class="search-input tree-search">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
          <input v-model="filterText" :placeholder="filterPlaceholder" />
        </div>
        <AppSelect
          class="tree-sort"
          :model-value="sortValue"
          :options="sortOptions"
          @update:model-value="onSortKeyChange"
        />
        <!-- 升降序切换按钮：点击翻转方向 -->
        <button
          class="btn btn-ghost tree-sort-dir-btn"
          :title="sortDir === 'asc' ? '升序（点击切降序）' : '降序（点击切升序）'"
          @click="toggleSortDir"
        >
          <svg v-if="sortDir === 'asc'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/></svg>
        </button>
        <button
          class="btn btn-ghost tree-refresh-btn"
          :title="refreshLabel"
          @click="refreshTree"
        >
          <Icon :size="13"><Refresh /></Icon>
        </button>
        <!-- 定位当前终端工作目录：跳转到对应目录节点 -->
        <button
          class="btn btn-ghost tree-locate-btn"
          title="定位到当前终端目录"
          @click="$emit('locate-cwd')"
        >
          <Icon :size="13"><Target /></Icon>
        </button>
      </div>

      <div class="tree-list-shell">
        <div ref="treeListRef" class="tree-list" @scroll.passive="updateTreeScrollbar">
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
            <span class="tree-icon" :class="iconClass(item.node.entry)">
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
        <div
          v-if="showCustomTreeScrollbar"
          class="tree-scrollbar-track"
          @mousedown.stop.prevent="onTreeScrollbarTrackMouseDown"
        >
          <div
            class="tree-scrollbar-thumb"
            :style="{ height: treeScrollbarHeight + 'px', transform: 'translateY(' + treeScrollbarTop + 'px)' }"
            @mousedown.stop.prevent="onTreeScrollbarThumbMouseDown"
          ></div>
        </div>
      </div>
    </aside>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <div
        v-if="contextMenu"
        class="tree-context-menu"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
        @click.stop
      >
        <button class="tree-context-item" @click="openCreateModal('file')">
          <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
          {{ newFileLabel }}
        </button>
        <button class="tree-context-item" @click="openCreateModal('folder')">
          <svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
          {{ newFolderLabel }}
        </button>
        <div class="tree-context-divider"></div>
        <button class="tree-context-item" @click="startRename(contextMenu.node)">
          <svg viewBox="0 0 24 24"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
          {{ renameLabel }}
        </button>
        <button class="tree-context-item" @click="deleteNode(contextMenu.node)">
          <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
          {{ deleteLabel }}
        </button>
        <button class="tree-context-item" @click="copyNodePath(contextMenu.node)">
          <svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
          {{ copyPathLabel }}
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
        <button
          v-if="contextMenu.node.entry.is_dir"
          class="tree-context-item"
          @click="onCdToTerminal(contextMenu.node)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M7 9l3 3-3 3" /><line x1="13" y1="15" x2="17" y2="15" /></svg>
          在终端打开（cd）
        </button>
      </div>
    </Teleport>

    <!-- 收藏夹右键菜单 -->
    <Teleport to="body">
      <div
        v-if="favContextMenu"
        class="tree-context-menu"
        :style="{ left: favContextMenu.x + 'px', top: favContextMenu.y + 'px' }"
        @click.stop
      >
        <button class="tree-context-item" @click="openFavEditor(favContextMenu.fav); favContextMenu = null">
          <svg viewBox="0 0 24 24"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
          编辑收藏
        </button>
        <button class="tree-context-item" @click="navigateTo(favContextMenu.fav.path); favContextMenu = null">
          <svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
          打开目录
        </button>
        <div class="tree-context-divider"></div>
        <button class="tree-context-item" @click="copyFavPath(favContextMenu.fav); favContextMenu = null">
          <svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
          复制路径
        </button>
        <button class="tree-context-item tree-context-danger" @click="removeFavorite(favContextMenu.fav.path); favContextMenu = null">
          <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
          移除收藏
        </button>
      </div>
    </Teleport>

    <!-- 收藏夹编辑弹框 -->
    <Teleport to="body">
      <div v-if="favEditOpen" class="fav-edit-overlay" @click="favEditOpen = false">
        <div class="fav-edit-modal" @click.stop>
          <div class="fav-edit-header">
            <span class="fav-edit-title">编辑收藏</span>
            <button class="fav-edit-close" @click="favEditOpen = false">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
          <div class="fav-edit-body">
            <div class="fav-edit-field">
              <label>显示名称</label>
              <input class="input" v-model="favEditName" placeholder="收藏夹名称" @keydown.enter="saveFavEdit" />
            </div>
            <div class="fav-edit-field">
              <label>选择图标</label>
              <div class="fav-icon-grid">
                <button
                  v-for="ic in FAVORITE_ICONS"
                  :key="ic.key"
                  :class="['fav-icon-pick', { active: favEditIcon === ic.key }]"
                  :title="ic.label"
                  :style="{ color: favEditIcon === ic.key ? ic.color : ic.color }"
                  @click="favEditIcon = ic.key"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" v-html="ic.svg"></svg>
                </button>
              </div>
            </div>
          </div>
          <div class="fav-edit-footer">
            <button class="btn btn-ghost" @click="favEditOpen = false">取消</button>
            <button class="btn btn-primary" @click="saveFavEdit">保存</button>
          </div>
        </div>
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
