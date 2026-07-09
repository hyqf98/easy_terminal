<template>
  <AppModal
    :open="open"
    :title="modalTitle"
    :subtitle="subtitle"
    :icon="icon"
    size="sm"
    @close="close"
    @update:open="onUpdateOpen"
  >
    <div class="field">
      <div class="field-label">类型</div>
      <div class="choice-cards">
        <button
          type="button"
          :class="['choice-card', { active: formType === 'file' }]"
          @click="formType = 'file'"
        >
          <div class="choice-card-icon">
            <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
          </div>
          <div class="choice-card-title">{{ fileLabel }}</div>
          <div class="choice-card-desc">支持模板创建</div>
        </button>
        <button
          type="button"
          :class="['choice-card', { active: formType === 'folder' }]"
          @click="formType = 'folder'"
        >
          <div class="choice-card-icon">
            <svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
          </div>
          <div class="choice-card-title">{{ folderLabel }}</div>
          <div class="choice-card-desc">空目录</div>
        </button>
      </div>
    </div>

    <div class="field">
      <div class="field-label">
        {{ formType === 'file' ? fileNameLabel : folderNameLabel }}
        <span class="req">*</span>
      </div>
      <input
        class="input"
        v-model="formName"
        :placeholder="namePlaceholder"
        @keydown.enter.prevent="onCreate"
      />
    </div>

    <div class="field">
      <div class="field-label">{{ parentDirLabel }}</div>
      <input class="input code" :value="parentPath" readonly />
    </div>

    <div v-if="formType === 'file'" class="field">
      <div class="field-label">
        {{ contentLabel }}
        <span class="field-hint">{{ contentHint }}</span>
      </div>
      <textarea
        class="textarea"
        v-model="formContent"
        :placeholder="contentPlaceholder"
        rows="5"
      ></textarea>
    </div>

    <template #footer>
      <button class="btn btn-ghost" @click="close">{{ cancelLabel }}</button>
      <button class="btn btn-primary" :disabled="!canCreate" @click="onCreate">
        {{ createLabel }}
      </button>
    </template>
  </AppModal>
</template>
<script src="./FileModal.ts"></script>
<style src="./FileModal.css" scoped></style>
