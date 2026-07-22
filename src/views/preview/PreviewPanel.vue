<template>
  <div class="preview-panel" :style="panelStyle">
    <div class="preview-resizer" data-tooltip="拖动调整预览宽度" @mousedown="startResize"></div>
    <!-- 编辑器标签行：单一活动文件标签 + 右侧操作 -->
    <header class="preview-header">
      <div class="preview-tabs" role="tablist" aria-label="文件预览">
        <div class="preview-tab">
          <button
            id="preview-file-tab"
            class="preview-tab-label"
            role="tab"
            aria-selected="true"
            aria-controls="preview-panel-content"
          >
            <span class="preview-filename" :data-tooltip="fileName">{{ fileName }}</span>
          </button>
          <button class="preview-close" data-tooltip="关闭" aria-label="关闭预览" @click="close">
            <Icon :size="16"><X /></Icon>
          </button>
        </div>
      </div>
      <div class="preview-header-actions" role="group" aria-label="预览操作">
        <button
          v-if="canSearch"
          class="preview-edit-btn"
          :class="{ active: searchOpen }"
          data-tooltip="搜索内容 (Ctrl/⌘F)"
          aria-label="搜索文件内容"
          :aria-pressed="searchOpen"
          @click="searchOpen ? closeSearch() : openSearch()"
        >
          <Icon :size="15"><Search /></Icon>
        </button>
        <!-- Markdown 预览/源码切换 -->
        <div v-if="kind === 'markdown' && !editMode" class="preview-segmented">
          <button
            class="preview-seg-btn"
            :class="{ active: mdMode === 'preview' }"
            :aria-pressed="mdMode === 'preview'"
            @click="mdMode = 'preview'"
          >{{ previewLabel }}</button>
          <button
            class="preview-seg-btn"
            :class="{ active: mdMode === 'source' }"
            :aria-pressed="mdMode === 'source'"
            @click="mdMode = 'source'"
          >{{ sourceLabel }}</button>
        </div>
        <!-- 编辑/保存按钮（仅文本/代码/markdown 可编辑） -->
        <button v-if="canEdit && !editMode" class="preview-edit-btn" data-tooltip="编辑" aria-label="编辑" @click="toggleEdit">
          <Icon :size="15"><Edit /></Icon>
        </button>
        <button v-if="editMode" class="preview-edit-btn" data-tooltip="保存" aria-label="保存" :disabled="saving" @click="saveEdit">
          <Icon :size="15"><DeviceFloppy /></Icon>
        </button>
      </div>
    </header>

    <div v-if="searchOpen && canSearch" class="preview-searchbar" role="search">
      <Icon class="preview-search-icon" :size="14"><Search /></Icon>
      <input
        ref="searchInputRef"
        v-model="searchQuery"
        class="preview-search-input"
        :placeholder="searchPlaceholder"
        aria-label="搜索文件内容"
        @keydown.enter.prevent="goToSearchMatch($event.shiftKey ? -1 : 1)"
        @keydown.esc.prevent.stop="closeSearch"
      />
      <span class="preview-search-count" aria-live="polite">{{ searchResultLabel }}</span>
      <button class="preview-search-nav" data-tooltip="上一个 (Shift+Enter)" aria-label="上一个匹配" :disabled="searchTotal === 0" @click="goToSearchMatch(-1)">
        <Icon :size="14"><ChevronUp /></Icon>
      </button>
      <button class="preview-search-nav" data-tooltip="下一个 (Enter)" aria-label="下一个匹配" :disabled="searchTotal === 0" @click="goToSearchMatch(1)">
        <Icon :size="14"><ChevronDown /></Icon>
      </button>
      <button class="preview-search-nav" data-tooltip="关闭 (Esc)" aria-label="关闭搜索" @click="closeSearch">
        <Icon :size="14"><X /></Icon>
      </button>
    </div>

    <!-- 内容区：按文件类型切换 -->
    <div id="preview-panel-content" class="preview-body" role="tabpanel" aria-labelledby="preview-file-tab">
      <!-- 加载中 -->
      <div v-if="loading" class="preview-loading">加载中…</div>

      <!-- 编辑模式：CodeMirror 编辑器（代码/markdown 通用） -->
      <div v-else-if="editMode" class="preview-editor-host" ref="editorHostRef"></div>

      <!-- Markdown：预览 + 左侧大纲 -->
      <template v-else-if="kind === 'markdown'">
        <div class="preview-md-layout">
          <!-- 左侧大纲：仅预览模式展示 -->
          <aside v-if="mdMode === 'preview' && headings.length" class="preview-outline">
            <div class="preview-outline-title">{{ outlineLabel }}</div>
            <a
              v-for="(h, idx) in headings"
              :key="idx"
              class="preview-outline-item"
              :class="`lvl-${h.level}`"
              :data-tooltip="h.text"
              @click="scrollToHeading(idx)"
            >{{ h.text }}</a>
          </aside>
          <!-- 预览渲染 -->
          <div v-if="mdMode === 'preview'" ref="markdownPreviewRef" class="preview-md markdown-body" v-html="renderedMarkdown"></div>
          <!-- 源码展示 -->
          <pre v-else ref="markdownSourceRef" class="preview-code">{{ rawContent }}</pre>
        </div>
      </template>

      <!-- 图片：点击切换缩放 -->
      <div v-else-if="kind === 'image'" class="preview-media">
        <img
          class="preview-img"
          :class="{ zoomed: imgZoomed }"
          :src="mediaUrl"
          :alt="fileName"
          @click="toggleZoom"
        />
      </div>

      <!-- 视频：video.js 播放器 -->
      <div v-else-if="kind === 'video' && mediaUrl" class="preview-media preview-video-media">
        <video
          ref="videoRef"
          class="video-js vjs-default-skin preview-video"
          controls
          preload="metadata"
        ></video>
      </div>

      <div v-else-if="kind === 'video'" class="preview-empty">
        <div class="preview-empty-icon">
          <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
        </div>
        <div class="preview-empty-text">{{ cannotPreviewLabel }}</div>
      </div>

      <!-- 代码 / 文本：使用只读 CodeMirror（支持语法高亮 + 折叠） -->
      <div v-else-if="kind === 'code'" class="preview-code-host" ref="readOnlyEditorHostRef"></div>

      <!-- 二进制 / 无法预览 -->
      <div v-else class="preview-empty">
        <div class="preview-empty-icon">
          <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
        </div>
        <div class="preview-empty-text">{{ cannotPreviewLabel }}</div>
      </div>
    </div>

    <!-- 代码状态栏 -->
    <footer v-if="kind === 'code'" class="preview-status">
      <span>{{ fileName }}</span>
      <span class="preview-status-sep">·</span>
      <span>{{ formatSize(fileSize) }}</span>
      <span class="preview-status-sep">·</span>
      <span>{{ language || 'UTF-8' }}</span>
      <span v-if="truncated" class="preview-status-trunc">（已截断）</span>
    </footer>
  </div>
</template>
<script src="./PreviewPanel.ts"></script>
<style src="./PreviewPanel.css" scoped></style>
