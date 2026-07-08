<template>
  <AppModal
    :open="open"
    title="安装预览"
    :subtitle="subTitle"
    :icon="icon"
    size="md"
    @close="close"
    @update:open="onUpdateOpen"
  >
    <div class="install-banner danger-banner info">
      <div class="danger-banner-icon">
        <svg viewBox="0 0 24 24"><path d="M3 9l1.5-5h15L21 9"/><path d="M3 9v11h18V9"/></svg>
      </div>
      <div class="danger-banner-text">
        即将安装到 <strong>命令库 → 已安装</strong> 分类。安装后可在终端输入触发词调用。
        <div v-if="library && library.description" class="install-banner-desc">{{ library.description }}</div>
      </div>
    </div>
    <div class="section-label">{{ sectionLabel }}</div>
    <div class="preview-list">
      <div v-for="cmd in previewCommands" :key="cmd.command || cmd.name" class="preview-list-item">
        <div class="preview-list-icon">
          <svg viewBox="0 0 24 24"><path d="M6 6 18 18M18 6 6 18"/></svg>
        </div>
        <div class="preview-list-cmd" v-html="tokenize(cmd.command || cmd.name)"></div>
      </div>
    </div>
    <div class="install-total">{{ totalLabel }}</div>

    <template #footer>
      <button class="btn btn-ghost" @click="close">取消</button>
      <button class="btn btn-primary" @click="onInstall">
        <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        {{ installLabel }}
      </button>
    </template>
  </AppModal>
</template>
<script src="./InstallPreviewModal.ts"></script>
<style src="./InstallPreviewModal.css" scoped></style>
