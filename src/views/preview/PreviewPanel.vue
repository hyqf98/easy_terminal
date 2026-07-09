<template>
  <div class="preview-panel">
    <!-- 头部：文件名 + 类型徽标 + 关闭 -->
    <header class="preview-header">
      <span class="preview-filename" :title="fileName">{{ fileName }}</span>
      <span class="preview-badge">{{ kindLabel }}</span>
      <div class="preview-header-spacer"></div>
      <!-- Markdown 预览/源码切换 -->
      <div v-if="kind === 'markdown' && !editMode" class="preview-segmented">
        <button
          class="preview-seg-btn"
          :class="{ active: mdMode === 'preview' }"
          @click="mdMode = 'preview'"
        >{{ previewLabel }}</button>
        <button
          class="preview-seg-btn"
          :class="{ active: mdMode === 'source' }"
          @click="mdMode = 'source'"
        >{{ sourceLabel }}</button>
      </div>
      <!-- 编辑/保存按钮（仅文本/代码/markdown 可编辑） -->
      <button v-if="canEdit && !editMode" class="preview-edit-btn" title="编辑" @click="toggleEdit">
        <Icon :size="15"><Edit /></Icon>
      </button>
      <button v-if="editMode" class="preview-edit-btn" title="保存" :disabled="saving" @click="saveEdit">
        <Icon :size="15"><DeviceFloppy /></Icon>
      </button>
      <button v-if="editMode" class="preview-edit-btn" title="退出编辑" @click="toggleEdit">
        <Icon :size="15"><X /></Icon>
      </button>
      <button class="preview-close" title="关闭" @click="close">
        <Icon :size="16"><X /></Icon>
      </button>
    </header>

    <!-- 内容区：按文件类型切换 -->
    <div class="preview-body">
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
              :title="h.text"
            >{{ h.text }}</a>
          </aside>
          <!-- 预览渲染 -->
          <div v-if="mdMode === 'preview'" class="preview-md markdown-body" v-html="renderedMarkdown"></div>
          <!-- 源码展示 -->
          <pre v-else class="preview-code">{{ rawContent }}</pre>
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
      <div v-else-if="kind === 'video'" class="preview-media">
        <video
          ref="videoRef"
          class="video-js vjs-default-skin"
          controls
          preload="metadata"
        >
          <source :src="mediaUrl" />
        </video>
      </div>

      <!-- 代码 / 文本 -->
      <pre v-else-if="kind === 'code'" class="preview-code">{{ rawContent }}</pre>

      <!-- 二进制 / 无法预览 -->
      <div v-else class="preview-empty">
        <div class="preview-empty-icon">
          <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
        </div>
        <div class="preview-empty-text">{{ cannotPreviewLabel }}</div>
      </div>
    </div>

    <!-- 状态栏 -->
    <footer v-if="kind === 'code' || kind === 'markdown'" class="preview-status">
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
